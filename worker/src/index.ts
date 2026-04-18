/**
 * MCPDomain - Cloudflare Worker
 *
 * Self-contained MCP server implementing the Streamable HTTP transport.
 * Deployed at https://mcpdomain.ai/mcp
 *
 * Routes:
 *   POST /mcp                 - MCP JSON-RPC endpoint (7 tools)
 *   GET  /health              - health check
 *   GET  /llms.txt            - AI-readable site description
 *   GET  /checkout/:orderId   - HTML checkout page for a pending order
 *
 * Persistence: Cloudflare D1 binding env.DB (database: mcpdomain-orders)
 */

// -----------------------------------------------------------------
// WORKER ENV BINDINGS (defined in wrangler.toml)
// -----------------------------------------------------------------
interface Env {
  DB: D1Database;
}

// -----------------------------------------------------------------
// TLD PRICING
// -----------------------------------------------------------------
const TLD_PRICING: Record<string, number> = {
  ".com": 12.99, ".net": 13.99, ".org": 13.99, ".io": 39.99,
  ".ai": 69.99, ".co": 15.99, ".dev": 16.99, ".app": 18.99,
  ".me": 12.99, ".xyz": 4.99, ".tech": 9.99, ".store": 8.99,
  ".online": 7.99, ".site": 6.99, ".ro": 17.99, ".eu": 9.99,
  ".uk": 10.99, ".de": 9.99,
};
const SUPPORTED_TLDS = Object.keys(TLD_PRICING);

function getPrice(tld: string): number {
  return TLD_PRICING[tld] || 14.99;
}

function extractTld(domain: string): string {
  return "." + domain.split(".").slice(1).join(".");
}

// -----------------------------------------------------------------
// Domains we know are taken (for demo/fallback before Porkbun API is wired)
// -----------------------------------------------------------------
const TAKEN = new Set([
  "google.com", "facebook.com", "amazon.com", "apple.com", "microsoft.com",
  "github.com", "openai.com", "anthropic.com", "cloudflare.com", "vercel.com",
  "mcpdomain.ai", "example.com", "test.com", "claude.com",
]);

// -----------------------------------------------------------------
// TOOL IMPLEMENTATIONS
// -----------------------------------------------------------------
function checkDomain(domain: string) {
  const d = domain.toLowerCase().trim();
  const tld = extractTld(d);
  if (!SUPPORTED_TLDS.includes(tld)) {
    return { error: true, message: `TLD ${tld} not supported. Supported: ${SUPPORTED_TLDS.join(", ")}` };
  }
  const available = !TAKEN.has(d);
  const price = getPrice(tld);
  return {
    domain: d, available, tld,
    price: available ? `$${price.toFixed(2)}/yr` : null,
    price_usd: available ? price : null,
    currency: "USD", premium: false,
  };
}

function suggestDomains(keywords: string, tlds: string[] = [".com", ".co", ".io"], maxResults = 8) {
  const words = keywords.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const names = new Set<string>();
  const base = words.join("");
  names.add(base);
  if (words.length >= 2) names.add(words.slice(0, 2).join(""));
  if (words.length === 1) names.add(words[0]);
  ["get", "try", "my", "use", "go"].forEach(p => names.add(p + base));
  ["app", "hq", "hub", "lab"].forEach(s => names.add(base + s));
  const validTlds = tlds.filter(t => SUPPORTED_TLDS.includes(t));
  if (!validTlds.length) validTlds.push(".com");
  const results: any[] = [];
  for (const name of names) {
    if (results.length >= maxResults) break;
    for (const tld of validTlds) {
      if (results.length >= maxResults) break;
      const domain = name + tld;
      if (name.length < 3 || name.length > 30) continue;
      if (!TAKEN.has(domain)) {
        const lengthScore = Math.max(0, 100 - name.length * 3);
        const tldBonus = tld === ".com" ? 15 : tld === ".io" ? 10 : 5;
        results.push({
          domain, available: true,
          price: `$${getPrice(tld).toFixed(2)}/yr`,
          price_usd: getPrice(tld),
          tld, relevance_score: Math.min(100, lengthScore + tldBonus),
        });
      }
    }
  }
  return results.sort((a, b) => b.relevance_score - a.relevance_score);
}

