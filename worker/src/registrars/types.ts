/**
 * Provider-agnostic registrar interface.
 *
 * Each concrete registrar (OpenSRS, Porkbun, Namecheap, ...) implements this
 * interface. The rest of the Worker code (webhook handler, MCP tools) only
 * talks to `Registrar`, so swapping providers is a one-line change.
 */

export interface RegistrantContact {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  // Postal address — registrars require it for ICANN compliance.
  // We default to the reseller's own address when the user hasn't supplied one.
  org_name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string; // ISO 3166-1 alpha-2
}

export interface AvailabilityResult {
  domain: string;
  available: boolean;
  premium?: boolean;
  premium_price_usd?: number;
  raw?: unknown;
}

export interface RegistrationResult {
  ok: boolean;
  domain: string;
  registrar_order_id?: string;   // Provider-side order/transaction id
  expires_at?: string;           // ISO-8601 UTC
  raw?: unknown;                 // Full provider response for audit / debugging
  error_code?: string;           // Machine-readable failure classification
  error_message?: string;        // Human-readable failure text
}

export interface RegisterDomainInput {
  domain: string;
  years: number;
  registrant: RegistrantContact;
  // Nameservers. If omitted, the registrar's defaults (or MCPDomain NS) are used.
  nameservers?: string[];
  // Auto-renew flag. Default: true.
  auto_renew?: boolean;
  // WHOIS privacy. Default: true.
  privacy?: boolean;
}

export interface DomainInfoResult {
  ok: boolean;
  domain: string;
  status?: string;
  expires_at?: string;
  nameservers?: string[];
  auto_renew?: boolean;
  raw?: unknown;
  error_code?: string;
  error_message?: string;
}

export interface Registrar {
  /** Provider identifier for logging / D1 records, e.g. "opensrs". */
  readonly name: string;

  /** Check whether a domain is available for registration. */
  checkAvailability(domain: string): Promise<AvailabilityResult>;

  /** Register a new domain. Payment is assumed to have been collected already. */
  registerDomain(input: RegisterDomainInput): Promise<RegistrationResult>;

  /** Fetch current state for a domain we've already registered. */
  getDomainInfo(domain: string): Promise<DomainInfoResult>;
}
