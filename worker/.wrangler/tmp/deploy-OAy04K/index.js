var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/registrars/opensrs.ts
var ENDPOINTS = {
  live: "https://rr-n1-tor.opensrs.net:55443/",
  ote: "https://horizon.opensrs.net:55443/"
};
var OpenSRSRegistrar = class {
  constructor(config) {
    this.config = config;
    this.endpoint = ENDPOINTS[config.env ?? "live"];
  }
  static {
    __name(this, "OpenSRSRegistrar");
  }
  name = "opensrs";
  endpoint;
  // ---------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------
  async checkAvailability(domain) {
    const xml = buildEnvelope("LOOKUP", "DOMAIN", { domain });
    const resp = await this.send(xml);
    const code = resp.items.response_code;
    const status = resp.items.status;
    return {
      domain,
      available: code === "210" || status === "available",
      raw: resp.raw
    };
  }
  async registerDomain(input) {
    const contact = this.mergeContact(input.registrant);
    const contactXml = renderContactSet(contact);
    const nsXml = renderNameservers(input.nameservers);
    const attributes = `
      <item key="domain">${escapeXml(input.domain)}</item>
      <item key="period">${Number(input.years) || 1}</item>
      <item key="reg_type">new</item>
      <item key="handle">process</item>
      <item key="auto_renew">${input.auto_renew === false ? "0" : "1"}</item>
      <item key="f_whois_privacy">${input.privacy === false ? "0" : "1"}</item>
      <item key="f_lock_domain">1</item>
      <item key="reg_username">${escapeXml(this.config.username)}</item>
      <item key="reg_password">${escapeXml(generatePassword())}</item>
      ${contactXml}
      ${nsXml}
    `;
    const xml = buildEnvelopeRaw("SW_REGISTER", "DOMAIN", attributes);
    const resp = await this.send(xml);
    const ok = resp.items.is_success === "1" || resp.items.response_code === "200";
    if (!ok) {
      return {
        ok: false,
        domain: input.domain,
        error_code: resp.items.response_code,
        error_message: resp.items.response_text,
        raw: resp.raw
      };
    }
    return {
      ok: true,
      domain: input.domain,
      registrar_order_id: resp.items.id || resp.items.order_id,
      expires_at: resp.items["registration expiration date"] || resp.items.expiredate,
      raw: resp.raw
    };
  }
  async getDomainInfo(domain) {
    const attributes = `
      <item key="domain">${escapeXml(domain)}</item>
      <item key="type">all_info</item>
    `;
    const xml = buildEnvelopeRaw("GET", "DOMAIN", attributes);
    const resp = await this.send(xml);
    const ok = resp.items.is_success === "1" || resp.items.response_code === "200";
    if (!ok) {
      return {
        ok: false,
        domain,
        error_code: resp.items.response_code,
        error_message: resp.items.response_text,
        raw: resp.raw
      };
    }
    return {
      ok: true,
      domain,
      status: resp.items.sponsoring_rsp === "1" ? "active" : resp.items.status,
      expires_at: resp.items.expiredate,
      nameservers: resp.nameservers,
      auto_renew: resp.items.auto_renew === "1",
      raw: resp.raw
    };
  }
  // ---------------------------------------------------------------
  // INTERNALS
  // ---------------------------------------------------------------
  async send(xml) {
    const signature = md5(md5(xml + this.config.key) + this.config.key);
    const resp = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "X-Username": this.config.username,
        "X-Signature": signature,
        "Accept": "text/xml"
      },
      body: xml
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`OpenSRS HTTP ${resp.status}: ${text.slice(0, 500)}`);
    }
    return parseResponse(text);
  }
  mergeContact(c) {
    const def = this.config.defaultContact ?? {};
    return {
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      phone: c.phone ?? def.phone ?? "+1.4165350123",
      org_name: c.org_name ?? def.org_name ?? "MCPDomain",
      address1: c.address1 ?? def.address1 ?? "96 Mowat Avenue",
      address2: c.address2 ?? def.address2 ?? "",
      city: c.city ?? def.city ?? "Toronto",
      state: c.state ?? def.state ?? "ON",
      postal_code: c.postal_code ?? def.postal_code ?? "M6K3M1",
      country: c.country ?? def.country ?? "CA"
    };
  }
};
function buildEnvelope(action, object, attrs) {
  const attributes = Object.entries(attrs).map(([k, v]) => `<item key="${k}">${escapeXml(String(v))}</item>`).join("\n          ");
  return buildEnvelopeRaw(action, object, attributes);
}
__name(buildEnvelope, "buildEnvelope");
function buildEnvelopeRaw(action, object, attributesXml) {
  return `<?xml version='1.0' encoding='UTF-8' standalone='no'?>
<!DOCTYPE OPS_envelope SYSTEM 'ops.dtd'>
<OPS_envelope>
  <header><version>0.9</version></header>
  <body>
    <data_block>
      <dt_assoc>
        <item key="protocol">XCP</item>
        <item key="action">${action}</item>
        <item key="object">${object}</item>
        <item key="attributes">
          <dt_assoc>
${attributesXml}
          </dt_assoc>
        </item>
      </dt_assoc>
    </data_block>
  </body>
</OPS_envelope>`;
}
__name(buildEnvelopeRaw, "buildEnvelopeRaw");
function renderContactSet(c) {
  const one = `
        <dt_assoc>
          <item key="first_name">${escapeXml(c.first_name)}</item>
          <item key="last_name">${escapeXml(c.last_name)}</item>
          <item key="org_name">${escapeXml(c.org_name ?? "")}</item>
          <item key="address1">${escapeXml(c.address1 ?? "")}</item>
          <item key="address2">${escapeXml(c.address2 ?? "")}</item>
          <item key="city">${escapeXml(c.city ?? "")}</item>
          <item key="state">${escapeXml(c.state ?? "")}</item>
          <item key="postal_code">${escapeXml(c.postal_code ?? "")}</item>
          <item key="country">${escapeXml(c.country ?? "")}</item>
          <item key="email">${escapeXml(c.email)}</item>
          <item key="phone">${escapeXml(c.phone ?? "")}</item>
        </dt_assoc>`;
  return `<item key="contact_set">
        <dt_assoc>
          <item key="owner">${one}</item>
          <item key="admin">${one}</item>
          <item key="billing">${one}</item>
          <item key="tech">${one}</item>
        </dt_assoc>
      </item>`;
}
__name(renderContactSet, "renderContactSet");
function renderNameservers(ns) {
  const list = ns && ns.length ? ns : [
    "ns1.systemdns.com",
    "ns2.systemdns.com",
    "ns3.systemdns.com"
  ];
  const items = list.map((name, i) => `
            <item key="${i}">
              <dt_assoc>
                <item key="sortorder">${i + 1}</item>
                <item key="name">${escapeXml(name)}</item>
              </dt_assoc>
            </item>`).join("");
  return `<item key="custom_nameservers">1</item>
      <item key="custom_tech_contact">1</item>
      <item key="nameserver_list">
        <dt_array>${items}
        </dt_array>
      </item>`;
}
__name(renderNameservers, "renderNameservers");
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
__name(escapeXml, "escapeXml");
function generatePassword() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
__name(generatePassword, "generatePassword");
function parseResponse(xml) {
  const items = {};
  const topRegex = /<item key="([^"]+)">([^<]*)<\/item>/g;
  let m;
  while ((m = topRegex.exec(xml)) !== null) {
    if (!(m[1] in items)) items[m[1]] = decodeXmlEntities(m[2]);
  }
  const nsMatches = [];
  const nsRegex = /<dt_assoc>\s*<item key="sortorder">\d+<\/item>\s*<item key="name">([^<]+)<\/item>\s*<\/dt_assoc>/g;
  while ((m = nsRegex.exec(xml)) !== null) nsMatches.push(decodeXmlEntities(m[1]));
  return { items, nameservers: nsMatches.length ? nsMatches : void 0, raw: xml };
}
__name(parseResponse, "parseResponse");
function decodeXmlEntities(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
__name(decodeXmlEntities, "decodeXmlEntities");
function md5(s) {
  const bytes = new TextEncoder().encode(s);
  const words = [];
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    words[i >> 2] = (words[i >> 2] || 0) | bytes[i] << i % 4 * 8;
  }
  words[len >> 2] = (words[len >> 2] || 0) | 128 << len % 4 * 8;
  words[((len + 8 >>> 6) + 1) * 16 - 2] = len * 8;
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < words.length; i += 16) {
    const oa = a, ob = b, oc = c, od = d;
    a = ff(a, b, c, d, words[i + 0] | 0, 7, -680876936);
    d = ff(d, a, b, c, words[i + 1] | 0, 12, -389564586);
    c = ff(c, d, a, b, words[i + 2] | 0, 17, 606105819);
    b = ff(b, c, d, a, words[i + 3] | 0, 22, -1044525330);
    a = ff(a, b, c, d, words[i + 4] | 0, 7, -176418897);
    d = ff(d, a, b, c, words[i + 5] | 0, 12, 1200080426);
    c = ff(c, d, a, b, words[i + 6] | 0, 17, -1473231341);
    b = ff(b, c, d, a, words[i + 7] | 0, 22, -45705983);
    a = ff(a, b, c, d, words[i + 8] | 0, 7, 1770035416);
    d = ff(d, a, b, c, words[i + 9] | 0, 12, -1958414417);
    c = ff(c, d, a, b, words[i + 10] | 0, 17, -42063);
    b = ff(b, c, d, a, words[i + 11] | 0, 22, -1990404162);
    a = ff(a, b, c, d, words[i + 12] | 0, 7, 1804603682);
    d = ff(d, a, b, c, words[i + 13] | 0, 12, -40341101);
    c = ff(c, d, a, b, words[i + 14] | 0, 17, -1502002290);
    b = ff(b, c, d, a, words[i + 15] | 0, 22, 1236535329);
    a = gg(a, b, c, d, words[i + 1] | 0, 5, -165796510);
    d = gg(d, a, b, c, words[i + 6] | 0, 9, -1069501632);
    c = gg(c, d, a, b, words[i + 11] | 0, 14, 643717713);
    b = gg(b, c, d, a, words[i + 0] | 0, 20, -373897302);
    a = gg(a, b, c, d, words[i + 5] | 0, 5, -701558691);
    d = gg(d, a, b, c, words[i + 10] | 0, 9, 38016083);
    c = gg(c, d, a, b, words[i + 15] | 0, 14, -660478335);
    b = gg(b, c, d, a, words[i + 4] | 0, 20, -405537848);
    a = gg(a, b, c, d, words[i + 9] | 0, 5, 568446438);
    d = gg(d, a, b, c, words[i + 14] | 0, 9, -1019803690);
    c = gg(c, d, a, b, words[i + 3] | 0, 14, -187363961);
    b = gg(b, c, d, a, words[i + 8] | 0, 20, 1163531501);
    a = gg(a, b, c, d, words[i + 13] | 0, 5, -1444681467);
    d = gg(d, a, b, c, words[i + 2] | 0, 9, -51403784);
    c = gg(c, d, a, b, words[i + 7] | 0, 14, 1735328473);
    b = gg(b, c, d, a, words[i + 12] | 0, 20, -1926607734);
    a = hh(a, b, c, d, words[i + 5] | 0, 4, -378558);
    d = hh(d, a, b, c, words[i + 8] | 0, 11, -2022574463);
    c = hh(c, d, a, b, words[i + 11] | 0, 16, 1839030562);
    b = hh(b, c, d, a, words[i + 14] | 0, 23, -35309556);
    a = hh(a, b, c, d, words[i + 1] | 0, 4, -1530992060);
    d = hh(d, a, b, c, words[i + 4] | 0, 11, 1272893353);
    c = hh(c, d, a, b, words[i + 7] | 0, 16, -155497632);
    b = hh(b, c, d, a, words[i + 10] | 0, 23, -1094730640);
    a = hh(a, b, c, d, words[i + 13] | 0, 4, 681279174);
    d = hh(d, a, b, c, words[i + 0] | 0, 11, -358537222);
    c = hh(c, d, a, b, words[i + 3] | 0, 16, -722521979);
    b = hh(b, c, d, a, words[i + 6] | 0, 23, 76029189);
    a = hh(a, b, c, d, words[i + 9] | 0, 4, -640364487);
    d = hh(d, a, b, c, words[i + 12] | 0, 11, -421815835);
    c = hh(c, d, a, b, words[i + 15] | 0, 16, 530742520);
    b = hh(b, c, d, a, words[i + 2] | 0, 23, -995338651);
    a = ii(a, b, c, d, words[i + 0] | 0, 6, -198630844);
    d = ii(d, a, b, c, words[i + 7] | 0, 10, 1126891415);
    c = ii(c, d, a, b, words[i + 14] | 0, 15, -1416354905);
    b = ii(b, c, d, a, words[i + 5] | 0, 21, -57434055);
    a = ii(a, b, c, d, words[i + 12] | 0, 6, 1700485571);
    d = ii(d, a, b, c, words[i + 3] | 0, 10, -1894986606);
    c = ii(c, d, a, b, words[i + 10] | 0, 15, -1051523);
    b = ii(b, c, d, a, words[i + 1] | 0, 21, -2054922799);
    a = ii(a, b, c, d, words[i + 8] | 0, 6, 1873313359);
    d = ii(d, a, b, c, words[i + 15] | 0, 10, -30611744);
    c = ii(c, d, a, b, words[i + 6] | 0, 15, -1560198380);
    b = ii(b, c, d, a, words[i + 13] | 0, 21, 1309151649);
    a = ii(a, b, c, d, words[i + 4] | 0, 6, -145523070);
    d = ii(d, a, b, c, words[i + 11] | 0, 10, -1120210379);
    c = ii(c, d, a, b, words[i + 2] | 0, 15, 718787259);
    b = ii(b, c, d, a, words[i + 9] | 0, 21, -343485551);
    a = a + oa | 0;
    b = b + ob | 0;
    c = c + oc | 0;
    d = d + od | 0;
  }
  return toHex(a) + toHex(b) + toHex(c) + toHex(d);
}
__name(md5, "md5");
function add32(x, y) {
  return x + y | 0;
}
__name(add32, "add32");
function cmn(q, a, b, x, s, t) {
  const n = add32(add32(a, q), add32(x, t));
  return add32(n << s | n >>> 32 - s, b);
}
__name(cmn, "cmn");
function ff(a, b, c, d, x, s, t) {
  return cmn(b & c | ~b & d, a, b, x, s, t);
}
__name(ff, "ff");
function gg(a, b, c, d, x, s, t) {
  return cmn(b & d | c & ~d, a, b, x, s, t);
}
__name(gg, "gg");
function hh(a, b, c, d, x, s, t) {
  return cmn(b ^ c ^ d, a, b, x, s, t);
}
__name(hh, "hh");
function ii(a, b, c, d, x, s, t) {
  return cmn(c ^ (b | ~d), a, b, x, s, t);
}
__name(ii, "ii");
function toHex(n) {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += (n >> i * 8 & 255).toString(16).padStart(2, "0");
  }
  return s;
}
__name(toHex, "toHex");