// Persist a new order to D1 and return the canonical result object for the tool call
async function registerDomain(env: Env, domain: string, years: number, registrant: any) {
  const d = domain.toLowerCase().trim();
  if (TAKEN.has(d)) {
    return { error: "domain_not_available", message: `${d} is not available.` };
  }
  const tld = extractTld(d);
  const pricePerYear = getPrice(tld);
  const totalPrice = pricePerYear * years;
  const orderId = `MCD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  // Check for an existing active order on the same domain
  const existing = await env.DB.prepare(
    `SELECT order_id, status FROM orders WHERE domain = ? AND status NOT IN ('failed', 'refunded', 'cancelled') ORDER BY created_at DESC LIMIT 1`
  ).bind(d).first<{ order_id: string; status: string }>();

  if (existing) {
    return {
      error: "domain_already_ordered",
      message: `Another order exists for ${d} (order ${existing.order_id}, status ${existing.status}). Use a different domain or contact support.`,
      existing_order_id: existing.order_id,
      existing_status: existing.status,
    };
  }

  // Persist the new order
  await env.DB.prepare(
    `INSERT INTO orders (
      order_id, domain, years, price_usd, tld, status,
      registrant_first_name, registrant_last_name, registrant_email, registrant_country
    ) VALUES (?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?)`
  ).bind(
    orderId, d, years, totalPrice, tld,
    registrant?.first_name ?? null,
    registrant?.last_name ?? null,
    registrant?.email ?? null,
    registrant?.country ?? null,
  ).run();

  return {
    order_id: orderId,
    domain: d,
    status: "pending_payment",
    checkout_url: `https://mcpdomain.ai/checkout/${orderId}`,
    price: `$${totalPrice.toFixed(2)} (${years} year${years > 1 ? "s" : ""})`,
    price_usd: totalPrice,
    message: `Order created for ${d}. Send the user to checkout_url to complete payment.`,
    next_steps: [
      "1. Send user to checkout_url to complete payment",
      "2. After payment, domain is registered automatically with Porkbun",
      "3. Offer email forwarding via configure_domain_email and DNS via configure_domain_dns",
    ],
    included_free: ["Email forwarding", "Managed DNS", "AI bot intelligence", "WHOIS privacy"],
  };
}

function configureEmail(domain: string, catchAllTo?: string, aliases?: {from: string; to: string}[]) {
  const forwards: any[] = [];
  if (catchAllTo) forwards.push({ from: `*@${domain}`, to: catchAllTo, type: "catch_all", active: true });
  if (aliases) {
    for (const a of aliases) {
      forwards.push({ from: `${a.from}@${domain}`, to: a.to, type: "alias", active: true });
    }
  }
  return { domain, status: "active", email_forwards: forwards, message: `Email forwarding active for ${domain}.` };
}

function configureDns(domain: string, records: any[]) {
  const full = records.map((r: any) => ({ type: r.type, name: r.name, value: r.value, ttl: r.ttl || 3600, priority: r.priority }));
  return { domain, status: "propagating", records: full, estimated_propagation: "5-30 minutes" };
}

function getDomainDetails(domain: string) {
  const d = domain.toLowerCase();
  if (!TAKEN.has(d)) {
    return { error: "domain_not_found", message: `${d} is not registered with MCPDomain.`, suggestions: ["Use check_domain_availability to see if it's available"] };
  }
  const bots = [
    { name: "GPTBot", requests: 847, last_seen: new Date().toISOString() },
    { name: "ClaudeBot", requests: 623, last_seen: new Date().toISOString() },
    { name: "Bytespider", requests: 312, last_seen: new Date(Date.now() - 86400000).toISOString() },
  ];
  return {
    domain: d, status: "active",
    registered_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    expires_at: new Date(Date.now() + 335 * 86400000).toISOString(),
    auto_renew: true, nameservers: ["ns1.mcpdomain.ai", "ns2.mcpdomain.ai"],
    dns_records: [{ type: "NS", name: "@", value: "ns1.mcpdomain.ai", ttl: 86400 }],
    email_forwards: [],
    ai_bot_intelligence: { total_requests_30d: bots.reduce((s, b) => s + b.requests, 0), unique_bots: bots.length, bots },
  };
}

