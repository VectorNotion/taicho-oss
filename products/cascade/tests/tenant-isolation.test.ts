import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { createContact } from "../data/contact-repository";
import {
  configureDeliveryProvider,
  findDeliveryWebhookConfiguration,
  listDeliverySettings,
} from "../data/delivery-settings-repository";
import {
  createFunnel,
  getFunnelDetail,
  listFunnels,
} from "../data/funnel-repository";
import { freshSchema } from "./helpers";

function databaseUrl(user?: string, password?: string): string {
  const source = process.env.DATABASE_URL
    ?? `postgresql://${encodeURIComponent(process.env.POSTGRES_USER ?? "postgres")}:${encodeURIComponent(process.env.POSTGRES_PASSWORD ?? "postgres")}@${process.env.POSTGRES_HOST ?? "localhost"}:${process.env.POSTGRES_PORT ?? "5432"}/${process.env.POSTGRES_DB ?? "langgraph"}`;
  const url = new URL(source);
  if (user) url.username = user;
  if (password) url.password = password;
  return url.toString();
}

test("Cascade runtime role blocks cross-organization reads and writes", async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const role = `cascade_test_${process.pid}_${suffix.slice(0, 10)}`;
  const password = `T3st${suffix}`;
  const orgA = `cascade_a_${suffix}`;
  const orgB = `cascade_b_${suffix}`;
  const admin = new Pool({
    connectionString: databaseUrl(),
    options: "-csearch_path=cascade",
  });
  const previousSchema = process.env.CASCADE_SCHEMA;
  const previousRole = process.env.CASCADE_DATABASE_ROLE;
  let poolA: Pool | undefined;
  let poolB: Pool | undefined;

  try {
    await freshSchema();
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`,
    );
    await admin.query(`GRANT USAGE ON SCHEMA cascade TO "${role}"`);
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA cascade TO "${role}"`);
    await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA cascade TO "${role}"`);
    process.env.CASCADE_SCHEMA = "cascade";
    process.env.CASCADE_DATABASE_ROLE = role;

    const runtimeUrl = databaseUrl(role, password);
    poolA = new Pool({
      connectionString: runtimeUrl,
      options: `-csearch_path=cascade -capp.organization_id=${orgA}`,
    });
    poolB = new Pool({
      connectionString: runtimeUrl,
      options: `-csearch_path=cascade -capp.organization_id=${orgB}`,
    });

    const a = await createFunnel(poolA, {
      name: "Private A",
      steps: [{ type: "delay", config: { seconds: 1 } }],
    });
    const b = await createFunnel(poolB, {
      name: "Private B",
      steps: [{ type: "delay", config: { seconds: 1 } }],
    });
    await createContact(poolA, { email: "same@example.test" });
    await createContact(poolB, { email: "same@example.test" });
    const providerA = await configureDeliveryProvider(poolA, {
      provider: "resend",
      apiKey: "tenant-a-resend-key",
      webhookSecret: "tenant-a-webhook-secret",
    });
    const providerB = await configureDeliveryProvider(poolB, {
      provider: "resend",
      apiKey: "tenant-b-resend-key",
      webhookSecret: "tenant-b-webhook-secret",
    });

    assert.deepEqual((await listFunnels(poolA)).map((item) => item.name), ["Private A"]);
    assert.deepEqual((await listFunnels(poolB)).map((item) => item.name), ["Private B"]);
    assert.deepEqual(
      (await listDeliverySettings(poolA)).providers.map((item) => item.id),
      [providerA.id],
    );
    assert.deepEqual(
      (await listDeliverySettings(poolB)).providers.map((item) => item.id),
      [providerB.id],
    );
    assert.equal(await findDeliveryWebhookConfiguration(poolB, providerA.id), null);
    assert.equal(await findDeliveryWebhookConfiguration(poolA, providerB.id), null);
    assert.equal(await getFunnelDetail(poolB, a.funnel.id), null);
    assert.equal(await getFunnelDetail(poolA, b.funnel.id), null);
    assert.equal(
      (await poolB.query("UPDATE funnels SET name='forbidden' WHERE id=$1", [a.funnel.id])).rowCount,
      0,
    );

    await assert.rejects(
      poolB.query(
        `INSERT INTO funnel_steps (funnel_id, position, type, config)
         VALUES ($1, 2, 'delay', '{"seconds":1}')`,
        [a.funnel.id],
      ),
      /foreign key constraint/,
    );
    await assert.rejects(
      poolB.query(
        "INSERT INTO funnels (name, organization_id) VALUES ('forbidden', $1)",
        [orgA],
      ),
      /row-level security policy/,
    );
    assert.equal(
      (
        await poolB.query(
          `UPDATE delivery_provider_connections
              SET display_name='forbidden'
            WHERE id=$1`,
          [providerA.id],
        )
      ).rowCount,
      0,
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
