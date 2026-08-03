import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { createContact } from "../data/contact-repository";
import {
  addFunnelMember,
  createFunnel,
  getFunnel,
  listFunnelMembers,
  listFunnels,
} from "../data/funnel-repository";
import {
  createPlainTextEmail,
  listPlainTextEmails,
} from "../data/plain-text-email-repository";
import { freshSchema } from "./helpers";
import { closeCascadePools } from "../data/pool";

test.after(async () => closeCascadePools());

function databaseUrl(user?: string, password?: string): string {
  const source = process.env.DATABASE_URL
    ?? `postgresql://${encodeURIComponent(process.env.POSTGRES_USER ?? "postgres")}:${encodeURIComponent(process.env.POSTGRES_PASSWORD ?? "postgres")}@${process.env.POSTGRES_HOST ?? "localhost"}:${process.env.POSTGRES_PORT ?? "5432"}/${process.env.POSTGRES_DB ?? "langgraph"}`;
  const url = new URL(source);
  if (user) url.username = user;
  if (password) url.password = password;
  return url.toString();
}

test("Cascade runtime role isolates funnel lists, members, and emails by organization", async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const role = `cascade_test_${process.pid}_${suffix.slice(0, 10)}`;
  const password = `T3st${suffix}`;
  const orgA = `cascade_a_${suffix}`;
  const orgB = `cascade_b_${suffix}`;
  const admin = new Pool({ connectionString: databaseUrl(), options: "-csearch_path=cascade" });
  const previousSchema = process.env.CASCADE_SCHEMA;
  const previousRole = process.env.CASCADE_DATABASE_ROLE;
  let poolA: Pool | undefined;
  let poolB: Pool | undefined;

  try {
    await freshSchema();
    await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
    await admin.query(`GRANT USAGE ON SCHEMA cascade TO "${role}"`);
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA cascade TO "${role}"`);
    await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA cascade TO "${role}"`);
    process.env.CASCADE_SCHEMA = "cascade";
    process.env.CASCADE_DATABASE_ROLE = role;

    const runtimeUrl = databaseUrl(role, password);
    poolA = new Pool({ connectionString: runtimeUrl, options: `-csearch_path=cascade -capp.organization_id=${orgA}` });
    poolB = new Pool({ connectionString: runtimeUrl, options: `-csearch_path=cascade -capp.organization_id=${orgB}` });

    const funnelA = await createFunnel(poolA, { name: "Private A" });
    const funnelB = await createFunnel(poolB, { name: "Private B" });
    const contactA = await createContact(poolA, { email: "same@example.test" });
    const contactB = await createContact(poolB, { email: "same@example.test" });
    await addFunnelMember(poolA, { funnelId: funnelA.id, contactId: contactA.id });
    await addFunnelMember(poolB, { funnelId: funnelB.id, contactId: contactB.id });
    await createPlainTextEmail(poolA, { funnelId: funnelA.id, name: "A", subject: "A only", body: "Text A" });
    await createPlainTextEmail(poolB, { funnelId: funnelB.id, name: "B", subject: "B only", body: "Text B" });

    assert.deepEqual((await listFunnels(poolA)).map((item) => item.name), ["Private A"]);
    assert.deepEqual((await listFunnels(poolB)).map((item) => item.name), ["Private B"]);
    assert.deepEqual((await listFunnelMembers(poolA, funnelA.id)).map((item) => item.email), ["same@example.test"]);
    assert.deepEqual((await listPlainTextEmails(poolA, funnelA.id)).map((item) => item.subject), ["A only"]);
    assert.equal(await getFunnel(poolB, funnelA.id), null);
    assert.equal((await listFunnelMembers(poolB, funnelA.id)).length, 0);
    assert.equal((await listPlainTextEmails(poolB, funnelA.id)).length, 0);
    assert.equal((await poolB.query("UPDATE funnels SET name='forbidden' WHERE id=$1", [funnelA.id])).rowCount, 0);
    assert.equal((await poolB.query("UPDATE plain_text_emails SET subject='forbidden' WHERE funnel_id=$1", [funnelA.id])).rowCount, 0);
    await assert.rejects(
      poolB.query("INSERT INTO funnels (name, organization_id) VALUES ('forbidden', $1)", [orgA]),
      /row-level security policy/,
    );
  } finally {
    await Promise.all([poolA?.end(), poolB?.end()]);
    await admin.query(`DROP OWNED BY "${role}"`).catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS "${role}"`).catch(() => undefined);
    await admin.end();
    if (previousSchema === undefined) delete process.env.CASCADE_SCHEMA;
    else process.env.CASCADE_SCHEMA = previousSchema;
    if (previousRole === undefined) delete process.env.CASCADE_DATABASE_ROLE;
    else process.env.CASCADE_DATABASE_ROLE = previousRole;
  }
});