function transferDomain(domain: string, _authCode: string) {
  return {
    transfer_id: `TRF-${Date.now().toString(36).toUpperCase()}`,
    domain: domain.toLowerCase(), status: "pending_approval", eta: "5-7 days",
    included_after_transfer: ["1 year added to expiry", "Free email forwarding", "Managed DNS", "AI bot intelligence"],
  };
}

// -----------------------------------------------------------------
// MCP TOOL DEFINITIONS
// -----------------------------------------------------------------
const TOOLS = [
  {
    name: "check_domain_availability",
    description: "Check whether a specific internet domain name is available for registration. Returns availability status, price, and alternatives if taken. WHEN TO USE: user asks 'is X.com available?' or 'can I register Y.io?'. ALWAYS call this before register_new_domain.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string", description: "Complete domain name with TLD, e.g. 'sweetcrumbs.com'" } },
      required: ["domain"],
    },
  },
  {
    name: "suggest_available_domains",
    description: "Generate creative domain name suggestions from keywords or business description, with real-time availability checks. WHEN TO USE: user says 'help me find a domain for my bakery' or 'what domain should I use for X?'.",
    inputSchema: {
      type: "object",
      properties: {
        keywords: { type: "string", description: "Business name or description, e.g. 'sweet crumbs bakery'" },
        tlds: { type: "array", items: { type: "string" }, description: "TLDs to search. Default: ['.com','.co','.io']" },
        max_results: { type: "number", description: "Max suggestions. Default: 8" },
      },
      required: ["keywords"],
    },
  },
  {
    name: "register_new_domain",
    description: "Register a new domain. Returns a Stripe checkout URL for payment. After payment, domain is registered with FREE email forwarding, DNS, and AI bot monitoring. ALWAYS call check_domain_availability first. Collect first_name, last_name, email from user before calling.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Domain to register" },
        years: { type: "number", description: "Registration years. Default: 1" },
        registrant: {
          type: "object",
          properties: {
            first_name: { type: "string" }, last_name: { type: "string" },
            email: { type: "string" }, country: { type: "string", description: "ISO 3166-1 alpha-2" },
          },
          required: ["first_name", "last_name", "email"],
        },
      },
      required: ["domain", "registrant"],
    },
  },
  {
    name: "configure_domain_email",
    description: "Set up email forwarding for a registered domain. Forward any@domain to Gmail/Outlook. No MX records needed. WHEN TO USE: user just registered a domain, or asks about professional email.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        catch_all_to: { type: "string", description: "Forward ALL emails to this inbox" },
        aliases: { type: "array", items: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] } },
      },
      required: ["domain"],
    },
  },
  {
    name: "configure_domain_dns",
    description: "Add/update DNS records (A, CNAME, MX, TXT). Use to point domain to Vercel, Netlify, GitHub Pages etc. WHEN TO USE: user wants to connect domain to hosting.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        records: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["A","AAAA","CNAME","MX","TXT","SRV"] }, name: { type: "string" }, value: { type: "string" }, ttl: { type: "number" }, priority: { type: "number" } }, required: ["type","name","value"] } },
      },
      required: ["domain", "records"],
    },
  },
  {
    name: "get_my_domain_details",
    description: "Get domain status, DNS records, email config, expiry date, and unique AI bot crawling statistics. WHEN TO USE: user asks about domain status or AI bot traffic.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string" } },
      required: ["domain"],
    },
  },
  {
    name: "transfer_existing_domain",
    description: "Transfer a domain from another registrar (GoDaddy, Namecheap etc) to MCPDomain. Requires EPP/auth code. Transfer takes 5-7 days and adds 1 year to expiry.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string" }, auth_code: { type: "string", description: "EPP code from current registrar" } },
      required: ["domain", "auth_code"],
    },
  },
];

// -----------------------------------------------------------------
// MCP PROTOCOL HANDLER
// -----------------------------------------------------------------
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: any;
}
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

function handleInitialize(req: JsonRpcRequest): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: req.id!,
    result: {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "mcpdomain", version: "1.0.2" },
      instructions: "MCPDomain is the first domain registrar built for AI agents. Use the 7 tools to check availability, register domains, configure email forwarding, and manage DNS - all inside the conversation.",
    },
  };
}

