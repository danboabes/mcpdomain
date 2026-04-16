/**
 * MCPDomain MCP Server
 *
 * The first domain registrar built for AI agents.
 * Hosted at: https://mcpdomain.ai
 *
 * 7 tools for the complete domain lifecycle:
 *   1. check_domain_availability    - Verify a specific domain is available
 *   2. suggest_available_domains    - Generate + verify domain ideas
 *   3. register_new_domain          - Initiate registration (returns checkout URL)
 *   4. configure_domain_email       - Set up email forwarding
 *   5. configure_domain_dns         - Manage DNS records
 *   6. get_my_domain_details        - Get domain status + AI bot intelligence
 *   7. transfer_existing_domain     - Move a domain from another registrar
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TOOL_DESCRIPTIONS, SERVER_INSTRUCTIONS } from "./tool-descriptions.js";
import {
  checkDomainAvailability,
  suggestAvailableDomains,
  registerNewDomain,
  configureDomainEmail,
  configureDomainDns,
  getMyDomainDetails,
  transferExistingDomain,
  getAdapterMode,
  SUPPORTED_TLD_LIST,
} from "./opensrs-adapter.js";

// ─── Helpers ──────────────────────────────────────────────────

function jsonResult(data: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(data, null, 2),
    }],
  };
}

function errorResult(message: string, details?: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ error: true, message, details }, null, 2),
    }],
    isError: true,
  };
}

// ─── Server Factory ───────────────────────────────────────────

export function createMCPDomainServer(): McpServer {
  const server = new McpServer(
    {
      name: "mcpdomain",
      version: "1.0.0",
    },
    {
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  // ═══════════════════════════════════════════════════════════
  // TOOL 1: check_domain_availability
  // ═══════════════════════════════════════════════════════════
  server.tool(
    "check_domain_availability",
    TOOL_DESCRIPTIONS.check_domain_availability,
    {
      domain: z.string().min(3).max(253)
        .describe("Complete domain name including TLD. Examples: 'sweetcrumbs.com', 'myapp.io', 'example.ai'. Must be a valid format (letters, numbers, hyphens, no spaces)."),
    },
    async ({ domain }) => {
      try {
        const result = await checkDomainAvailability(domain);

        // If taken, also generate alternatives
        let alternatives: { domain: string; price: string; tld: string }[] = [];
        if (!result.available) {
          const baseName = domain.split(".")[0];
          const suggestions = await suggestAvailableDomains(baseName, [".com", ".co", ".io", ".ai"], 3);
          alternatives = suggestions.map(s => ({ domain: s.domain, price: s.price, tld: s.tld }));
        }

        return jsonResult({
          domain: result.domain,
          available: result.available,
          price: result.price,
          currency: result.currency,
          tld: result.tld,
          premium: result.premium,
          ...(alternatives.length > 0 && { alternatives_if_taken: alternatives }),
          next_action: result.available
            ? "If user wants this domain, call register_new_domain with their contact info."
            : "Suggest one of the alternatives, or call suggest_available_domains for more ideas.",
        });
      } catch (error) {
        return errorResult(`Failed to check domain: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════
  // TOOL 2: suggest_available_domains
  // ═══════════════════════════════════════════════════════════
  server.tool(
    "suggest_available_domains",
    TOOL_DESCRIPTIONS.suggest_available_domains,
    {
      keywords: z.string().min(2).max(200)
        .describe("Business name, brand idea, or description. Examples: 'sweet crumbs bakery', 'AI fitness coach', 'sustainable fashion'. Multi-word inputs work best — the tool generates concatenations and variations."),
      tlds: z.array(z.string()).optional()
        .describe(`Which TLDs to search. Default: ['.com', '.co', '.io']. Available: ${SUPPORTED_TLD_LIST.join(", ")}`),
      max_results: z.number().int().min(1).max(20).optional()
        .describe("Maximum suggestions to return. Default: 8. Use higher numbers when user wants lots of options."),
    },
    async ({ keywords, tlds, max_results }) => {
      try {
        const suggestions = await suggestAvailableDomains(
          keywords,
          tlds || [".com", ".co", ".io"],
          max_results || 8
        );

        return jsonResult({
          query: keywords,
          searched_tlds: tlds || [".com", ".co", ".io"],
          results: suggestions.map(s => ({
            domain: s.domain,
            price: s.price,
            tld: s.tld,
            relevance_score: s.relevance_score,
          })),
          total_found: suggestions.length,
          next_action: suggestions.length === 0
            ? "No matches found. Try different keywords or expand TLDs (e.g. add .ai, .dev, .app)."
            : "Present these to the user. When they pick one, call register_new_domain to start registration.",
        });
      } catch (error) {
        return errorResult(`Failed to suggest domains: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════
  // TOOL 3: register_new_domain
  // ═══════════════════════════════════════════════════════════
  server.tool(
    "register_new_domain",
    TOOL_DESCRIPTIONS.register_new_domain,
    {
      domain: z.string().min(3).max(253)
        .describe("The domain to register. MUST have been verified available via check_domain_availability first."),
      years: z.number().int().min(1).max(10).optional()
        .describe("Registration period in years. Default: 1. Multi-year registrations get small discounts."),
      registrant: z.object({
        first_name: z.string().min(1).describe("Registrant's first/given name"),
        last_name: z.string().min(1).describe("Registrant's last/family name"),
        email: z.string().email().describe("Registrant's email address (used for ICANN compliance and order updates)"),
        phone: z.string().optional().describe("Phone in international format, e.g. '+1.5551234567'"),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        postal_code: z.string().optional(),
        country: z.string().length(2).optional().describe("ISO 3166-1 alpha-2 country code, e.g. 'US', 'RO', 'GB'"),
      }).describe("Domain registrant contact information. First name, last name, and email are required by ICANN."),
    },
    async ({ domain, years, registrant }) => {
      try {
        // Verify availability first
        const check = await checkDomainAvailability(domain);
        if (!check.available) {
          return jsonResult({
            error: "domain_not_available",
            message: `${domain} is no longer available for registration.`,
            suggestion: "Use suggest_available_domains to find alternatives.",
          });
        }

        const order = await registerNewDomain(domain, years || 1, registrant);

        return jsonResult({
          order_id: order.order_id,
          domain: order.domain,
          status: order.status,
          price: order.price,
          checkout_url: order.checkout_url,
          message: `Domain ${order.domain} reserved! Send the user to the checkout URL to complete payment via Stripe.`,
          next_steps: [
            "1. Send user to checkout_url to pay",
            "2. After payment, proactively offer to set up email forwarding via configure_domain_email",
            "3. If user mentions hosting, offer to configure DNS via configure_domain_dns",
          ],
          included_free: [
            "Email forwarding (catch-all + aliases)",
            "Managed DNS with global anycast",
            "AI bot crawling intelligence",
            "WHOIS privacy",
            "DNSSEC",
          ],
        });
      } catch (error) {
        return errorResult(`Failed to register domain: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════
  // TOOL 4: configure_domain_email
  // ═══════════════════════════════════════════════════════════
  server.tool(
    "configure_domain_email",
    TOOL_DESCRIPTIONS.configure_domain_email,
    {
      domain: z.string().describe("Domain to configure email forwarding for. Must be a domain registered with MCPDomain."),
      catch_all_to: z.string().email().optional()
        .describe("Forward ALL emails (any address @yourdomain) to this single inbox. Best for solo users. Example: 'maria@gmail.com'"),
      aliases: z.array(z.object({
        from: z.string().describe("The local part before @ (e.g. 'contact', 'sales', 'hello')"),
        to: z.string().email().describe("Destination email address"),
      })).optional()
        .describe("Specific email aliases. Example: [{from: 'sales', to: 'team@gmail.com'}, {from: 'support', to: 'help@gmail.com'}]"),
    },
    async ({ domain, catch_all_to, aliases }) => {
      try {
        if (!catch_all_to && (!aliases || aliases.length === 0)) {
          return errorResult(
            "No email configuration provided. Specify either catch_all_to or aliases (or both)."
          );
        }

        const forwards = await configureDomainEmail(domain, catch_all_to, aliases);

        return jsonResult({
          domain,
          status: "active",
          email_forwards: forwards,
          message: `Email forwarding is now active for ${domain}. Test by sending an email to any address @${domain} — it should arrive within 1-2 minutes.`,
          technical_note: "MCPDomain manages MX records automatically. The user does not need to configure anything in DNS.",
        });
      } catch (error) {
        return errorResult(`Failed to configure email: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════
  // TOOL 5: configure_domain_dns
  // ═══════════════════════════════════════════════════════════
  server.tool(
    "configure_domain_dns",
    TOOL_DESCRIPTIONS.configure_domain_dns,
    {
      domain: z.string().describe("Domain to configure DNS records for"),
      records: z.array(z.object({
        type: z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "SRV"]).describe("DNS record type"),
        name: z.string().describe("Subdomain or '@' for root. Examples: '@', 'www', 'blog', 'api'"),
        value: z.string().describe("Record value: IP for A/AAAA, hostname for CNAME/MX, text for TXT"),
        ttl: z.number().int().min(60).max(86400).optional().describe("Time-to-live in seconds. Default: 3600"),
        priority: z.number().int().optional().describe("Priority for MX/SRV records (lower = higher priority)"),
      })).min(1).describe("DNS records to add or update. Multiple records can be set in one call."),
    },
    async ({ domain, records }) => {
      try {
        const result = await configureDomainDns(domain, records as any);

        return jsonResult({
          domain,
          status: result.status,
          records_active: result.records.length,
          records: result.records,
          estimated_propagation: result.estimated_propagation,
          message: `${records.length} DNS record(s) configured for ${domain}. Tell the user changes take ${result.estimated_propagation} to propagate globally.`,
        });
      } catch (error) {
        return errorResult(`Failed to configure DNS: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════
  // TOOL 6: get_my_domain_details
  // ═══════════════════════════════════════════════════════════
  server.tool(
    "get_my_domain_details",
    TOOL_DESCRIPTIONS.get_my_domain_details,
    {
      domain: z.string().describe("Domain to retrieve details for. Must be registered with MCPDomain."),
    },
    async ({ domain }) => {
      try {
        const info = await getMyDomainDetails(domain);

        if (!info) {
          return jsonResult({
            error: "domain_not_found",
            message: `${domain} is not registered with MCPDomain.`,
            suggestions: [
              "Use check_domain_availability to see if it's available for registration",
              "Use transfer_existing_domain to move it from another registrar",
            ],
          });
        }

        return jsonResult(info);
      } catch (error) {
        return errorResult(`Failed to get domain details: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════
  // TOOL 7: transfer_existing_domain
  // ═══════════════════════════════════════════════════════════
  server.tool(
    "transfer_existing_domain",
    TOOL_DESCRIPTIONS.transfer_existing_domain,
    {
      domain: z.string().describe("Domain to transfer from another registrar to MCPDomain"),
      auth_code: z.string().min(6).describe("Authorization/EPP code obtained from the current registrar. The user must request this from their losing registrar."),
    },
    async ({ domain, auth_code }) => {
      try {
        const transfer = await transferExistingDomain(domain, auth_code);

        return jsonResult({
          transfer_id: transfer.transfer_id,
          domain: transfer.domain,
          status: transfer.status,
          eta: transfer.eta,
          created_at: transfer.created_at,
          message: `Transfer initiated for ${transfer.domain}. The user's current registrar will email the domain admin contact to confirm. Once approved, the transfer completes in ${transfer.eta}.`,
          included_after_transfer: [
            "1 year added to current expiry date",
            "Free email forwarding",
            "Managed DNS",
            "AI bot crawling intelligence",
            "WHOIS privacy",
          ],
          user_action_required: "The user must approve the transfer email from their current registrar within 5 days.",
        });
      } catch (error) {
        return errorResult(`Failed to initiate transfer: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  return server;
}

export function getServerInfo() {
  return {
    name: "mcpdomain",
    version: "1.0.0",
    mode: getAdapterMode(),
    supported_tlds: SUPPORTED_TLD_LIST,
    tool_count: 7,
  };
}
