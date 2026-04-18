# MCPDomain

**The first domain registrar built natively for AI agents.**

Buy and manage internet domains from inside any AI conversation — no registrar
website, no DNS dashboard, no email-hosting setup. Powered by
[OpenSRS / Tucows](https://opensrs.com), exposed as a
[Model Context Protocol](https://modelcontextprotocol.io) server.

[![npm version](https://img.shields.io/npm/v/mcpdomain.svg)](https://www.npmjs.com/package/mcpdomain)
[![Smithery](https://smithery.ai/badge/danboabes/mcpdomain)](https://smithery.ai/servers/danboabes/mcpdomain)
[![license](https://img.shields.io/npm/l/mcpdomain.svg)](https://github.com/danboabes/mcpdomain/blob/main/LICENSE)

---

## Talk to your AI like this

> "Find me a `.com` for a sourdough bakery in Brooklyn."
>
> "Is `sweetcrumbs.io` available? If yes, register it."
>
> "Set up `hello@sweetcrumbs.com` to forward to my Gmail."
>
> "Point `sweetcrumbs.com` at my Vercel project."
>
> "Which AI bots crawled `sweetcrumbs.com` this month?"

The agent picks the right tool, walks you through it, and hands you a Stripe
checkout URL when payment is needed. The domain is registered in your name —
portable, renewable, transferable.

---

## Why MCPDomain

* **Zero context switching.** Stay in the chat. No registrar UI, no DNS
  dashboard, no MX record copy-paste.
* **Free email forwarding.** `hello@yourdomain.com` → your existing inbox.
  No mail server, no MX setup, catch-all or per-alias.
* **Free managed DNS.** The agent already knows the records for Vercel,
  Netlify, GitHub Pages, Cloudflare Pages — just ask.
* **AI bot intelligence.** 30-day report of which AI crawlers (GPTBot,
  ClaudeBot, Google-Extended, Bytespider) hit your domain. No other
  registrar offers this.
* **Real registrar.** ICANN-accredited, backed by OpenSRS / Tucows.

---

## The 7 tools

| Tool | What it does |
|------|--------------|
| `check_domain_availability` | Is this exact name free? What's it cost? |
| `suggest_available_domains` | Brandable name ideas, real-time verified. |
| `register_new_domain` | Start a registration; returns a Stripe checkout URL. |
| `configure_domain_email` | Catch-all or per-alias email forwarding. |
| `configure_domain_dns` | A / CNAME / MX / TXT, with presets for common hosts. |
| `get_my_domain_details` | Status, expiry, DNS, email forwards, AI-bot stats. |
| `transfer_existing_domain` | Move a domain in from another registrar. |

---

## Install

### Option A — hosted (recommended)

Point any remote-MCP-capable client at:

```
https://mcpdomain.ai/mcp
```

No install. No keys. No Node required.

### Option B — Smithery one-click

```bash
npx @smithery/cli install @danboabes/mcpdomain
```

### Option C — local stdio

```bash
npm install -g mcpdomain
```

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

#### Cursor

Settings → MCP → Add new server:

```json
{
  "mcpdomain": {
    "command": "npx",
    "args": ["-y", "mcpdomain"]
  }
}
```

#### OpenClaw (via McPorter)

```bash
npm install -g mcporter
mcporter install mcpdomain --target openclaw
```

This auto-writes the server to `~/.openclaw/workspace/config/mcporter.json`.

---

## Example conversation

```
You:    Find me a .com for a sourdough bakery in Brooklyn.

Claude: sweetcrumbs.com is taken, but these are available:
        - brooklynsourdough.com  — $14.99
        - crumbsbrooklyn.com     — $14.99
        - doughbk.com            — $14.99
        Want me to register one?

You:    Yes, brooklynsourdough.com. Forward hello@ to my gmail.

Claude: Here's your checkout link: https://mcpdomain.ai/c/ord_abc123
        Once you pay, I'll set up email forwarding automatically.
```

No registrar UI. No DNS dashboard. No MX-record copy-paste.

---

## Architecture

```
  Claude / ChatGPT / Cursor
            │  MCP
            ▼
   mcpdomain (this package, stdio)
            │  HTTPS
            ▼
   mcpdomain.ai (Cloudflare Worker + D1)
            │  XML API
            ▼
   OpenSRS / Tucows registrar
```

The heavy lifting — orders, Stripe checkout, DNS, email forwarding, bot-intel
logging — lives in the Cloudflare Worker, not in this local package. That
keeps the npm install tiny and the client free of API keys.

---

## Pricing

Prices the agent quotes are what you pay at checkout — wholesale + a small
flat margin. No "first year free" bait. No auto-renew price hikes. Current
TLD prices are on [mcpdomain.ai](https://mcpdomain.ai).

## Privacy

* Whois privacy is on by default wherever the TLD supports it.
* The bot-intel feature logs AI crawler traffic only, never visitor PII.
* Payments go through Stripe — we never see card details.

## License

MIT — see [LICENSE](../LICENSE).

## Links

* Web: [mcpdomain.ai](https://mcpdomain.ai)
* npm: [mcpdomain](https://www.npmjs.com/package/mcpdomain)
* Smithery: [danboabes/mcpdomain](https://smithery.ai/servers/danboabes/mcpdomain)
* Hosted MCP: `https://mcpdomain.ai/mcp`
* Issues: [github.com/danboabes/mcpdomain/issues](https://github.com/danboabes/mcpdomain/issues)
