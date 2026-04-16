/**
 * Integration test: MCP server → Backend
 *
 * Verifies that when register_new_domain is called on the MCP server
 * with BACKEND_URL set, it actually creates an order via the backend's
 * /api/checkout/create endpoint.
 *
 * Run AFTER starting the backend on port 3500.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMCPDomainServer } from "./server.js";

async function main() {
  if (!process.env.BACKEND_URL) {
    console.error("ERROR: BACKEND_URL must be set for this test");
    process.exit(1);
  }
  console.log(`Testing MCP → Backend integration`);
  console.log(`Backend URL: ${process.env.BACKEND_URL}\n`);

  const server = createMCPDomainServer();
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "integration-test", version: "1.0.0" });
  await server.connect(s);
  await client.connect(c);

  // Call register_new_domain — this should hit the backend
  const result = await client.callTool({
    name: "register_new_domain",
    arguments: {
      domain: "fullintegration.com",
      years: 1,
      registrant: {
        first_name: "Maria",
        last_name: "Test",
        email: "maria@example.com",
        country: "RO",
      },
    },
  });

  const data = JSON.parse((result.content as any)[0].text);
  console.log("Response from register_new_domain:");
  console.log(JSON.stringify(data, null, 2));
  console.log();

  // Assertions
  let pass = true;

  if (data.error) {
    console.error("FAIL: register_new_domain returned an error");
    console.error(data);
    pass = false;
  }

  if (!data.checkout_url?.includes(process.env.BACKEND_URL!)) {
    console.error(`FAIL: checkout_url does not contain backend URL`);
    console.error(`  expected to contain: ${process.env.BACKEND_URL}`);
    console.error(`  got: ${data.checkout_url}`);
    pass = false;
  }

  if (!data.order_id?.startsWith("MCD-")) {
    console.error(`FAIL: order_id format wrong: ${data.order_id}`);
    pass = false;
  }

  if (pass) {
    console.log("✓ PASS: MCP server successfully called backend for order creation");
    console.log(`  Order ID: ${data.order_id}`);
    console.log(`  Checkout: ${data.checkout_url}`);
  }

  await client.close();
  await server.close();

  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("Test crashed:", e);
  process.exit(1);
});
