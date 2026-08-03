import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { freshSchema } from "./helpers";
import { createFunnel } from "../data/funnel-repository";
import { createContact } from "../data/contact-repository";
import { enrollContact } from "../data/enrollment-repository";
import { LogMailer } from "../engine/mailer";
import { runSendLoop } from "../engine/send-loop";
import { runTick } from "../engine/tick";

async function enrollmentRow(pool: Pool, id: string) {
  const res = await pool.query(`SELECT state, current_step_id, next_run_at FROM enrollments WHERE id = $1`, [id]);
  return res.rows[0];
}

test("walks a funnel end to end: enqueue, flush, completed", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { funnel } = await createFunnel(pool, {
    name: "walk",
    steps: [
      { type: "email", config: { subject: "one", body: "first" } },
      { type: "delay", config: { seconds: 0 } },
      { type: "email", config: { subject: "two", body: "second" } },
    ],
  });
  const contact = await createContact(pool, { email: "walk@example.com" });
  const enrollment = await enrollContact(pool, funnel.id, contact.id);

  // A zero-delay funnel is fully due at every advance, so one tick walks all
  // three steps: batchSize bounds step executions, not enrollments.
  const t1 = await runTick(pool);
  assert.deepEqual([t1.processed, t1.queued, t1.completed], [3, 2, 1]);
  const idle = await runTick(pool);
  assert.equal(idle.processed, 0);

  const flushed = await runSendLoop(pool, mailer);
  assert.deepEqual([flushed.sent, flushed.failed, flushed.skipped], [2, 0, 0]);
  assert.deepEqual(mailer.sent.map((m) => m.subject), ["one", "two"]);

  const row = await enrollmentRow(pool, enrollment.id);
  assert.equal(row.state, "completed");
  assert.equal(row.current_step_id, null);

  const events = await pool.query(`SELECT type FROM events WHERE enrollment_id = $1`, [enrollment.id]);
  assert.deepEqual(events.rows.map((r) => r.type), ["sent", "sent"]);
});

test("a future delay parks the enrollment", async () => {
  const pool = await freshSchema();
  const { funnel } = await createFunnel(pool, {
    name: "parked",
    steps: [
      { type: "delay", config: { seconds: 3600 } },
      { type: "email", config: { subject: "later", body: "b" } },
    ],
  });
  const contact = await createContact(pool, { email: "parked@example.com" });
  const enrollment = await enrollContact(pool, funnel.id, contact.id);

  await runTick(pool); // executes the delay, parks 1h out
  const idle = await runTick(pool);
  assert.equal(idle.processed, 0); // nothing due
  const row = await enrollmentRow(pool, enrollment.id);
  assert.equal(row.state, "active");
  assert.ok(new Date(row.next_run_at).getTime() > Date.now() + 3500 * 1000);
});

test("a retried step can never double-send", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { funnel, steps } = await createFunnel(pool, {
    name: "retry",
    steps: [{ type: "email", config: { subject: "once", body: "b" } }],
  });
  const contact = await createContact(pool, { email: "retry@example.com" });
  const enrollment = await enrollContact(pool, funnel.id, contact.id);

  await runTick(pool);
  await runSendLoop(pool, mailer);
  assert.equal(mailer.sent.length, 1);

  // Simulate a crash-after-enqueue-before-advance: rewind the cursor.
  await pool.query(
    `UPDATE enrollments SET state = 'active', current_step_id = $2, next_run_at = now() WHERE id = $1`,
    [enrollment.id, steps[0].id],
  );
  const retry = await runTick(pool);
  assert.equal(retry.processed, 1);
  assert.equal(retry.queued, 0); // unique(enrollment_id, step_id) blocked the duplicate
  await runSendLoop(pool, mailer);
  assert.equal(mailer.sent.length, 1);
  const sends = await pool.query(`SELECT count(*)::int AS n FROM sends WHERE enrollment_id = $1`, [enrollment.id]);
  assert.equal(sends.rows[0].n, 1);
});

test("suppression gate: unsubscribed contacts are skipped, not sent", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { funnel } = await createFunnel(pool, {
    name: "suppressed",
    steps: [{ type: "email", config: { subject: "no", body: "b" } }],
  });
  const contact = await createContact(pool, {
    email: "unsub@example.com",
    subscriptionStatus: "unsubscribed",
  });
  const enrollment = await enrollContact(pool, funnel.id, contact.id);

  const t = await runTick(pool);
  assert.deepEqual([t.processed, t.queued, t.completed], [1, 0, 1]);
  await runSendLoop(pool, mailer);
  assert.equal(mailer.sent.length, 0);
  const sends = await pool.query(`SELECT status FROM sends WHERE enrollment_id = $1`, [enrollment.id]);
  assert.deepEqual(sends.rows.map((r) => r.status), ["skipped"]);
});
