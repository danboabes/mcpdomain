/**
 * OpenSRS (Tucows) reseller API client.
 *
 * Protocol: XML over HTTPS, port 55443.
 *   Live  endpoint: https://rr-n1-tor.opensrs.net:55443/
 *   OTE   endpoint: https://horizon.opensrs.net:55443/
 *
 * Auth: MD5-based signature
 *   signature = md5( md5(xml + private_key) + private_key )
 *
 * Headers:
 *   X-Username  : reseller username
 *   X-Signature : signature (lowercase hex)
 *   Content-Type: text/xml
 *
 * Docs: https://domains.opensrs.guide/docs
 */

import type {
  Registrar,
  RegisterDomainInput,
  RegistrationResult,
  AvailabilityResult,
  DomainInfoResult,
  RegistrantContact,
} from "./types";

export interface OpenSRSConfig {
  username: string;
  key: string;
  /** "live" or "ote" (sandbox). Default: "live". */
  env?: "live" | "ote";
  /** Fallback contact info when the user doesn't supply a full postal address. */
  defaultContact?: Partial<RegistrantContact>;
}

const ENDPOINTS: Record<"live" | "ote", string> = {
  live: "https://rr-n1-tor.opensrs.net:55443/",
  ote: "https://horizon.opensrs.net:55443/",
};

export class OpenSRSRegistrar implements Registrar {
  readonly name = "opensrs";
  private endpoint: string;

  constructor(private config: OpenSRSConfig) {
    this.endpoint = ENDPOINTS[config.env ?? "live"];
  }

  // ---------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------

  async checkAvailability(domain: string): Promise<AvailabilityResult> {
    const xml = buildEnvelope("LOOKUP", "DOMAIN", { domain });
    const resp = await this.send(xml);

    // OpenSRS returns response_code=210 for available, 211 for taken.
    const code = resp.items.response_code;
    const status = resp.items.status;
    return {
      domain,
      available: code === "210" || status === "available",
      raw: resp.raw,
    };
  }

  async registerDomain(input: RegisterDomainInput): Promise<RegistrationResult> {
    const contact = this.mergeContact(input.registrant);
    const contactXml = renderContactSet(contact);
    const nsXml = renderNameservers(input.nameservers);

    // SW_REGISTER — real, billable domain registration.
    // reg_type=new is a first-time registration (as opposed to transfer).
    // handle=process -> registrar charges immediately (vs. save=queue).
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
        raw: resp.raw,
      };
    }

    return {
      ok: true,
      domain: input.domain,
      registrar_order_id: resp.items.id || resp.items.order_id,
      expires_at: resp.items["registration expiration date"] || resp.items.expiredate,
      raw: resp.raw,
    };
  }

  async getDomainInfo(domain: string): Promise<DomainInfoResult> {
    // GET (action=GET, object=DOMAIN, type=all_info) returns a full status dump.
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
        raw: resp.raw,
      };
    }
    return {
      ok: true,
      domain,
      status: resp.items.sponsoring_rsp === "1" ? "active" : resp.items.status,
      expires_at: resp.items.expiredate,
      nameservers: resp.nameservers,
      auto_renew: resp.items.auto_renew === "1",
      raw: resp.raw,
    };
  }

  // ---------------------------------------------------------------
  // INTERNALS
  // ---------------------------------------------------------------

  private async send(xml: string): Promise<ParsedResponse> {
    const signature = md5(md5(xml + this.config.key) + this.config.key);
    const resp = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "X-Username": this.config.username,
        "X-Signature": signature,
        "Accept": "text/xml",
      },
      body: xml,
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`OpenSRS HTTP ${resp.status}: ${text.slice(0, 500)}`);
    }
    return parseResponse(text);
  }

  private mergeContact(c: RegistrantContact): RegistrantContact {
    const def = this.config.defaultContact ?? {};
    return {
      first_name: c.first_name,
      last_name:  c.last_name,
      email:      c.email,
      phone:        c.phone        ?? def.phone        ?? "+1.4165350123",
      org_name:     c.org_name     ?? def.org_name     ?? "MCPDomain",
      address1:     c.address1     ?? def.address1     ?? "96 Mowat Avenue",
      address2:     c.address2     ?? def.address2     ?? "",
      city:         c.city         ?? def.city         ?? "Toronto",
      state:        c.state        ?? def.state        ?? "ON",
      postal_code:  c.postal_code  ?? def.postal_code  ?? "M6K3M1",
      country:      c.country      ?? def.country      ?? "CA",
    };
  }
}

// -----------------------------------------------------------------
// XML envelope builders
// -----------------------------------------------------------------
function buildEnvelope(action: string, object: string, attrs: Record<string, string | number>): string {
  const attributes = Object.entries(attrs)
    .map(([k, v]) => `<item key="${k}">${escapeXml(String(v))}</item>`)
    .join("\n          ");
  return buildEnvelopeRaw(action, object, attributes);
}

