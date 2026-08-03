import assert from "node:assert/strict";
import test from "node:test";
import { freshSchema } from "./helpers";
import { ensureCascadeSchema } from "../data/schema";
import { schemaName } from "../data/pool";

test("the canonical migration chain creates all Cascade engine tables", async () => {
  const pool = await freshSchema();
  const res = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
    [schemaName()],
  );
  assert.deepEqual(
    res.rows.map((r) => r.table_name),
    [
      "assets",
      "cascade_settings",
      "contacts",
      "content",
      "delivery_domains",
      "delivery_provider_connections",
      "delivery_sender_identities",
      "emails",
      "enrollments",
      "events",
      "funnel_routes",
      "funnel_steps",
      "funnels",
      "offers",
      "sends",
      "stage_daily_stats",
      "templates",
      "variant_stats",
      "variants",
      "webhook_receipts",
    ],
  );
});

test("the compatibility schema check is idempotent", async () => {
  const pool = await freshSchema();
  await ensureCascadeSchema(pool); // second run must not throw
});

test("the compatibility schema check is safe to run concurrently", async () => {
  const pool = await freshSchema();
  await Promise.all(Array.from({ length: 8 }, () => ensureCascadeSchema(pool)));
  const res = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1`,
    [schemaName()],
  );
  assert.ok(res.rows[0].n >= 15, "tables exist after concurrent ensure");
});
