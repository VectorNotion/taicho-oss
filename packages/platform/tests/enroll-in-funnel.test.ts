// Own scratch schema so cascade's own tests (cascade_test) and this file never collide.
process.env.CASCADE_SCHEMA = "cascade_platform_test";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { createContact } from "@/products/cascade/data/contact-repository";
import { createFunnel } from "@/products/cascade/data/funnel-repository";
import { getCascadePool } from "@/products/cascade/data/pool";
import { dropCascadeSchema, ensureCascadeSchema } from "@/products/cascade/data/schema";
import { createLead } from "@/products/outreach/data/lead-repository";
import { closeDriver } from "../data/graph";
import { runWithGraphOrganization } from "../data/organization-context";
import { runEnrollInFunnel } from "../agents/enroll-in-funnel";

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
    () => inOrg(() => runEnrollInFunnel({ funnelId: "", contactId: "c" })),
    /funnelId is required/,
  );
  await assert.rejects(() => inOrg(() => runEnrollInFunnel({ funnelId: "f" })), /leadId or contactId/);
});

test("refuses to run outside an organization context", async () => {
  await assert.rejects(
    () => runEnrollInFunnel({ funnelId: "f", contactId: "c" }),
    /outside an organization context/,
  );
});

test(
  "contactId path enrolls an existing Cascade contact",
  { skip: process.env.PLATFORM_DB_TESTS !== "1" },
  async () => {
    const pool = await freshSchema();
    const { funnel, steps } = await createFunnel(pool, {
      name: "onboarding",
      steps: [{ type: "email", config: { subject: "hi", body: "welcome" } }],
    });
    const contact = await createContact(pool, { email: "contact@example.com" });
    const result = await inOrg(() => runEnrollInFunnel({ funnelId: funnel.id, contactId: contact.id }));
    assert.equal(result.funnelId, funnel.id);
    assert.equal(result.contactId, contact.id);
    assert.equal(result.state, "active");
    const row = await pool.query(`SELECT current_step_id FROM enrollments WHERE id = $1`, [
      result.enrollmentId,
    ]);
    assert.equal(row.rows[0].current_step_id, steps[0].id);
  },
);

test(
  "leadId path imports the lead into Cascade and enrolls it",
  { skip: process.env.PLATFORM_DB_TESTS !== "1" }, // needs FalkorDB + Postgres (docker compose up -d)
  async () => {
    const pool = await freshSchema();
    const { funnel } = await createFunnel(pool, {
      name: "lead-nurture",
      steps: [{ type: "email", config: { subject: "hi", body: "welcome" } }],
    });
    const email = `lead-${randomUUID()}@example.com`;
    const lead = await inOrg(() =>
      createLead({
        name: "Ada Lovelace",
        email,
        company: "Analytical",
        title: "Engineer",
        source: "manual",
      }),
    );
    const result = await inOrg(() => runEnrollInFunnel({ funnelId: funnel.id, leadId: lead.id }));
    assert.equal(result.state, "active");
    const contact = await pool.query(
      `SELECT email, outreach_lead_id, workspace_contact_linked_at FROM contacts WHERE id = $1`,
      [result.contactId],
    );
    assert.equal(contact.rows[0].email, email);
    assert.equal(contact.rows[0].outreach_lead_id, lead.id);
    assert.ok(contact.rows[0].workspace_contact_linked_at);

    // Re-running is safe: the active enrollment is returned, not duplicated.
    const again = await inOrg(() => runEnrollInFunnel({ funnelId: funnel.id, leadId: lead.id }));
    assert.equal(again.enrollmentId, result.enrollmentId);
  },
);

test(
  "a lead without an email is rejected with a clear error",
  { skip: process.env.PLATFORM_DB_TESTS !== "1" },
  async () => {
    const pool = await freshSchema();
    const { funnel } = await createFunnel(pool, {
      name: "no-email",
      steps: [{ type: "email", config: { subject: "hi", body: "welcome" } }],
    });
    const lead = await inOrg(() =>
      createLead({ name: "No Email", company: "Acme", source: "manual" }),
    );
    await assert.rejects(
      () => inOrg(() => runEnrollInFunnel({ funnelId: funnel.id, leadId: lead.id })),
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
