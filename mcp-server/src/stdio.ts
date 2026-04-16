#!/usr/bin/env node

/**
 * MCPDomain — stdio transport entry point
 *
 * This is the entry point used when running MCPDomain locally
 * with Claude Desktop, Claude Code, or any MCP client that
 * spawns the server as a subprocess.
 *
 * Usage with Claude Desktop (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "mcpdomain": {
 *       "command": "npx",
 *       "args": ["-y", "mcpdomain-mcp"]
 *     }
 *   }
 * }
 *
 * Usage with Claude Code:
 *   claude mcp add mcpdomain -- npx -y mcpdomain-mcp
 *
 * Usage with Smithery:
 *   npx @smithery/cli install mcpdomain-mcp
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMCPDomainServer, getServerInfo } from "./server.js";

async function main() {
  const info = getServerInfo();

  // Log to stderr (stdout is reserved for MCP protocol)
  process.stderr.write(`MCPDomain MCP Server v${info.version}\n`);
  process.stderr.write(`Mode: ${info.mode}\n`);
  process.stderr.write(`Tools: ${info.tool_count}\n`);
  process.stderr.write(`Supported TLDs: ${info.supported_tlds.length}\n`);
  process.stderr.write(`Ready.\n\n`);

  const server = createMCPDomainServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  process.on("SIGINT", async () => {
    process.stderr.write("\nShutting down MCPDomain server...\n");
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  process.stderr.write(`Fatal error: ${error}\n`);
  process.exit(1);
});