function buildEnvelopeRaw(action: string, object: string, attributesXml: string): string {
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

function renderContactSet(c: RegistrantContact): string {
  // Four roles: owner, admin, billing, tech. All four must be provided;
  // we use the same contact for each.
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

function renderNameservers(ns?: string[]): string {
  const list = ns && ns.length ? ns : [
    "ns1.systemdns.com",
    "ns2.systemdns.com",
    "ns3.systemdns.com",
  ];
  const items = list
    .map((name, i) => `
            <item key="${i}">
              <dt_assoc>
                <item key="sortorder">${i + 1}</item>
                <item key="name">${escapeXml(name)}</item>
              </dt_assoc>
            </item>`)
    .join("");
  // custom_nameservers=1 + custom_tech_contact=1 are required to pass our NS list.
  return `<item key="custom_nameservers">1</item>
      <item key="custom_tech_contact">1</item>
      <item key="nameserver_list">
        <dt_array>${items}
        </dt_array>
      </item>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function generatePassword(): string {
  // Domain-level password. Random; we never surface this because MCPDomain
  // manages the domain in-platform rather than exposing raw registrar logins.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// -----------------------------------------------------------------
// Response parser — deliberately minimal.
// Extracts the top-level <item key="...">value</item> pairs that
// OpenSRS returns at the data_block / attributes level, which is
// all we need for the tools we call.
// -----------------------------------------------------------------
interface ParsedResponse {
  items: Record<string, string>;
  nameservers?: string[];
  raw: string;
}

function parseResponse(xml: string): ParsedResponse {
  const items: Record<string, string> = {};

  // Top-level response items (response_code, response_text, is_success,
  // protocol, action, object). These live directly under the outer dt_assoc.
  const topRegex = /<item key="([^"]+)">([^<]*)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = topRegex.exec(xml)) !== null) {
    // First occurrence wins — OpenSRS nests items with the same key inside
    // attributes/contact_set; we want the outermost scalars.
    if (!(m[1] in items)) items[m[1]] = decodeXmlEntities(m[2]);
  }

  // Nameserver list (best-effort): grab all <item key="name">xxx</item>
  // that appear inside a <dt_assoc> also containing sortorder.
  const nsMatches: string[] = [];
  const nsRegex = /<dt_assoc>\s*<item key="sortorder">\d+<\/item>\s*<item key="name">([^<]+)<\/item>\s*<\/dt_assoc>/g;
  while ((m = nsRegex.exec(xml)) !== null) nsMatches.push(decodeXmlEntities(m[1]));

  return { items, nameservers: nsMatches.length ? nsMatches : undefined, raw: xml };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// -----------------------------------------------------------------
// MD5 — RFC 1321.
// OpenSRS requires MD5 for signing; Web Crypto doesn't expose it (by design),
// so we ship a tiny pure-JS implementation. ~90 lines, zero deps.
// -----------------------------------------------------------------
function md5(s: string): string {
  // Convert UTF-8 string to array of 32-bit little-endian words.
  const bytes = new TextEncoder().encode(s);
  const words: number[] = [];
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    words[i >> 2] = (words[i >> 2] || 0) | (bytes[i] << ((i % 4) * 8));
  }
  words[len >> 2] = (words[len >> 2] || 0) | (0x80 << ((len % 4) * 8));
  // length in bits at the end
  words[(((len + 8) >>> 6) + 1) * 16 - 2] = len * 8;

  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;

  for (let i = 0; i < words.length; i += 16) {
    const oa = a, ob = b, oc = c, od = d;

    a = ff(a, b, c, d, words[i + 0] | 0,  7,  -680876936);
    d = ff(d, a, b, c, words[i + 1] | 0, 12,  -389564586);
    c = ff(c, d, a, b, words[i + 2] | 0, 17,   606105819);
    b = ff(b, c, d, a, words[i + 3] | 0, 22, -1044525330);
    a = ff(a, b, c, d, words[i + 4] | 0,  7,  -176418897);
    d = ff(d, a, b, c, words[i + 5] | 0, 12,  1200080426);
    c = ff(c, d, a, b, words[i + 6] | 0, 17, -1473231341);
    b = ff(b, c, d, a, words[i + 7] | 0, 22,   -45705983);
    a = ff(a, b, c, d, words[i + 8] | 0,  7,  1770035416);
    d = ff(d, a, b, c, words[i + 9] | 0, 12, -1958414417);
    c = ff(c, d, a, b, words[i + 10] | 0, 17,      -42063);
    b = ff(b, c, d, a, words[i + 11] | 0, 22, -1990404162);
    a = ff(a, b, c, d, words[i + 12] | 0,  7,  1804603682);
    d = ff(d, a, b, c, words[i + 13] | 0, 12,   -40341101);
    c = ff(c, d, a, b, words[i + 14] | 0, 17, -1502002290);
    b = ff(b, c, d, a, words[i + 15] | 0, 22,  1236535329);

    a = gg(a, b, c, d, words[i + 1]  | 0,  5,  -165796510);
    d = gg(d, a, b, c, words[i + 6]  | 0,  9, -1069501632);
    c = gg(c, d, a, b, words[i + 11] | 0, 14,   643717713);
    b = gg(b, c, d, a, words[i + 0]  | 0, 20,  -373897302);
    a = gg(a, b, c, d, words[i + 5]  | 0,  5,  -701558691);
    d = gg(d, a, b, c, words[i + 10] | 0,  9,    38016083);
    c = gg(c, d, a, b, words[i + 15] | 0, 14,  -660478335);
    b = gg(b, c, d, a, words[i + 4]  | 0, 20,  -405537848);
    a = gg(a, b, c, d, words[i + 9]  | 0,  5,   568446438);
    d = gg(d, a, b, c, words[i + 14] | 0,  9, -1019803690);
    c = gg(c, d, a, b, words[i + 3]  | 0, 14,  -187363961);
    b = gg(b, c, d, a, words[i + 8]  | 0, 20,  1163531501);
    a = gg(a, b, c, d, words[i + 13] | 0,  5, -1444681467);
    d = gg(d, a, b, c, words[i + 2]  | 0,  9,   -51403784);
    c = gg(c, d, a, b, words[i + 7]  | 0, 14,  1735328473);
    b = gg(b, c, d, a, words[i + 12] | 0, 20, -1926607734);

    a = hh(a, b, c, d, words[i + 5]  | 0,  4,    -378558);
    d = hh(d, a, b, c, words[i + 8]  | 0, 11, -2022574463);
    c = hh(c, d, a, b, words[i + 11] | 0, 16,  1839030562);
    b = hh(b, c, d, a, words[i + 14] | 0, 23,   -35309556);
    a = hh(a, b, c, d, words[i + 1]  | 0,  4, -1530992060);
    d = hh(d, a, b, c, words[i + 4]  | 0, 11,  1272893353);
    c = hh(c, d, a, b, words[i + 7]  | 0, 16,  -155497632);
    b = hh(b, c, d, a, words[i + 10] | 0, 23, -1094730640);
    a = hh(a, b, c, d, words[i + 13] | 0,  4,   681279174);
    d = hh(d, a, b, c, words[i + 0]  | 0, 11,  -358537222);
    c = hh(c, d, a, b, words[i + 3]  | 0, 16,  -722521979);
    b = hh(b, c, d, a, words[i + 6]  | 0, 23,    76029189);
    a = hh(a, b, c, d, words[i + 9]  | 0,  4,  -640364487);
    d = hh(d, a, b, c, words[i + 12] | 0, 11,  -421815835);
    c = hh(c, d, a, b, words[i + 15] | 0, 16,   530742520);
    b = hh(b, c, d, a, words[i + 2]  | 0, 23,  -995338651);

    a = ii(a, b, c, d, words[i + 0]  | 0,  6,  -198630844);
    d = ii(d, a, b, c, words[i + 7]  | 0, 10,  1126891415);
    c = ii(c, d, a, b, words[i + 14] | 0, 15, -1416354905);
    b = ii(b, c, d, a, words[i + 5]  | 0, 21,   -57434055);
    a = ii(a, b, c, d, words[i + 12] | 0,  6,  1700485571);
    d = ii(d, a, b, c, words[i + 3]  | 0, 10, -1894986606);
    c = ii(c, d, a, b, words[i + 10] | 0, 15,    -1051523);
    b = ii(b, c, d, a, words[i + 1]  | 0, 21, -2054922799);
    a = ii(a, b, c, d, words[i + 8]  | 0,  6,  1873313359);
    d = ii(d, a, b, c, words[i + 15] | 0, 10,   -30611744);
    c = ii(c, d, a, b, words[i + 6]  | 0, 15, -1560198380);
    b = ii(b, c, d, a, words[i + 13] | 0, 21,  1309151649);
    a = ii(a, b, c, d, words[i + 4]  | 0,  6,  -145523070);
    d = ii(d, a, b, c, words[i + 11] | 0, 10, -1120210379);
    c = ii(c, d, a, b, words[i + 2]  | 0, 15,   718787259);
    b = ii(b, c, d, a, words[i + 9]  | 0, 21,  -343485551);

    a = (a + oa) | 0;
    b = (b + ob) | 0;
    c = (c + oc) | 0;
    d = (d + od) | 0;
  }
  return toHex(a) + toHex(b) + toHex(c) + toHex(d);
}
function add32(x: number, y: number): number { return (x + y) | 0; }
function cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
  const n = add32(add32(a, q), add32(x, t));
  return add32((n << s) | (n >>> (32 - s)), b);
}
function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn((b & c) | (~b & d), a, b, x, s, t);
}
function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn((b & d) | (c & ~d), a, b, x, s, t);
}
function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn(b ^ c ^ d, a, b, x, s, t);
}
function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn(c ^ (b | ~d), a, b, x, s, t);
}
function toHex(n: number): string {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += ((n >> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  }
  return s;
}
