import assert from "node:assert/strict";
import test from "node:test";
import { freshSchema } from "./helpers";
import { ensureCascadeSchema } from "../data/schema";
import { schemaName } from "../data/pool";
import { closeCascadePools } from "../data/pool";

test.after(async () => closeCascadePools());

test("the canonical migration chain creates exactly the static funnel tables", async () => {
  const pool = await freshSchema();
  const res = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
    [schemaName()],
  );
  assert.deepEqual(
    res.rows.map((r) => r.table_name),
    [
      "contacts",
      "funnel_decisions",
      "funnel_edges",
      "funnel_events",
      "funnel_members",
      "funnel_nodes",
      "funnel_replies",
      "funnels",
      "plain_text_emails",
      "step_outputs",
    ],
  );
});

test("the compatibility schema check never mutates migration-owned structure", async () => {
  const pool = await freshSchema();
  await Promise.all(Array.from({ length: 8 }, () => ensureCascadeSchema(pool)));
  const res = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1`,
    [schemaName()],
  );
  assert.equal(res.rows[0].n, 10, "table count unchanged after concurrent ensure");
});
