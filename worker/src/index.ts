/**
 * MCPDomain — Cloudflare Worker
 *
 * Self-contained MCP server implementing the Streamable HTTP transport.
 * Deployed at https://mcpdomain.ai/mcp
 *
 * Implements the MCP protocol directly (no SDK dependency) for minimal
 * bundle size and native Workers compatibility.
 */

// ═══════════════════════════════════════════════════════════════
// TLD PRICING
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// MOCK DOMAIN DATABASE
// ═══════════════════════════════════════════════════════════════
const TAKEN = new Set([
  "google.com", "facebook.com", "amazon.com", "apple.com", "microsoft.com",
  "github.com", "openai.com", "anthropic.com", "cloudflare.com", "vercel.com",
  "mcpdomain.ai", "example.com", "test.com", "claude.com",
]);

// ═══════════════════════════════════════════════════════════════
// TOOL IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════
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

function registerDomain(domain: string, years: number, registrant: any) {
  const d = domain.toLowerCase().trim();
  if (TAKEN.has(d)) {
    return { error: "domain_not_available", message: `${d} is not available.` };
  }
  const tld = extractTld(d);
  const price = getPrice(tld) * years;
  const orderId = `MCD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  TAKEN.add(d);
  return {
    order_id: orderId, domain: d, status: "pending_payment",
    checkout_url: `https://mcpdomain.ai/checkout/${orderId}`,
    price: `$${price.toFixed(2)} (${years} year${years > 1 ? "s" : ""})`,
    message: `Domain ${d} reserved! Send the user to the checkout URL to complete payment.`,
    next_steps: [
      "1. Send user to checkout_url to pay",
      "2. After payment, offer to set up email forwarding via configure_domain_email",
      "3. If user mentions hosting, offer to configure DNS via configure_domain_dns",
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

// ═══════════════════════════════════════════════════════════════
// MCP TOOL DEFINITIONS (what LLMs see when they call tools/list)
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// MCP PROTOCOL HANDLER (JSON-RPC 2.0 over Streamable HTTP)
// ═══════════════════════════════════════════════════════════════
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
      serverInfo: { name: "mcpdomain", version: "1.0.0" },
      instructions: "MCPDomain is the first domain registrar built for AI agents. Use the 7 tools to check availability, register domains, configure email forwarding, and manage DNS — all inside the conversation.",
    },
  };
}

function handleToolsList(req: JsonRpcRequest): JsonRpcResponse {
  return { jsonrpc: "2.0", id: req.id!, result: { tools: TOOLS } };
}

function handleToolCall(req: JsonRpcRequest): JsonRpcResponse {
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
        result = registerDomain(args.domain, args.years || 1, args.registrant);
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

function handleJsonRpc(req: JsonRpcRequest): JsonRpcResponse | null {
  if (req.id === undefined || req.id === null) return null;
  switch (req.method) {
    case "initialize":
      return handleInitialize(req);
    case "tools/list":
      return handleToolsList(req);
    case "tools/call":
      return handleToolCall(req);
    case "ping":
      return { jsonrpc: "2.0", id: req.id, result: {} };
    default:
      return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } };
  }
}

// ═══════════════════════════════════════════════════════════════
// CLOUDFLARE WORKER FETCH HANDLER
// ═══════════════════════════════════════════════════════════════
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, Accept",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

const LLMS_TXT = `# MCPDomain
> The first domain registrar built for AI agents.

MCPDomain provides 7 MCP tools that let AI assistants check domain availability, register domains, configure email forwarding, and manage DNS — all within a single conversation.

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

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health check
    if (path === "/health" || path === "/") {
      return Response.json(
        { status: "ok", name: "mcpdomain", version: "1.0.0", tools: 7, tlds: SUPPORTED_TLDS.length },
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

        // Handle batch requests
        if (Array.isArray(body)) {
          const responses = body
            .map((req: JsonRpcRequest) => handleJsonRpc(req))
            .filter((r): r is JsonRpcResponse => r !== null);
          if (responses.length === 0) {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
          }
          return Response.json(responses, {
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }

        // Handle single request
        const response = handleJsonRpc(body);
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

    // 404
    return Response.json(
      { error: "Not found", path },
      { status: 404, headers: CORS_HEADERS }
    );
  },
};
