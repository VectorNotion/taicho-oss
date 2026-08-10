// Own scratch schema so cascade's own tests (cascade_test) and this file never collide.
process.env.CASCADE_SCHEMA = "cascade_platform_test";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { createContact } from "@/products/cascade/data/contact-repository";
import { createFunnel, listFunnelMembers } from "@/products/cascade/data/funnel-repository";
import { getCascadePool } from "@/products/cascade/data/pool";
import { dropCascadeSchema, ensureCascadeSchema } from "@/products/cascade/data/schema";
import { createProspect } from "@/products/outreach/data/prospect-repository";
import { closeDriver } from "../data/graph";
import { runWithGraphOrganization } from "../data/organization-context";
import { runAddToFunnel } from "../agents/add-to-funnel";

// One per-run organization for both sides: the graph context the handler reads
// with requireGraphOrganizationId() and the Cascade pool it derives from it.
// (Deviation from the plan's hard-coded "legacy": a per-run id keeps the test
// out of the developer's legacy graph and out of sibling test runs' rows.)
const ORGANIZATION_ID = `platform-enroll-${randomUUID()}`;
const inOrg = <T>(work: () => Promise<T>) => runWithGraphOrganization(ORGANIZATION_ID, work);

/** Same drop/recreate pattern as products/cascade/tests/helpers.ts. */
async function freshSchema() {
  const pool = getCascadePool(ORGANIZATION_ID);
  await dropCascadeSchema(pool);
  await ensureCascadeSchema(pool);
  return pool;
}

test("payload validation fails before any I/O", async () => {
  await assert.rejects(
    () => inOrg(() => runAddToFunnel({ funnelId: "", contactId: "c" })),
    /funnelId is required/,
  );
  await assert.rejects(() => inOrg(() => runAddToFunnel({ funnelId: "f" })), /prospectId or contactId/);
});

test("refuses to run outside an organization context", async () => {
  await assert.rejects(
    () => runAddToFunnel({ funnelId: "f", contactId: "c" }),
    /outside an organization context/,
  );
});

test(
  "contactId path adds an existing Cascade contact to the funnel list",
  { skip: process.env.PLATFORM_DB_TESTS !== "1" },
  async () => {
    const pool = await freshSchema();
    const funnel = await createFunnel(pool, { name: "onboarding" });
    const contact = await createContact(pool, { email: "contact@example.com" });
    const result = await inOrg(() => runAddToFunnel({ funnelId: funnel.id, contactId: contact.id }));
    assert.equal(result.funnelId, funnel.id);
    assert.equal(result.contactId, contact.id);
    assert.equal((await listFunnelMembers(pool, funnel.id))[0].id, result.memberId);
  },
);

test(
  "prospectId path imports the prospect into Cascade and adds it to the list",
  { skip: process.env.PLATFORM_DB_TESTS !== "1" }, // needs FalkorDB + Postgres (docker compose up -d)
  async () => {
    const pool = await freshSchema();
    const funnel = await createFunnel(pool, { name: "prospect-nurture" });
    const email = `prospect-${randomUUID()}@example.com`;
    const prospect = await inOrg(() =>
      createProspect({
        name: "Ada Lovelace",
        email,
        company: "Analytical",
        title: "Engineer",
        source: "manual",
      }),
    );
    const result = await inOrg(() => runAddToFunnel({ funnelId: funnel.id, prospectId: prospect.id }));
    const contact = await pool.query(
      `SELECT email, outreach_prospect_id, workspace_contact_linked_at FROM contacts WHERE id = $1`,
      [result.contactId],
    );
    assert.equal(contact.rows[0].email, email);
    assert.equal(contact.rows[0].outreach_prospect_id, prospect.id);
    assert.ok(contact.rows[0].workspace_contact_linked_at);

    // Re-running is safe: the existing membership is returned, not duplicated.
    const again = await inOrg(() => runAddToFunnel({ funnelId: funnel.id, prospectId: prospect.id }));
    assert.equal(again.memberId, result.memberId);
  },
);

test(
  "a prospect without an email is rejected with a clear error",
  { skip: process.env.PLATFORM_DB_TESTS !== "1" },
  async () => {
    const pool = await freshSchema();
    const funnel = await createFunnel(pool, { name: "no-email" });
    const prospect = await inOrg(() =>
      createProspect({ name: "No Email", company: "Acme", source: "manual" }),
    );
    await assert.rejects(
      () => inOrg(() => runAddToFunnel({ funnelId: funnel.id, prospectId: prospect.id })),
      /has no email/,
    );
  },
);

after(async () => {
  if (process.env.PLATFORM_DB_TESTS === "1") {
    const pool = getCascadePool(ORGANIZATION_ID);
    await dropCascadeSchema(pool);
    await pool.end();
    // The graph driver keeps the event loop alive otherwise (same reason
    // falkordb-tenant-isolation.test.ts closes it).
    await closeDriver();
  }
});
