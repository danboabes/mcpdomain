/**
 * MCPDomain MCP Server — Test Suite
 *
 * Exercises all 7 tools end-to-end via in-memory transport.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMCPDomainServer, getServerInfo } from "./server.js";

const PASS = "✓";
const FAIL = "✗";

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`     ${PASS} ${message}`);
    testsPassed++;
  } else {
    console.log(`     ${FAIL} ${message}`);
    testsFailed++;
  }
}

function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

async function main() {
  const info = getServerInfo();
  console.log("\n┌─────────────────────────────────────────────────────┐");
  console.log(`│  MCPDomain MCP Server v${info.version} — Test Suite          │`);
  console.log(`│  Mode: ${info.mode.padEnd(45)}│`);
  console.log("└─────────────────────────────────────────────────────┘\n");

  const server = createMCPDomainServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  // ─── List tools ──────────────────────────────────────
  console.log("📋 Discovering tools via MCP protocol");
  const { tools } = await client.listTools();
  assert(tools.length === 7, `Server exposes 7 tools (got ${tools.length})`);

  const expectedTools = [
    "check_domain_availability",
    "suggest_available_domains",
    "register_new_domain",
    "configure_domain_email",
    "configure_domain_dns",
    "get_my_domain_details",
    "transfer_existing_domain",
  ];

  for (const expected of expectedTools) {
    assert(
      tools.some(t => t.name === expected),
      `Tool '${expected}' is registered`
    );
  }

  // Verify descriptions are detailed enough for agentic discovery
  const checkDomainTool = tools.find(t => t.name === "check_domain_availability")!;
  assert(
    (checkDomainTool.description || "").length > 200,
    `check_domain_availability has detailed description (${checkDomainTool.description?.length} chars)`
  );
  assert(
    (checkDomainTool.description || "").includes("WHEN TO USE"),
    "Description includes WHEN TO USE guidance"
  );

  // ─── TEST 1: check_domain_availability (available) ───
  console.log("\n🧪 TEST 1: check_domain_availability — available domain");
  const t1 = await client.callTool({
    name: "check_domain_availability",
    arguments: { domain: "neverbeforeused999.com" },
  });
  const t1d = parseResult(t1);
  assert(t1d.available === true, "Returns available=true");
  assert(t1d.price !== null, "Returns a price");
  assert(t1d.tld === ".com", "Detects correct TLD");
  assert(typeof t1d.next_action === "string", "Includes next_action hint for AI");

  // ─── TEST 2: check_domain_availability (taken) ───────
  console.log("\n🧪 TEST 2: check_domain_availability — taken domain");
  const t2 = await client.callTool({
    name: "check_domain_availability",
    arguments: { domain: "google.com" },
  });
  const t2d = parseResult(t2);
  assert(t2d.available === false, "Returns available=false");
  assert(Array.isArray(t2d.alternatives_if_taken), "Provides alternatives");
  assert(t2d.alternatives_if_taken.length > 0, "At least one alternative");

  // ─── TEST 3: check_domain_availability (invalid) ─────
  console.log("\n🧪 TEST 3: check_domain_availability — invalid input");
  const t3 = await client.callTool({
    name: "check_domain_availability",
    arguments: { domain: "not a domain!" },
  });
  const t3d = parseResult(t3);
  assert(t3d.error === true, "Returns error for invalid format");

  // ─── TEST 4: suggest_available_domains ───────────────
  console.log("\n🧪 TEST 4: suggest_available_domains");
  const t4 = await client.callTool({
    name: "suggest_available_domains",
    arguments: {
      keywords: "sustainable sneaker brand",
      tlds: [".com", ".co", ".io"],
      max_results: 5,
    },
  });
  const t4d = parseResult(t4);
  assert(Array.isArray(t4d.results), "Returns results array");
  assert(t4d.results.length > 0, `Generated ${t4d.results.length} suggestions`);
  assert(
    t4d.results.every((r: any) => r.domain && r.price && r.tld && typeof r.relevance_score === "number"),
    "All results have domain, price, tld, relevance_score"
  );
  assert(
    t4d.results[0].relevance_score >= t4d.results[t4d.results.length - 1].relevance_score,
    "Results sorted by relevance"
  );

  // ─── TEST 5: register_new_domain ─────────────────────
  console.log("\n🧪 TEST 5: register_new_domain");
  const t5 = await client.callTool({
    name: "register_new_domain",
    arguments: {
      domain: "uniquetestbakery2026.com",
      years: 1,
      registrant: {
        first_name: "Maria",
        last_name: "Ionescu",
        email: "maria@example.com",
        country: "RO",
      },
    },
  });
  const t5d = parseResult(t5);
  assert(t5d.order_id?.startsWith("MCD-"), "Returns order ID with MCD- prefix");
  assert(t5d.status === "pending_payment", "Status is pending_payment");
  assert(t5d.checkout_url?.includes("mcpdomain.ai"), "Returns checkout URL");
  assert(Array.isArray(t5d.next_steps), "Includes next_steps for AI");
  assert(Array.isArray(t5d.included_free), "Lists included free features");

  // ─── TEST 6: register on already-taken domain ────────
  console.log("\n🧪 TEST 6: register_new_domain — already taken");
  const t6 = await client.callTool({
    name: "register_new_domain",
    arguments: {
      domain: "google.com",
      registrant: {
        first_name: "Test",
        last_name: "User",
        email: "test@example.com",
      },
    },
  });
  const t6d = parseResult(t6);
  assert(t6d.error === "domain_not_available", "Refuses to register taken domain");

  // ─── TEST 7: configure_domain_email — catch-all ──────
  console.log("\n🧪 TEST 7: configure_domain_email — catch-all");
  const t7 = await client.callTool({
    name: "configure_domain_email",
    arguments: {
      domain: "uniquetestbakery2026.com",
      catch_all_to: "maria@gmail.com",
    },
  });
  const t7d = parseResult(t7);
  assert(t7d.status === "active", "Email forwarding is active");
  assert(t7d.email_forwards.length === 1, "One forward configured");
  assert(t7d.email_forwards[0].type === "catch_all", "Catch-all type");
  assert(t7d.email_forwards[0].from === "*@uniquetestbakery2026.com", "Catch-all pattern correct");

  // ─── TEST 8: configure_domain_email — aliases ────────
  console.log("\n🧪 TEST 8: configure_domain_email — multiple aliases");
  const t8 = await client.callTool({
    name: "configure_domain_email",
    arguments: {
      domain: "uniquetestbakery2026.com",
      catch_all_to: "maria@gmail.com",
      aliases: [
        { from: "sales", to: "sales@gmail.com" },
        { from: "support", to: "help@gmail.com" },
        { from: "hello", to: "maria@gmail.com" },
      ],
    },
  });
  const t8d = parseResult(t8);
  assert(t8d.email_forwards.length === 4, "1 catch-all + 3 aliases = 4 forwards");

  // ─── TEST 9: configure_domain_dns ────────────────────
  console.log("\n🧪 TEST 9: configure_domain_dns — Vercel hosting");
  const t9 = await client.callTool({
    name: "configure_domain_dns",
    arguments: {
      domain: "uniquetestbakery2026.com",
      records: [
        { type: "A", name: "@", value: "76.76.21.21" },
        { type: "CNAME", name: "www", value: "cname.vercel-dns.com" },
        { type: "TXT", name: "@", value: "v=spf1 include:_spf.google.com ~all" },
      ],
    },
  });
  const t9d = parseResult(t9);
  assert(t9d.status === "propagating", "Status is propagating");
  assert(t9d.records.length >= 3, "All records configured");
  assert(t9d.estimated_propagation.includes("minute"), "Propagation time provided");

  // ─── TEST 10: get_my_domain_details ──────────────────
  console.log("\n🧪 TEST 10: get_my_domain_details — registered domain");
  const t10 = await client.callTool({
    name: "get_my_domain_details",
    arguments: { domain: "uniquetestbakery2026.com" },
  });
  const t10d = parseResult(t10);
  assert(t10d.status === "active", "Domain is active");
  assert(Array.isArray(t10d.nameservers), "Has nameservers");
  assert(t10d.email_forwards.length > 0, "Has email forwards from earlier test");
  assert(t10d.dns_records.length > 0, "Has DNS records from earlier test");
  assert(typeof t10d.ai_bot_intelligence === "object", "Has AI bot intelligence");
  assert(t10d.ai_bot_intelligence.total_requests_30d >= 0, "Reports total request count");
  assert(Array.isArray(t10d.ai_bot_intelligence.bots), "Lists individual bots");

  // ─── TEST 11: get_my_domain_details — not registered ─
  console.log("\n🧪 TEST 11: get_my_domain_details — unregistered");
  const t11 = await client.callTool({
    name: "get_my_domain_details",
    arguments: { domain: "neverregistered.com" },
  });
  const t11d = parseResult(t11);
  assert(t11d.error === "domain_not_found", "Returns not found for unregistered");
  assert(Array.isArray(t11d.suggestions), "Provides helpful suggestions");

  // ─── TEST 12: transfer_existing_domain ───────────────
  console.log("\n🧪 TEST 12: transfer_existing_domain");
  const t12 = await client.callTool({
    name: "transfer_existing_domain",
    arguments: {
      domain: "existingsite.com",
      auth_code: "EPP-ABC123XYZ",
    },
  });
  const t12d = parseResult(t12);
  assert(t12d.transfer_id?.startsWith("TRF-"), "Returns transfer ID");
  assert(t12d.status === "pending_approval", "Status is pending_approval");
  assert(t12d.eta.includes("days"), "Provides ETA");
  assert(Array.isArray(t12d.included_after_transfer), "Lists post-transfer benefits");

  // ─── Cleanup ─────────────────────────────────────────
  await client.close();
  await server.close();

  // ─── Summary ─────────────────────────────────────────
  console.log("\n" + "═".repeat(55));
  console.log(`\n  Tests passed: ${testsPassed}`);
  console.log(`  Tests failed: ${testsFailed}`);
  console.log(`  Total:        ${testsPassed + testsFailed}\n`);

  if (testsFailed === 0) {
    console.log("  🎉 All tests passed! Server is ready for deployment.\n");
    console.log("  Next steps:");
    console.log("    1. npm run build");
    console.log("    2. npm publish (to npm registry as mcpdomain-mcp)");
    console.log("    3. Submit to Smithery: https://smithery.ai");
    console.log("    4. Submit to MCP Registry: github.com/modelcontextprotocol/registry");
    console.log("    5. Deploy HTTP version to https://mcpdomain.ai/mcp\n");
  } else {
    console.log("  ❌ Some tests failed. Fix before publishing.\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