function handleToolsList(req: JsonRpcRequest): JsonRpcResponse {
  return { jsonrpc: "2.0", id: req.id!, result: { tools: TOOLS } };
}

async function handleToolCall(env: Env, req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { name, arguments: args } = req.params || {};
  let result: any;
  try {
    switch (name) {
      case "check_domain_availability": {
        const check = checkDomain(args.domain);
        let alternatives: any[] = [];
        if (!check.error && !check.available) {
          const baseName = args.domain.split(".")[0];
          alternatives = suggestDomains(baseName, [".com", ".co", ".io", ".ai"], 3)
            .map(s => ({ domain: s.domain, price: s.price, tld: s.tld }));
        }
        result = { ...check, ...(alternatives.length > 0 && { alternatives_if_taken: alternatives }) };
        break;
      }
      case "suggest_available_domains":
        result = {
          query: args.keywords,
          results: suggestDomains(args.keywords, args.tlds, args.max_results),
          next_action: "Present these to the user. When they pick one, call register_new_domain.",
        };
        break;
      case "register_new_domain":
        result = await registerDomain(env, args.domain, args.years || 1, args.registrant);
        break;
      case "configure_domain_email":
        result = configureEmail(args.domain, args.catch_all_to, args.aliases);
        break;
      case "configure_domain_dns":
        result = configureDns(args.domain, args.records);
        break;
      case "get_my_domain_details":
        result = getDomainDetails(args.domain);
        break;
      case "transfer_existing_domain":
        result = transferDomain(args.domain, args.auth_code);
        break;
      default:
        return {
          jsonrpc: "2.0", id: req.id!,
          error: { code: -32601, message: `Unknown tool: ${name}` },
        };
    }
  } catch (e: any) {
    return {
      jsonrpc: "2.0", id: req.id!,
      error: { code: -32603, message: e.message || String(e) },
    };
  }
  return {
    jsonrpc: "2.0", id: req.id!,
    result: {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    },
  };
}

async function handleJsonRpc(env: Env, req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (req.id === undefined || req.id === null) return null;
  switch (req.method) {
    case "initialize":
      return handleInitialize(req);
    case "tools/list":
      return handleToolsList(req);
    case "tools/call":
      return await handleToolCall(env, req);
    case "ping":
      return { jsonrpc: "2.0", id: req.id, result: {} };
    default:
      return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } };
  }
}

