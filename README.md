# MCPDomain

**Buy and manage internet domains from inside any AI chat.**

MCPDomain is the first domain registrar exposed as a
[Model Context Protocol](https://modelcontextprotocol.io) server.
Ask Claude, ChatGPT, or Cursor to find a domain — they can check
availability, register it, set up free email forwarding, configure DNS,
and show you which AI bots are crawling it, all without leaving the chat.

[![npm](https://img.shields.io/npm/v/mcpdomain.svg?label=mcpdomain&logo=npm)](https://www.npmjs.com/package/mcpdomain)
[![license](https://img.shields.io/npm/l/mcpdomain.svg)](./LICENSE)
[![web](https://img.shields.io/badge/web-mcpdomain.ai-blue)](https://mcpdomain.ai)

> **Hosted endpoint:** `https://mcpdomain.ai/mcp` — plug into any
> remote-MCP-capable client, no install needed.
> **Local stdio:** `npm install -g mcpdomain` — see below.

---

## What it looks like

```
You:  Find me a .com for a sourdough bakery in Brooklyn.

Claude:  sweetcrumbs.com is taken, but these are available:
         - brooklynsourdough.com  — $14.99
         - crumbsbrooklyn.com     — $14.99
         - doughbk.com            — $14.99
         Want me to register one?

You:  Yes, brooklynsourdough.com, and forward hello@ to my gmail.

Claude:  Here's your checkout link: https://mcpdomain.ai/c/ord_abc123
         Once you pay, I'll set up email forwarding automatically.
```

That's the entire flow. No registrar UI, no DNS dashboard, no MX-record
copy-paste.

---

## Features

* **7 MCP tools** covering the full domain lifecycle (see below).
* **Free email forwarding** — `hello@yourdomain.com` → your existing
  inbox. No mail server. No MX setup.
* **Free managed DNS** — the agent already knows the records for Vercel,
  Netlify, GitHub Pages, Cloudflare Pages. Ask and it's done.
* **AI bot intelligence** — 30-day report of which AI crawlers (GPTBot,
  ClaudeBot, Google-Extended, Bytespider, etc.) hit your domain. No other
  registrar offers this.
* **Backed by a real registrar** — OpenSRS / Tucows, ICANN-accredited.
  Your domain is in your name, portable, renewable, transferable.

## Tools

| Tool | What it does |
|------|--------------|
| `check_domain_availability` | Is this exact name free? What's it cost? |
| `suggest_available_domains` | Brandable name ideas, real-time verified. |
| `register_new_domain` | Start a registration, returns a Stripe checkout URL. |
| `configure_domain_email` | Catch-all or per-alias email forwarding. |
| `configure_domain_dns` | A / CNAME / MX / TXT, with presets for common hosts. |
| `get_my_domain_details` | Status, expiry, DNS, email forwards, AI-bot stats. |
| `transfer_existing_domain` | Move a domain in from another registrar. |

Tool prompts (the text the LLM actually reads) live in
[`mcp-server/src/tool-descriptions.ts`](./mcp-server/src/tool-descriptions.ts).

---

## Install

### Hosted (easiest)

Point any remote-MCP-capable client at:

```
https://mcpdomain.ai/mcp
```

No install. No keys.

### Local stdio

```bash
npm install -g mcpdomain
```

**Claude Desktop** — edit your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcpdomain": {
      "command": "npx",
      "args": ["-y", "mcpdomain"]
    }
  }
}
```

**Cursor** — Settings → MCP → Add:

```json
{
  "mcpdomain": {
    "command": "npx",
    "args": ["-y", "mcpdomain"]
  }
}
```

**OpenClaw** — one line, via McPorter:

```bash
npm install -g mcporter
mcporter install mcpdomain --target openclaw
```

That writes the server to `~/.openclaw/workspace/config/mcporter.json`
automatically. If you prefer editing it manually, drop the same
`mcpServers` block from the Claude Desktop snippet above into that file.

More client recipes are in the [npm README](./mcp-server/README.md).

---

## Architecture

```
  Claude / ChatGPT / Cursor
            │  MCP
            ▼
   mcpdomain (stdio package)
            │  HTTPS
            ▼
   mcpdomain.ai  (Cloudflare Worker + D1)
            │  XML API
            ▼
   OpenSRS / Tucows registrar
```

Most of the logic — orders, Stripe checkout, DNS, email forwarding,
bot-intel logging — lives in the Cloudflare Worker, not in the local
package. That keeps the npm install tiny and the client free of API
keys.

Source layout:

```
mcp-server/     ← the npm package (this is `mcpdomain` on npm)
  src/          ← TypeScript source
  Dockerfile    ← container build for HTTP transport
worker/         ← Cloudflare Worker (server-side)
  src/          ← endpoints, admin dashboard, OpenSRS adapter
  migrations/   ← D1 schema
```

---

## Development

```bash
git clone https://github.com/danboabes/mcpdomain.git
cd mcpdomain/mcp-server
npm install
npm run dev        # runs the MCP server over stdio via tsx
```

To run the HTTP transport locally:

```bash
npm run dev:http
```

The MCP Inspector from Anthropic is the fastest way to poke at tools
while iterating.

---

## Pricing

Prices the agent quotes are what you pay at checkout — wholesale + a
small flat margin, no "first year free" bait, no auto-renew price
hikes. Current TLD prices are on [mcpdomain.ai](https://mcpdomain.ai).

## Privacy

Whois privacy is on by default wherever the TLD supports it. The
bot-intel feature logs AI crawler traffic only, never visitor PII.
Payments go through Stripe — we never see card details.

## License

MIT — see [LICENSE](./LICENSE).

## Links

* Web: [mcpdomain.ai](https://mcpdomain.ai)
* npm: [mcpdomain](https://www.npmjs.com/package/mcpdomain)
* Hosted MCP: `https://mcpdomain.ai/mcp`
* Issues: [github.com/danboabes/mcpdomain/issues](https://github.com/danboabes/mcpdomain/issues)
