import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import {
  getChannel,
  listChannels,
  upsertChannel,
} from "../publishing/channel-repository";
import {
  getPost,
  schedulePost,
} from "../publishing/post-repository";

function databaseUrl(user?: string, password?: string): string {
  const source = process.env.DATABASE_URL
    ?? `postgresql://${encodeURIComponent(process.env.POSTGRES_USER ?? "postgres")}:${encodeURIComponent(process.env.POSTGRES_PASSWORD ?? "postgres")}@${process.env.POSTGRES_HOST ?? "localhost"}:${process.env.POSTGRES_PORT ?? "5432"}/${process.env.POSTGRES_DB ?? "langgraph"}`;
  const url = new URL(source);
  if (user) url.username = user;
  if (password) url.password = password;
  return url.toString();
}

test("publishing runtime role blocks cross-organization channels and queue work", async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const schema = "publishing";
  const role = `publishing_test_${process.pid}_${suffix.slice(0, 10)}`;
  const password = `T3st${suffix}`;
  const orgA = `publishing_a_${suffix}`;
  const orgB = `publishing_b_${suffix}`;
  const admin = new Pool({ connectionString: databaseUrl() });
  let poolA: Pool | undefined;
  let poolB: Pool | undefined;

  try {
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`,
    );
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`);
    await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO "${role}"`);

    const runtimeUrl = databaseUrl(role, password);
    poolA = new Pool({
      connectionString: runtimeUrl,
      options: `-csearch_path=${schema} -capp.organization_id=${orgA}`,
    });
    poolB = new Pool({
      connectionString: runtimeUrl,
      options: `-csearch_path=${schema} -capp.organization_id=${orgB}`,
    });

    await upsertChannel(poolA, {
      id: "shared-provider-id",
      destination: "webhook",
      name: "A shared ID",
      credentialKind: "none",
      credentials: {},
    });
    await upsertChannel(poolB, {
      id: "shared-provider-id",
      destination: "webhook",
      name: "B shared ID",
      credentialKind: "none",
      credentials: {},
    });
    const privateA = await upsertChannel(poolA, {
      id: "private-a",
      destination: "webhook",
      name: "Private A",
      credentialKind: "none",
      credentials: {},
    });
    const postA = await schedulePost(poolA, {
      destination: privateA.destination,
      channelId: privateA.id,
      copy: { title: "Tenant A only" },
    });

    assert.deepEqual(
      (await listChannels(poolA)).map((item) => item.name).sort(),
      ["A shared ID", "Private A"],
    );
    assert.deepEqual(
      (await listChannels(poolB)).map((item) => item.name),
      ["B shared ID"],
    );
    assert.equal(await getChannel(poolB, privateA.id), null);
    assert.equal(await getPost(poolB, postA.id), null);
    assert.equal(
      (await poolB.query("UPDATE posts SET status='cancelled' WHERE id=$1", [postA.id])).rowCount,
      0,
    );

    await assert.rejects(
      schedulePost(poolB, {
        destination: privateA.destination,
        channelId: privateA.id,
        copy: { title: "Cross-tenant channel" },
      }),
      (error: unknown) => {
        const cause = error && typeof error === "object" && "cause" in error
          ? (error as { cause?: unknown }).cause
          : undefined;
        return cause instanceof Error && /foreign key constraint/.test(cause.message);
      },
    );
    await assert.rejects(
      poolB.query(
        `INSERT INTO channels
           (id, destination, name, credential_kind, org_id)
         VALUES ('forbidden', 'webhook', 'Forbidden', 'none', $1)`,
        [orgA],
      ),
      /row-level security policy/,
    );
  } finally {
    await Promise.all([poolA?.end(), poolB?.end()]);
    await admin.query(`DELETE FROM "${schema}".posts WHERE organization_id IN ($1, $2)`, [orgA, orgB]).catch(() => undefined);
    await admin.query(`DELETE FROM "${schema}".channels WHERE org_id IN ($1, $2)`, [orgA, orgB]).catch(() => undefined);
    await admin.query(`DROP OWNED BY "${role}"`).catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS "${role}"`).catch(() => undefined);
    await admin.end();
  }
});