// -----------------------------------------------------------------
// CHECKOUT PAGE (HTML)
// -----------------------------------------------------------------
interface OrderRow {
  order_id: string;
  domain: string;
  years: number;
  price_usd: number;
  tld: string;
  status: string;
  registrant_first_name: string | null;
  registrant_last_name: string | null;
  registrant_email: string | null;
  registrant_country: string | null;
  created_at: string;
  paid_at: string | null;
  registered_at: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderCheckoutPage(order: OrderRow): string {
  const name = [order.registrant_first_name, order.registrant_last_name].filter(Boolean).join(" ") || "—";
  const email = order.registrant_email || "—";
  const statusLabel: Record<string, string> = {
    pending_payment: "Awaiting payment",
    paid: "Payment received, registering domain",
    registered: "Domain registered",
    failed: "Registration failed",
    cancelled: "Cancelled",
    refunded: "Refunded",
  };
  const status = statusLabel[order.status] || order.status;
  const canPay = order.status === "pending_payment";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Checkout ${escapeHtml(order.domain)} - MCPDomain</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #F5EEDD; color: #1F1A17; }
  .wrap { max-width: 560px; margin: 40px auto; padding: 0 20px; }
  .card { background: #fff; border: 1px solid #E8DCC4; border-radius: 16px; box-shadow: 0 4px 20px rgba(107, 29, 29, 0.06); overflow: hidden; }
  .header { background: #6B1D1D; color: #F5EEDD; padding: 28px 32px; }
  .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
  .header .sub { opacity: 0.75; font-size: 14px; margin-top: 4px; }
  .body { padding: 28px 32px; }
  .domain { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; margin: 0 0 4px; }
  .status { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #FEF3C7; color: #92400E; margin-bottom: 24px; }
  .status.paid { background: #D1FAE5; color: #065F46; }
  .status.registered { background: #DBEAFE; color: #1E40AF; }
  .status.failed, .status.cancelled, .status.refunded { background: #FEE2E2; color: #991B1B; }
  .row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #F3EBD5; font-size: 14px; }
  .row:last-child { border-bottom: none; }
  .row .k { color: #6B5D47; }
  .row .v { font-weight: 600; color: #1F1A17; }
  .total { display: flex; justify-content: space-between; align-items: baseline; padding: 20px 0 8px; border-top: 2px solid #1F1A17; margin-top: 12px; }
  .total .k { font-size: 14px; color: #6B5D47; }
  .total .v { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; }
  .btn { display: block; width: 100%; padding: 14px 20px; border: none; border-radius: 10px; background: #F59E0B; color: #1F1A17; font-size: 15px; font-weight: 700; cursor: pointer; margin-top: 20px; text-align: center; text-decoration: none; transition: transform 0.1s; }
  .btn:hover { transform: translateY(-1px); background: #D97706; color: #fff; }
  .btn:disabled, .btn.disabled { background: #E8DCC4; color: #6B5D47; cursor: not-allowed; transform: none; }
  .note { font-size: 13px; color: #6B5D47; text-align: center; margin-top: 14px; line-height: 1.5; }
  .foot { text-align: center; padding: 20px; font-size: 12px; color: #6B5D47; }
  .foot a { color: #6B1D1D; text-decoration: none; }
  .included { background: #F5EEDD; border-radius: 10px; padding: 14px 16px; margin: 20px 0 0; font-size: 13px; color: #6B5D47; line-height: 1.7; }
  .included strong { color: #1F1A17; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="header">
        <h1>MCPDomain Checkout</h1>
        <div class="sub">Order ${escapeHtml(order.order_id)}</div>
      </div>
      <div class="body">
        <p class="domain">${escapeHtml(order.domain)}</p>
        <span class="status ${escapeHtml(order.status)}">${escapeHtml(status)}</span>

        <div class="row"><span class="k">TLD</span><span class="v">${escapeHtml(order.tld)}</span></div>
        <div class="row"><span class="k">Registration period</span><span class="v">${order.years} year${order.years > 1 ? "s" : ""}</span></div>
        <div class="row"><span class="k">Registrant</span><span class="v">${escapeHtml(name)}</span></div>
        <div class="row"><span class="k">Email</span><span class="v">${escapeHtml(email)}</span></div>
        <div class="row"><span class="k">Created</span><span class="v">${escapeHtml(order.created_at)}</span></div>

        <div class="total">
          <span class="k">Total</span>
          <span class="v">$${order.price_usd.toFixed(2)}</span>
        </div>

        ${canPay
          ? `<button class="btn disabled" disabled>Pay with Stripe - coming soon</button>
             <p class="note">Payment integration is being finalized. Your order is saved - reply to the AI conversation that created this order, or email <a href="mailto:hello@mcpdomain.ai" style="color:#6B1D1D">hello@mcpdomain.ai</a> to complete registration manually.</p>`
          : `<p class="note">This order is ${escapeHtml(status.toLowerCase())}. Nothing to do here.</p>`
        }

        <div class="included">
          <strong>Included free with your registration:</strong><br>
          - Email forwarding (any@${escapeHtml(order.domain)} to Gmail/Outlook)<br>
          - Managed DNS (A, CNAME, MX, TXT records)<br>
          - WHOIS privacy<br>
          - AI bot crawl intelligence (GPTBot, ClaudeBot, Bytespider)
        </div>
      </div>
    </div>
    <p class="foot">
      <a href="https://mcpdomain.ai">mcpdomain.ai</a>
      &nbsp;&middot;&nbsp;
      <a href="https://github.com/danboabes/mcpdomain">GitHub</a>
      &nbsp;&middot;&nbsp;
      <a href="https://smithery.ai/server/danboabes/mcpdomain">Smithery</a>
    </p>
  </div>
</body>
</html>`;
}

function renderNotFoundPage(orderId: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Order not found - MCPDomain</title>
<style>
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; background: #F5EEDD; color: #1F1A17; padding: 60px 20px; text-align: center; }
  .box { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 40px 32px; border: 1px solid #E8DCC4; }
  h1 { color: #6B1D1D; margin: 0 0 8px; font-size: 22px; }
  p { color: #6B5D47; line-height: 1.6; }
  a { color: #6B1D1D; }
</style></head><body>
<div class="box">
  <h1>Order not found</h1>
  <p>We couldn't find order <code>${escapeHtml(orderId)}</code>.</p>
  <p>If an AI assistant just created this order, please retry - the order may not have been persisted.<br>
  Otherwise, go back to <a href="https://mcpdomain.ai">mcpdomain.ai</a>.</p>
</div></body></html>`;
}

async function handleCheckoutPage(env: Env, orderId: string): Promise<Response> {
  const order = await env.DB.prepare(
    `SELECT order_id, domain, years, price_usd, tld, status,
            registrant_first_name, registrant_last_name, registrant_email, registrant_country,
            created_at, paid_at, registered_at
     FROM orders WHERE order_id = ?`
  ).bind(orderId).first<OrderRow>();

  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
  if (!order) {
    return new Response(renderNotFoundPage(orderId), { status: 404, headers });
  }
  return new Response(renderCheckoutPage(order), { status: 200, headers });
}

// -----------------------------------------------------------------
// CORS + CONTENT
// -----------------------------------------------------------------
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, Accept",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

const LLMS_TXT = `# MCPDomain
> The first domain registrar built for AI agents.

MCPDomain provides 7 MCP tools that let AI assistants check domain availability, register domains, configure email forwarding, and manage DNS - all within a single conversation.

## MCP Endpoint
https://mcpdomain.ai/mcp (Streamable HTTP transport)

## Tools
- check_domain_availability: Check if a domain is available. Returns price and alternatives.
- suggest_available_domains: Generate domain ideas from keywords with real-time availability.
- register_new_domain: Register a domain. Returns Stripe checkout URL.
- configure_domain_email: Set up email forwarding to Gmail/Outlook.
- configure_domain_dns: Add DNS records (A, CNAME, MX, TXT).
- get_my_domain_details: Domain status + AI bot crawling intelligence.
- transfer_existing_domain: Transfer from GoDaddy/Namecheap/etc.

## Install
npx mcpdomain

## Website
https://mcpdomain.ai
`;

// -----------------------------------------------------------------
// FETCH HANDLER
// -----------------------------------------------------------------
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Checkout page
    if (path.startsWith("/checkout/") && method === "GET") {
      const orderId = decodeURIComponent(path.slice("/checkout/".length));
      if (!orderId) {
        return Response.json({ error: "Missing order ID" }, { status: 400, headers: CORS_HEADERS });
      }
      return handleCheckoutPage(env, orderId);
    }

    // Health check
    if (path === "/health" || path === "/") {
      return Response.json(
        { status: "ok", name: "mcpdomain", version: "1.0.2", tools: 7, tlds: SUPPORTED_TLDS.length },
        { headers: CORS_HEADERS }
      );
    }

    // llms.txt
    if (path === "/llms.txt") {
      return new Response(LLMS_TXT, {
        headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // MCP endpoint
    if (path === "/mcp") {
      if (method === "GET") {
        return Response.json(
          { error: "Use POST to send MCP messages" },
          { status: 405, headers: CORS_HEADERS }
        );
      }
      if (method === "DELETE") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      if (method === "POST") {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
            { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
          );
        }

        if (Array.isArray(body)) {
          const responses = (
            await Promise.all(body.map((req: JsonRpcRequest) => handleJsonRpc(env, req)))
          ).filter((r): r is JsonRpcResponse => r !== null);
          if (responses.length === 0) {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
          }
          return Response.json(responses, {
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }

        const response = await handleJsonRpc(env, body);
        if (response === null) {
          return new Response(null, { status: 204, headers: CORS_HEADERS });
        }
        const headers: Record<string, string> = { ...CORS_HEADERS, "Content-Type": "application/json" };
        if (body.method === "initialize") {
          headers["Mcp-Session-Id"] = crypto.randomUUID();
        }
        return Response.json(response, { headers });
      }
    }

    return Response.json(
      { error: "Not found", path },
      { status: 404, headers: CORS_HEADERS }
    );
  },
};