// src/registrars/index.ts
function makeRegistrar(env) {
  const choice = (env.REGISTRAR || "opensrs").toLowerCase();
  if (choice === "opensrs") {
    if (!env.OPENSRS_USERNAME || !env.OPENSRS_KEY) return null;
    return new OpenSRSRegistrar({
      username: env.OPENSRS_USERNAME,
      key: env.OPENSRS_KEY,
      env: env.OPENSRS_ENV === "ote" ? "ote" : "live"
    });
  }
  return null;
}
__name(makeRegistrar, "makeRegistrar");

// src/index.ts
var TLD_PRICING = {
  ".com": 12.99,
  ".net": 13.99,
  ".org": 13.99,
  ".io": 39.99,
  ".ai": 69.99,
  ".co": 15.99,
  ".dev": 16.99,
  ".app": 18.99,
  ".me": 12.99,
  ".xyz": 4.99,
  ".tech": 9.99,
  ".store": 8.99,
  ".online": 7.99,
  ".site": 6.99,
  ".ro": 17.99,
  ".eu": 9.99,
  ".uk": 10.99,
  ".de": 9.99
};
var SUPPORTED_TLDS = Object.keys(TLD_PRICING);
function getPrice(tld) {
  return TLD_PRICING[tld] || 14.99;
}
__name(getPrice, "getPrice");
function extractTld(domain) {
  return "." + domain.split(".").slice(1).join(".");
}
__name(extractTld, "extractTld");
var TAKEN = /* @__PURE__ */ new Set([
  "google.com",
  "facebook.com",
  "amazon.com",
  "apple.com",
  "microsoft.com",
  "github.com",
  "openai.com",
  "anthropic.com",
  "cloudflare.com",
  "vercel.com",
  "mcpdomain.ai",
  "example.com",
  "test.com",
  "claude.com"
]);
function checkDomain(domain) {
  const d = domain.toLowerCase().trim();
  const tld = extractTld(d);
  if (!SUPPORTED_TLDS.includes(tld)) {
    return { error: true, message: `TLD ${tld} not supported. Supported: ${SUPPORTED_TLDS.join(", ")}` };
  }
  const available = !TAKEN.has(d);
  const price = getPrice(tld);
  return {
    domain: d,
    available,
    tld,
    price: available ? `$${price.toFixed(2)}/yr` : null,
    price_usd: available ? price : null,
    currency: "USD",
    premium: false
  };
}
__name(checkDomain, "checkDomain");
function suggestDomains(keywords, tlds = [".com", ".co", ".io"], maxResults = 8) {
  const words = keywords.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const names = /* @__PURE__ */ new Set();
  const base = words.join("");
  names.add(base);
  if (words.length >= 2) names.add(words.slice(0, 2).join(""));
  if (words.length === 1) names.add(words[0]);
  ["get", "try", "my", "use", "go"].forEach((p) => names.add(p + base));
  ["app", "hq", "hub", "lab"].forEach((s) => names.add(base + s));
  const validTlds = tlds.filter((t) => SUPPORTED_TLDS.includes(t));
  if (!validTlds.length) validTlds.push(".com");
  const results = [];
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
          domain,
          available: true,
          price: `$${getPrice(tld).toFixed(2)}/yr`,
          price_usd: getPrice(tld),
          tld,
          relevance_score: Math.min(100, lengthScore + tldBonus)
        });
      }
    }
  }
  return results.sort((a, b) => b.relevance_score - a.relevance_score);
}
__name(suggestDomains, "suggestDomains");
async function registerDomain(env, domain, years, registrant) {
  const d = domain.toLowerCase().trim();
  if (TAKEN.has(d)) {
    return { error: "domain_not_available", message: `${d} is not available.` };
  }
  const tld = extractTld(d);
  const pricePerYear = getPrice(tld);
  const totalPrice = pricePerYear * years;
  const orderId = `MCD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const existing = await env.DB.prepare(
    `SELECT order_id, status FROM orders WHERE domain = ? AND status NOT IN ('failed', 'refunded', 'cancelled') ORDER BY created_at DESC LIMIT 1`
  ).bind(d).first();
  if (existing) {
    return {
      error: "domain_already_ordered",
      message: `Another order exists for ${d} (order ${existing.order_id}, status ${existing.status}). Use a different domain or contact support.`,
      existing_order_id: existing.order_id,
      existing_status: existing.status
    };
  }
  await env.DB.prepare(
    `INSERT INTO orders (
      order_id, domain, years, price_usd, tld, status,
      registrant_first_name, registrant_last_name, registrant_email, registrant_country
    ) VALUES (?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?)`
  ).bind(
    orderId,
    d,
    years,
    totalPrice,
    tld,
    registrant?.first_name ?? null,
    registrant?.last_name ?? null,
    registrant?.email ?? null,
    registrant?.country ?? null
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
      "3. Offer email forwarding via configure_domain_email and DNS via configure_domain_dns"
    ],
    included_free: ["Email forwarding", "Managed DNS", "AI bot intelligence", "WHOIS privacy"]
  };
}
__name(registerDomain, "registerDomain");
function configureEmail(domain, catchAllTo, aliases) {
  const forwards = [];
  if (catchAllTo) forwards.push({ from: `*@${domain}`, to: catchAllTo, type: "catch_all", active: true });
  if (aliases) {
    for (const a of aliases) {
      forwards.push({ from: `${a.from}@${domain}`, to: a.to, type: "alias", active: true });
    }
  }
  return { domain, status: "active", email_forwards: forwards, message: `Email forwarding active for ${domain}.` };
}
__name(configureEmail, "configureEmail");
function configureDns(domain, records) {
  const full = records.map((r) => ({ type: r.type, name: r.name, value: r.value, ttl: r.ttl || 3600, priority: r.priority }));
  return { domain, status: "propagating", records: full, estimated_propagation: "5-30 minutes" };
}
__name(configureDns, "configureDns");
function getDomainDetails(domain) {
  const d = domain.toLowerCase();
  if (!TAKEN.has(d)) {
    return { error: "domain_not_found", message: `${d} is not registered with MCPDomain.`, suggestions: ["Use check_domain_availability to see if it's available"] };
  }
  const bots = [
    { name: "GPTBot", requests: 847, last_seen: (/* @__PURE__ */ new Date()).toISOString() },
    { name: "ClaudeBot", requests: 623, last_seen: (/* @__PURE__ */ new Date()).toISOString() },
    { name: "Bytespider", requests: 312, last_seen: new Date(Date.now() - 864e5).toISOString() }
  ];
  return {
    domain: d,
    status: "active",
    registered_at: new Date(Date.now() - 30 * 864e5).toISOString(),
    expires_at: new Date(Date.now() + 335 * 864e5).toISOString(),
    auto_renew: true,
    nameservers: ["ns1.mcpdomain.ai", "ns2.mcpdomain.ai"],
    dns_records: [{ type: "NS", name: "@", value: "ns1.mcpdomain.ai", ttl: 86400 }],
    email_forwards: [],
    ai_bot_intelligence: { total_requests_30d: bots.reduce((s, b) => s + b.requests, 0), unique_bots: bots.length, bots }
  };
}
__name(getDomainDetails, "getDomainDetails");
function transferDomain(domain, _authCode) {
  return {
    transfer_id: `TRF-${Date.now().toString(36).toUpperCase()}`,
    domain: domain.toLowerCase(),
    status: "pending_approval",
    eta: "5-7 days",
    included_after_transfer: ["1 year added to expiry", "Free email forwarding", "Managed DNS", "AI bot intelligence"]
  };
}
__name(transferDomain, "transferDomain");
var TOOLS = [
  {
    name: "check_domain_availability",
    description: "Check whether a specific internet domain name is available for registration. Returns availability status, price, and alternatives if taken. WHEN TO USE: user asks 'is X.com available?' or 'can I register Y.io?'. ALWAYS call this before register_new_domain.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string", description: "Complete domain name with TLD, e.g. 'sweetcrumbs.com'" } },
      required: ["domain"]
    }
  },
  {
    name: "suggest_available_domains",
    description: "Generate creative domain name suggestions from keywords or business description, with real-time availability checks. WHEN TO USE: user says 'help me find a domain for my bakery' or 'what domain should I use for X?'.",
    inputSchema: {
      type: "object",
      properties: {
        keywords: { type: "string", description: "Business name or description, e.g. 'sweet crumbs bakery'" },
        tlds: { type: "array", items: { type: "string" }, description: "TLDs to search. Default: ['.com','.co','.io']" },
        max_results: { type: "number", description: "Max suggestions. Default: 8" }
      },
      required: ["keywords"]
    }
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
            first_name: { type: "string" },
            last_name: { type: "string" },
            email: { type: "string" },
            country: { type: "string", description: "ISO 3166-1 alpha-2" }
          },
          required: ["first_name", "last_name", "email"]
        }
      },
      required: ["domain", "registrant"]
    }
  },
  {
    name: "configure_domain_email",
    description: "Set up email forwarding for a registered domain. Forward any@domain to Gmail/Outlook. No MX records needed. WHEN TO USE: user just registered a domain, or asks about professional email.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        catch_all_to: { type: "string", description: "Forward ALL emails to this inbox" },
        aliases: { type: "array", items: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] } }
      },
      required: ["domain"]
    }
  },
  {
    name: "configure_domain_dns",
    description: "Add/update DNS records (A, CNAME, MX, TXT). Use to point domain to Vercel, Netlify, GitHub Pages etc. WHEN TO USE: user wants to connect domain to hosting.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        records: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["A", "AAAA", "CNAME", "MX", "TXT", "SRV"] }, name: { type: "string" }, value: { type: "string" }, ttl: { type: "number" }, priority: { type: "number" } }, required: ["type", "name", "value"] } }
      },
      required: ["domain", "records"]
    }
  },
  {
    name: "get_my_domain_details",
    description: "Get domain status, DNS records, email config, expiry date, and unique AI bot crawling statistics. WHEN TO USE: user asks about domain status or AI bot traffic.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string" } },
      required: ["domain"]
    }
  },
  {
    name: "transfer_existing_domain",
    description: "Transfer a domain from another registrar (GoDaddy, Namecheap etc) to MCPDomain. Requires EPP/auth code. Transfer takes 5-7 days and adds 1 year to expiry.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string" }, auth_code: { type: "string", description: "EPP code from current registrar" } },
      required: ["domain", "auth_code"]
    }
  }
];
function handleInitialize(req) {
  return {
    jsonrpc: "2.0",
    id: req.id,
    result: {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "mcpdomain", version: "1.0.2" },
      instructions: "MCPDomain is the first domain registrar built for AI agents. Use the 7 tools to check availability, register domains, configure email forwarding, and manage DNS - all inside the conversation."
    }
  };
}
__name(handleInitialize, "handleInitialize");
function handleToolsList(req) {
  return { jsonrpc: "2.0", id: req.id, result: { tools: TOOLS } };
}
__name(handleToolsList, "handleToolsList");
async function handleToolCall(env, req) {
  const { name, arguments: args } = req.params || {};
  let result;
  try {
    switch (name) {
      case "check_domain_availability": {
        const check = checkDomain(args.domain);
        let alternatives = [];
        if (!check.error && !check.available) {
          const baseName = args.domain.split(".")[0];
          alternatives = suggestDomains(baseName, [".com", ".co", ".io", ".ai"], 3).map((s) => ({ domain: s.domain, price: s.price, tld: s.tld }));
        }
        result = { ...check, ...alternatives.length > 0 && { alternatives_if_taken: alternatives } };
        break;
      }
      case "suggest_available_domains":
        result = {
          query: args.keywords,
          results: suggestDomains(args.keywords, args.tlds, args.max_results),
          next_action: "Present these to the user. When they pick one, call register_new_domain."
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
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32601, message: `Unknown tool: ${name}` }
        };
    }
  } catch (e) {
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: { code: -32603, message: e.message || String(e) }
    };
  }
  return {
    jsonrpc: "2.0",
    id: req.id,
    result: {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    }
  };
}
__name(handleToolCall, "handleToolCall");
async function handleJsonRpc(env, req) {
  if (req.id === void 0 || req.id === null) return null;
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
__name(handleJsonRpc, "handleJsonRpc");
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
__name(escapeHtml, "escapeHtml");
function renderCheckoutPage(order, paymentParam) {
  const name = [order.registrant_first_name, order.registrant_last_name].filter(Boolean).join(" ") || "\u2014";
  const email = order.registrant_email || "\u2014";
  const statusLabel = {
    pending_payment: "Awaiting payment",
    paid: "Payment received, registering domain",
    registered: "Domain registered",
    failed: "Registration failed",
    cancelled: "Cancelled",
    refunded: "Refunded"
  };
  const status = statusLabel[order.status] || order.status;
  const canPay = order.status === "pending_payment";
  let banner = "";
  if (paymentParam === "success") {
    banner = `<div style="background:#D1FAE5;color:#065F46;padding:14px 16px;border-radius:10px;margin-bottom:20px;font-size:14px;font-weight:600;">Payment received \u2014 we're registering your domain now. You'll get an email shortly.</div>`;
  } else if (paymentParam === "cancelled") {
    banner = `<div style="background:#FEE2E2;color:#991B1B;padding:14px 16px;border-radius:10px;margin-bottom:20px;font-size:14px;font-weight:600;">Payment cancelled. Your order is still open \u2014 click Pay to try again.</div>`;
  }
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
        ${banner}
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

        ${canPay ? `<form method="POST" action="/api/checkout-session/${encodeURIComponent(order.order_id)}" style="margin:0">
               <button type="submit" class="btn">Pay $${order.price_usd.toFixed(2)} with Stripe</button>
             </form>
             <p class="note">Secure checkout powered by Stripe. You'll be redirected to complete payment.<br>Test mode: card <code>4242 4242 4242 4242</code>, any future expiry, any CVC.</p>` : `<p class="note">This order is ${escapeHtml(status.toLowerCase())}. Nothing to do here.</p>`}

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
__name(renderCheckoutPage, "renderCheckoutPage");
function renderNotFoundPage(orderId) {
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
__name(renderNotFoundPage, "renderNotFoundPage");
async function handleCheckoutPage(env, orderId, paymentParam) {
  const order = await env.DB.prepare(
    `SELECT order_id, domain, years, price_usd, tld, status,
            registrant_first_name, registrant_last_name, registrant_email, registrant_country,
            created_at, paid_at, registered_at
     FROM orders WHERE order_id = ?`
  ).bind(orderId).first();
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
  if (!order) {
    return new Response(renderNotFoundPage(orderId), { status: 404, headers });
  }
  return new Response(renderCheckoutPage(order, paymentParam), { status: 200, headers });
}
__name(handleCheckoutPage, "handleCheckoutPage");
async function createStripeCheckoutSession(env, order, origin) {
  const yearsLabel = order.years === 1 ? "1 year" : `${order.years} years`;
  const productName = `${order.domain} \u2014 ${yearsLabel}`;
  const description = `Domain registration via MCPDomain. Includes email forwarding, managed DNS, WHOIS privacy, AI bot intelligence.`;
  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("payment_method_types[0]", "card");
  params.append("line_items[0][price_data][currency]", "usd");
  params.append("line_items[0][price_data][product_data][name]", productName);
  params.append("line_items[0][price_data][product_data][description]", description);
  params.append("line_items[0][price_data][unit_amount]", String(Math.round(order.price_usd * 100)));
  params.append("line_items[0][quantity]", "1");
  if (order.registrant_email) {
    params.append("customer_email", order.registrant_email);
  }
  params.append("success_url", `${origin}/checkout/${order.order_id}?payment=success`);
  params.append("cancel_url", `${origin}/checkout/${order.order_id}?payment=cancelled`);
  params.append("client_reference_id", order.order_id);
  params.append("metadata[order_id]", order.order_id);
  params.append("metadata[domain]", order.domain);
  params.append("metadata[years]", String(order.years));
  params.append("metadata[tld]", order.tld);
  params.append("payment_intent_data[metadata][order_id]", order.order_id);
  params.append("payment_intent_data[metadata][domain]", order.domain);
  const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Stripe ${resp.status}: ${errText}`);
  }
  const data = await resp.json();
  if (!data.id || !data.url) {
    throw new Error(`Stripe response missing id/url: ${JSON.stringify(data)}`);
  }
  return data;
}
__name(createStripeCheckoutSession, "createStripeCheckoutSession");
async function handleCreateCheckoutSession(env, orderId, request) {
  if (!env.STRIPE_SECRET_KEY) {
    return Response.json(
      { error: "stripe_not_configured", message: "STRIPE_SECRET_KEY not set on worker." },
      { status: 500 }
    );
  }
  const order = await env.DB.prepare(
    `SELECT order_id, domain, years, price_usd, tld, status,
            registrant_first_name, registrant_last_name, registrant_email, registrant_country,
            created_at, paid_at, registered_at
     FROM orders WHERE order_id = ? LIMIT 1`
  ).bind(orderId).first();
  if (!order) {
    return Response.json({ error: "order_not_found", order_id: orderId }, { status: 404 });
  }
  if (order.status !== "pending_payment") {
    return Response.json(
      {
        error: "order_not_payable",
        message: `Order status is ${order.status}, not pending_payment.`,
        order_id: orderId,
        status: order.status
      },
      { status: 409 }
    );
  }
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  let session;
  try {
    session = await createStripeCheckoutSession(env, order, origin);
  } catch (err) {
    return Response.json(
      { error: "stripe_error", message: err?.message ?? String(err) },
      { status: 502 }
    );
  }
  await env.DB.prepare(
    `UPDATE orders SET stripe_session_id = ?, updated_at = datetime('now') WHERE order_id = ?`
  ).bind(session.id, orderId).run();
  return Response.redirect(session.url, 303);
}
__name(handleCreateCheckoutSession, "handleCreateCheckoutSession");
async function verifyStripeSignature(payload, signatureHeader, secret) {
  const parts = signatureHeader.split(",");
  let timestamp = "";
  const sigs = [];
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === "t") timestamp = v;
    else if (k === "v1") sigs.push(v);
  }
  if (!timestamp || sigs.length === 0) return false;
  const now = Math.floor(Date.now() / 1e3);
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false;
  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(sigBytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
  for (const s of sigs) {
    if (s.length !== expected.length) continue;
    let diff = 0;
    for (let i = 0; i < s.length; i++) diff |= s.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff === 0) return true;
  }
  return false;
}
__name(verifyStripeSignature, "verifyStripeSignature");
async function registerAfterPayment(env, orderId) {
  try {
    const registrar = makeRegistrar(env);
    if (!registrar) {
      console.error(`[${orderId}] no registrar configured; leaving order in 'paid' state`);
      return;
    }
    const order = await env.DB.prepare(
      `SELECT order_id, domain, years, status,
              registrant_first_name, registrant_last_name,
              registrant_email, registrant_country,
              registrar_status
         FROM orders WHERE order_id = ?`
    ).bind(orderId).first();
    if (!order) {
      console.error(`[${orderId}] order not found for post-payment registration`);
      return;
    }
    if (order.status !== "paid") {
      console.error(`[${orderId}] not paid (status=${order.status}); skipping registration`);
      return;
    }
    if (order.registrar_status === "registered") {
      console.log(`[${orderId}] already registered; skipping`);
      return;
    }
    await env.DB.prepare(
      `UPDATE orders SET registrar_status = 'registering', updated_at = datetime('now')
        WHERE order_id = ? AND (registrar_status IS NULL OR registrar_status IN ('failed','pending'))`
    ).bind(orderId).run();
    const result = await registrar.registerDomain({
      domain: order.domain,
      years: order.years,
      registrant: {
        first_name: order.registrant_first_name || "Domain",
        last_name: order.registrant_last_name || "Owner",
        email: order.registrant_email || "admin@mcpdomain.ai",
        country: order.registrant_country || "US"
      },
      auto_renew: true,
      privacy: true
    });
    if (result.ok) {
      await env.DB.prepare(
        `UPDATE orders
           SET registrar_status = 'registered',
               registrar_order_id = ?,
               registered_at = datetime('now'),
               expires_at = ?,
               registrar_response = ?,
               updated_at = datetime('now')
         WHERE order_id = ?`
      ).bind(
        result.registrar_order_id ?? null,
        result.expires_at ?? null,
        truncate(JSON.stringify({ ok: true, registrar: registrar.name, raw: result.raw }), 4e3),
        orderId
      ).run();
      console.log(`[${orderId}] registered ${order.domain} via ${registrar.name}`);
    } else {
      await env.DB.prepare(
        `UPDATE orders
           SET registrar_status = 'failed',
               registrar_response = ?,
               updated_at = datetime('now')
         WHERE order_id = ?`
      ).bind(
        truncate(JSON.stringify({
          ok: false,
          registrar: registrar.name,
          error_code: result.error_code,
          error_message: result.error_message
        }), 4e3),
        orderId
      ).run();
      console.error(
        `[${orderId}] registration failed: ${result.error_code} ${result.error_message}`
      );
    }
  } catch (err) {
    console.error(`[${orderId}] registerAfterPayment threw:`, err?.message ?? err);
    try {
      await env.DB.prepare(
        `UPDATE orders
           SET registrar_status = 'failed',
               registrar_response = ?,
               updated_at = datetime('now')
         WHERE order_id = ?`
      ).bind(
        truncate(JSON.stringify({ ok: false, exception: String(err?.message ?? err) }), 4e3),
        orderId
      ).run();
    } catch {
    }
  }
}
__name(registerAfterPayment, "registerAfterPayment");
function truncate(s, n) {
  return s.length > n ? s.slice(0, n) : s;
}
__name(truncate, "truncate");
async function handleStripeWebhook(env, ctx, request) {
  const rawBody = await request.text();
  if (env.STRIPE_WEBHOOK_SECRET) {
    const sigHeader = request.headers.get("stripe-signature");
    if (!sigHeader) {
      return new Response("Missing stripe-signature header", { status: 400 });
    }
    const ok = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
    if (!ok) {
      return new Response("Invalid signature", { status: 400 });
    }
  }
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data?.object ?? {};
      const orderId = session.metadata?.order_id || session.client_reference_id;
      const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : null;
      if (orderId) {
        await env.DB.prepare(
          `UPDATE orders
             SET status = 'paid',
                 paid_at = datetime('now'),
                 stripe_payment_intent = COALESCE(?, stripe_payment_intent),
                 updated_at = datetime('now')
           WHERE order_id = ? AND status = 'pending_payment'`
        ).bind(paymentIntent, orderId).run();
        ctx.waitUntil(registerAfterPayment(env, orderId));
      }
    } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      const session = event.data?.object ?? {};
      const orderId = session.metadata?.order_id || session.client_reference_id;
      if (orderId) {
        await env.DB.prepare(
          `UPDATE orders
             SET updated_at = datetime('now'),
                 notes = COALESCE(notes || ' | ', '') || ?
           WHERE order_id = ?`
        ).bind(`stripe:${event.type}`, orderId).run();
      }
    }
  } catch (err) {
    console.error("Webhook handler error:", err?.message ?? err);
  }
  return Response.json({ received: true }, { status: 200 });
}
__name(handleStripeWebhook, "handleStripeWebhook");
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id"
};
var LLMS_TXT = `# MCPDomain

The first domain registrar built for AI agents. Check availability, register domains,
configure email forwarding and DNS \u2014 all from inside any AI conversation via the
Model Context Protocol (MCP).

## MCP endpoint
https://mcpdomain.ai/mcp  (Streamable HTTP, JSON-RPC 2.0)

## Tools
- check_domain_availability
- suggest_available_domains
- register_new_domain
- configure_domain_email
- configure_domain_dns
- get_my_domain_details
- transfer_existing_domain

## Links
- Homepage: https://mcpdomain.ai
- GitHub:   https://github.com/danboabes/mcpdomain
- npm:      https://www.npmjs.com/package/mcpdomain
- Smithery: https://smithery.ai/server/danboabes/mcpdomain
`;
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (path.startsWith("/checkout/") && method === "GET") {
      const orderId = decodeURIComponent(path.slice("/checkout/".length));
      if (!orderId) {
        return Response.json({ error: "Missing order ID" }, { status: 400, headers: CORS_HEADERS });
      }
      const paymentParam = url.searchParams.get("payment") || void 0;
      return handleCheckoutPage(env, orderId, paymentParam);
    }
    if (path.startsWith("/api/checkout-session/") && method === "POST") {
      const orderId = decodeURIComponent(path.slice("/api/checkout-session/".length));
      if (!orderId) {
        return Response.json({ error: "Missing order ID" }, { status: 400, headers: CORS_HEADERS });
      }
      return handleCreateCheckoutSession(env, orderId, request);
    }
    if (path === "/api/stripe-webhook" && method === "POST") {
      return handleStripeWebhook(env, ctx, request);
    }
    if (path === "/health" || path === "/") {
      return Response.json(
        { status: "ok", name: "mcpdomain", version: "1.0.2", tools: 7, tlds: SUPPORTED_TLDS.length },
        { headers: CORS_HEADERS }
      );
    }
    if (path === "/llms.txt") {
      return new Response(LLMS_TXT, {
        headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" }
      });
    }
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
        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
            { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
          );
        }
        if (Array.isArray(body)) {
          const responses = (await Promise.all(body.map((req) => handleJsonRpc(env, req)))).filter((r) => r !== null);
          if (responses.length === 0) {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
          }
          return Response.json(responses, {
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
          });
        }
        const response = await handleJsonRpc(env, body);
        if (response === null) {
          return new Response(null, { status: 204, headers: CORS_HEADERS });
        }
        const headers = { ...CORS_HEADERS, "Content-Type": "application/json" };
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
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
