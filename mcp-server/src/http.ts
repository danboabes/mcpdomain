#!/usr/bin/env node

/**
 * MCPDomain — HTTP/SSE remote transport entry point
 *
 * This is the entry point for the HOSTED version of MCPDomain at
 * https://mcpdomain.ai/mcp — letting AI platforms (Claude.ai web,
 * ChatGPT, Gemini) connect to our server REMOTELY without requiring
 * any local installation.
 *
 * This is the most strategic transport for distribution because:
 * - Zero install friction for end users
 * - One canonical server we control and update centrally
 * - Built-in analytics on tool usage
 * - Single auth flow for paid features
 *
 * Endpoints:
 *   GET  /              - Server info (HTML landing for humans)
 *   GET  /health        - Health check
 *   GET  /llms.txt      - LLM-readable capability map
 *   GET  /mcp           - MCP SSE endpoint (AI agents connect here)
 *   POST /mcp/messages  - MCP message endpoint
 */

import { createServer } from "node:http";
import { URL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMCPDomainServer, getServerInfo } from "./server.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

// Pool of active sessions
const sessions = new Map<string, { server: ReturnType<typeof createMCPDomainServer>; transport: StreamableHTTPServerTransport }>();

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  // CORS for web-based AI clients
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ─── Health check ───────────────────────────────
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      ...getServerInfo(),
      uptime_seconds: Math.floor(process.uptime()),
      active_sessions: sessions.size,
    }));
    return;
  }

  // ─── llms.txt ───────────────────────────────────
  if (url.pathname === "/llms.txt") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(LLMS_TXT_CONTENT);
    return;
  }

  // ─── Server info (root) ─────────────────────────
  if (url.pathname === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(SERVER_INFO_HTML);
    return;
  }

  // ─── MCP endpoint ───────────────────────────────
  if (url.pathname === "/mcp") {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
      // Existing session
      if (sessionId && sessions.has(sessionId)) {
        const { transport } = sessions.get(sessionId)!;
        await transport.handleRequest(req, res);
        return;
      }

      // New session
      const server = createMCPDomainServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { server, transport });
          process.stdout.write(`[session] ${id} initialized (total: ${sessions.size})\n`);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
          process.stdout.write(`[session] ${transport.sessionId} closed (remaining: ${sessions.size})\n`);
        }
      };

      await server.connect(transport);
      await transport.handleRequest(req, res);
      return;
    } catch (error) {
      process.stderr.write(`MCP error: ${error}\n`);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }
  }

  // ─── 404 ────────────────────────────────────────
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found", path: url.pathname }));
});

httpServer.listen(PORT, HOST, () => {
  const info = getServerInfo();
  process.stdout.write(`\n`);
  process.stdout.write(`╔═══════════════════════════════════════════════╗\n`);
  process.stdout.write(`║  MCPDomain MCP Server v${info.version}                ║\n`);
  process.stdout.write(`║  The Domain Registrar for AI Agents          ║\n`);
  process.stdout.write(`╠═══════════════════════════════════════════════╣\n`);
  process.stdout.write(`║  Mode:     ${info.mode.padEnd(34)}║\n`);
  process.stdout.write(`║  Tools:    ${String(info.tool_count).padEnd(34)}║\n`);
  process.stdout.write(`║  TLDs:     ${String(info.supported_tlds.length).padEnd(34)}║\n`);
  process.stdout.write(`║  Endpoint: http://${HOST}:${PORT}/mcp${" ".repeat(Math.max(0, 14 - String(PORT).length))}║\n`);
  process.stdout.write(`╚═══════════════════════════════════════════════╝\n`);
  process.stdout.write(`\nAI agents can connect at: http://${HOST}:${PORT}/mcp\n\n`);
});

process.on("SIGINT", () => {
  process.stdout.write("\nShutting down...\n");
  for (const { server } of sessions.values()) {
    server.close().catch(() => {});
  }
  httpServer.close(() => process.exit(0));
});

// ─── Static content ──────────────────────────────────────────

