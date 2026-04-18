#!/usr/bin/env node
/**
 * mcpdomain - stdio transport for MCPDomain MCP server.
 *
 * This process is a thin proxy: it reads JSON-RPC messages from stdin,
 * forwards each one to the remote MCPDomain Worker at
 * https://mcpdomain.ai/mcp over HTTPS, and writes the response back to
 * stdout. All business logic (domain availability, order creation,
 * Stripe checkout, D1 persistence) lives in the Worker — this file is
 * purely a transport shim so that stdio-only MCP clients (Claude
 * Desktop, Cursor, etc.) can use the same backend as Streamable-HTTP
 * clients.
 *
 * Zero runtime dependencies. Uses only Node 18+ built-ins.
 */

const MCP_ENDPOINT = process.env.MCPDOMAIN_ENDPOINT || "https://mcpdomain.ai/mcp";
const REQUEST_TIMEOUT_MS = 30_000;

let sessionId: string | undefined;

function log(...args: unknown[]): void {
  // MCP stdio reserves stdout for protocol traffic. Logs go to stderr.
  try {
    process.stderr.write(`[mcpdomain] ${args.join(" ")}\n`);
  } catch {
    // ignore
  }
}

async function forward(message: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;

    const resp = await fetch(MCP_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      signal: controller.signal,
    });

    // Capture session id on initialize
    const sid = resp.headers.get("mcp-session-id");
    if (sid) sessionId = sid;

    if (resp.status === 204) return null; // notifications
    const text = await resp.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      // Server returned non-JSON — surface as a transport error
      const id =
        typeof message === "object" && message !== null && "id" in (message as any)
          ? (message as any).id
          : null;
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: `Non-JSON response from ${MCP_ENDPOINT}: ${text.slice(0, 200)}`,
        },
      };
    }
  } catch (err: any) {
    const id =
      typeof message === "object" && message !== null && "id" in (message as any)
        ? (message as any).id
        : null;
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: `Transport error talking to ${MCP_ENDPOINT}: ${err?.message ?? String(err)}`,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

function writeMessage(msg: unknown): void {
  if (msg === null || msg === undefined) return;
  try {
    process.stdout.write(JSON.stringify(msg) + "\n");
  } catch (err) {
    log("stdout write failed:", String(err));
  }
}

async function handleLine(line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    writeMessage({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: `Parse error: ${(err as Error).message}` },
    });
    return;
  }

  const response = await forward(parsed);
  writeMessage(response);
}

async function main(): Promise<void> {
  log(`proxying to ${MCP_ENDPOINT}`);

  let buffer = "";
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let idx: number;
    // Process complete lines; queue the work but don't block the loop
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      // Fire and forget — each request is independent JSON-RPC
      handleLine(line).catch((err) => log("handler error:", String(err)));
    }
  });

  process.stdin.on("end", () => {
    if (buffer.trim()) {
      handleLine(buffer).finally(() => process.exit(0));
    } else {
      process.exit(0);
    }
  });

  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}

main().catch((err) => {
  log("fatal:", String(err));
  process.exit(1);
});
