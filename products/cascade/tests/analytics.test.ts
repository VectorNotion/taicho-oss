import assert from "node:assert/strict";
import test from "node:test";
import { freshSchema } from "./helpers";
import { createFunnel } from "../data/funnel-repository";
import { enrollContact } from "../data/enrollment-repository";
import { StaticContentSource, syncAssets } from "../data/asset-repository";
import { importOutreachLead } from "../data/intake";
import { funnelMetrics, runDailyRollup } from "../data/rollups";
import { LogMailer } from "../engine/mailer";
import { runSendLoop } from "../engine/send-loop";
import { runTick } from "../engine/tick";
import { recordClick, recordOpen } from "../engine/ingest";

test("syncAssets upserts by source id", async () => {
  const pool = await freshSchema();
  const v1 = new StaticContentSource([
    { sourceId: "vid-1", type: "video", title: "Old title", url: "https://v/1", topics: ["ai"] },
  ]);
  await syncAssets(pool, v1);
  const v2 = new StaticContentSource([
    { sourceId: "vid-1", type: "video", title: "New title", url: "https://v/1", topics: ["ai"] },
    { sourceId: "post-1", type: "article", title: "Post", url: "https://p/1", topics: [] },
  ]);
  const res = await syncAssets(pool, v2);
  assert.equal(res.synced, 2);

  const rows = await pool.query(`SELECT source_id, title FROM assets ORDER BY source_id`);
  assert.deepEqual(rows.rows, [
    { source_id: "post-1", title: "Post" },
    { source_id: "vid-1", title: "New title" },
  ]);
});

test("importOutreachLead upserts by email and merges attributes", async () => {
  const pool = await freshSchema();
  const first = await importOutreachLead(pool, {
    email: "lead@corp.com",
    outreachLeadId: "lead-42",
    attributes: { company: "Corp" },
  });
  assert.equal(first.outreachLeadId, "lead-42");

  const second = await importOutreachLead(pool, {
    email: "lead@corp.com",
    outreachLeadId: "lead-42-v2",
    attributes: { title: "CTO" },
  });
  assert.equal(second.id, first.id);
  assert.deepEqual(second.attributes, { company: "Corp", title: "CTO" });
  assert.equal(second.outreachLeadId, "lead-42-v2");
});

test("daily rollup aggregates events and is re-runnable", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { funnel, steps } = await createFunnel(pool, {
    name: "metrics",
    steps: [{ type: "email", config: { subject: "m", body: `<a href="https://x.example/a">a</a>` } }],
  });
  const contact = await importOutreachLead(pool, { email: "m@example.com", outreachLeadId: "l1" });
  const enrollment = await enrollContact(pool, funnel.id, contact.id);
  await runTick(pool);
  await runSendLoop(pool, mailer);
  const send = await pool.query(`SELECT id FROM sends WHERE enrollment_id = $1`, [enrollment.id]);
  await recordOpen(pool, send.rows[0].id);
  await recordClick(pool, send.rows[0].id, "https://x.example/a", false);

  const today = new Date().toISOString().slice(0, 10);
  await runDailyRollup(pool, today);
  await runDailyRollup(pool, today); // re-run must not duplicate

  const stats = await pool.query(
    `SELECT organization_id,sends,opens,clicks,interests
       FROM stage_daily_stats`,
  );
  assert.equal(stats.rowCount, 1);
  assert.deepEqual(stats.rows[0], {
    organization_id: "legacy",
    sends: 1,
    opens: 1,
    clicks: 1,
    interests: 0,
  });

  const metrics = await funnelMetrics(pool, funnel.id);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].stepId, steps[0].id);
  assert.deepEqual(
    [metrics[0].sends, metrics[0].opens, metrics[0].clicks, metrics[0].interests],
    [1, 1, 1, 0],
  );
});