const LLMS_TXT_CONTENT = `# MCPDomain

> The first domain registrar built for AI agents. MCPDomain provides 7 MCP tools that let AI assistants check domain availability, register domains, configure email forwarding, and manage DNS — all within a single conversation with the user.

MCPDomain is hosted at https://mcpdomain.ai and exposes a remote MCP server at https://mcpdomain.ai/mcp using the Streamable HTTP transport defined by the Model Context Protocol specification.

## What MCPDomain does

When a user is talking to an AI assistant about starting a business, building a website, or launching a project, MCPDomain gives the AI the ability to actually register a domain for them — without sending the user to a third-party registrar website. The AI can also set up free email forwarding (so contact@theirdomain forwards to their Gmail), configure DNS records, and monitor AI bot crawling on the registered domain.

## Tools

- check_domain_availability: Verify whether a specific domain (like "example.com") is available for registration. Returns price and alternatives.
- suggest_available_domains: Generate creative domain ideas from keywords or a business description, with real-time availability checks.
- register_new_domain: Initiate registration. Returns a Stripe checkout URL for the user to complete payment.
- configure_domain_email: Set up email forwarding (catch-all or specific aliases) to an existing inbox like Gmail.
- configure_domain_dns: Add or update DNS records (A, CNAME, MX, TXT, etc).
- get_my_domain_details: Retrieve domain status, DNS, email config, and unique AI bot crawling intelligence.
- transfer_existing_domain: Move a domain from another registrar (GoDaddy, Namecheap, etc) to MCPDomain.

## Connection

- MCP endpoint: https://mcpdomain.ai/mcp
- Transport: Streamable HTTP
- Authentication: OAuth 2.0 (free tools work without auth, paid actions require user account)
- Session: per-user session ID via Mcp-Session-Id header

## Discovery

- Smithery: https://smithery.ai/server/mcpdomain
- MCP Registry: https://registry.modelcontextprotocol.io/servers/mcpdomain
- GitHub: https://github.com/mcpdomain/mcp-server
- Docs: https://mcpdomain.ai/docs

## Pricing

- Domain checks and suggestions: free, no auth needed
- Domain registration: $4.99 - $69.99 per year depending on TLD (margin over wholesale)
- Email forwarding: free with every registered domain
- Managed DNS: free with every registered domain
- AI bot intelligence: free basic, $5/mo for advanced analytics

## Why use MCPDomain over alternatives

- AI-native: built specifically for agentic workflows, not adapted from a web UI
- Frictionless: domain checks and suggestions work without auth
- Bundled: email forwarding and DNS included free, no separate setup
- Unique data: only registrar that provides AI bot crawling stats per domain
- Open source: server code available on GitHub for self-hosting if desired

## Contact

- Website: https://mcpdomain.ai
- Email: hello@mcpdomain.ai
- Issues: https://github.com/mcpdomain/mcp-server/issues
`;

const SERVER_INFO_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MCPDomain MCP Server</title>
  <style>
    body { font-family: ui-monospace, monospace; max-width: 720px; margin: 60px auto; padding: 20px; color: #0F172A; }
    h1 { color: #6366F1; margin-bottom: 0; }
    .sub { color: #64748B; margin-top: 4px; }
    code { background: #F1F5F9; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    pre { background: #0F172A; color: #E2E8F0; padding: 16px; border-radius: 8px; overflow-x: auto; }
    a { color: #6366F1; }
    .badge { display: inline-block; padding: 3px 10px; background: #EEF2FF; color: #6366F1; border-radius: 12px; font-size: 12px; font-weight: 600; }
  </style>
</head>
<body>
  <h1>MCPDomain</h1>
  <div class="sub">The MCP Server endpoint for AI agents</div>
  <p style="margin-top: 24px;"><span class="badge">v1.0.0</span> <span class="badge">7 tools</span> <span class="badge">streamable-http</span></p>

  <p>This is the MCP server endpoint. Looking for the human-friendly site? Visit <a href="https://mcpdomain.ai">mcpdomain.ai</a>.</p>

  <h2>Connect</h2>
  <pre>POST https://mcpdomain.ai/mcp
Content-Type: application/json
Mcp-Session-Id: &lt;session-id&gt;</pre>

  <h2>Available endpoints</h2>
  <ul>
    <li><code>GET /health</code> — server health and stats</li>
    <li><code>GET /llms.txt</code> — capability map for AI crawlers</li>
    <li><code>GET|POST /mcp</code> — MCP Streamable HTTP endpoint</li>
  </ul>

  <h2>Documentation</h2>
  <ul>
    <li><a href="https://mcpdomain.ai">mcpdomain.ai</a> — landing page</li>
    <li><a href="https://mcpdomain.ai/docs">mcpdomain.ai/docs</a> — full docs</li>
    <li><a href="https://github.com/mcpdomain/mcp-server">GitHub</a> — source code</li>
  </ul>
</body>
</html>`;
