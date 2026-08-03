import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { freshSchema } from "./helpers";
import { appendFunnelStep, createFunnel, setFunnelRoute } from "../data/funnel-repository";
import { createContact } from "../data/contact-repository";
import { enrollContact } from "../data/enrollment-repository";
import { LogMailer } from "../engine/mailer";
import { runSendLoop } from "../engine/send-loop";
import { runTick } from "../engine/tick";
import { recordClick } from "../engine/ingest";

async function enrollments(pool: Pool, contactId: string) {
  const res = await pool.query(
    `SELECT funnel_id, state FROM enrollments WHERE contact_id = $1 ORDER BY created_at`,
    [contactId],
  );
  return res.rows;
}

test("branch takes the then-path on a matching event, else-path otherwise", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  // Delay gates the branch so clicks can arrive first; each path terminates
  // (goal / funnel end) so zero-delay chaining can't cross paths.
  const { funnel } = await createFunnel(pool, {
    name: "brancher",
    steps: [
      { type: "email", config: { subject: "e1", body: "b" } },
      { type: "delay", config: { seconds: 3600 } },
      { type: "branch", config: { condition: { kind: "event", type: "click" }, thenPosition: 4, elsePosition: 6 } },
      { type: "email", config: { subject: "clicked-path", body: "b" } },
      { type: "goal", config: {} },
      { type: "email", config: { subject: "quiet-path", body: "b" } },
    ],
  });

  // Contact A clicks; contact B does not.
  const a = await createContact(pool, { email: "a@example.com" });
  const b = await createContact(pool, { email: "b@example.com" });
  const ea = await enrollContact(pool, funnel.id, a.id);
  await enrollContact(pool, funnel.id, b.id);

  await runTick(pool); // e1 queued, both parked at the branch behind the delay
  await runSendLoop(pool, mailer);

  const sendA = await pool.query(`SELECT id FROM sends WHERE enrollment_id = $1`, [ea.id]);
  await recordClick(pool, sendA.rows[0].id, "https://example.com/x", false);

  // Fast-forward the delay.
  await pool.query(`UPDATE enrollments SET next_run_at = now() WHERE state = 'active'`);
  await runTick(pool);
  await runSendLoop(pool, mailer);

  const subjects = mailer.sent.map((m) => `${m.to}:${m.subject}`).sort();
  assert.ok(subjects.includes("a@example.com:clicked-path"));
  assert.ok(subjects.includes("b@example.com:quiet-path"));
  assert.ok(!subjects.includes("a@example.com:quiet-path"));
  assert.ok(!subjects.includes("b@example.com:clicked-path"));
});

test("attribute branch matches contact attributes", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { funnel } = await createFunnel(pool, {
    name: "attr",
    steps: [
      { type: "branch", config: { condition: { kind: "attribute", key: "plan", equals: "pro" }, thenPosition: 2, elsePosition: 4 } },
      { type: "email", config: { subject: "pro-path", body: "b" } },
      { type: "goal", config: {} },
      { type: "email", config: { subject: "free-path", body: "b" } },
    ],
  });
  const pro = await createContact(pool, { email: "pro@example.com" });
  await pool.query(`UPDATE contacts SET attributes = '{"plan":"pro"}' WHERE id = $1`, [pro.id]);
  await enrollContact(pool, funnel.id, pro.id);

  await runTick(pool);
  await runSendLoop(pool, mailer);
  assert.deepEqual(mailer.sent.map((m) => m.subject), ["pro-path"]);
});

test("completed funnel routes the contact to the next funnel", async () => {
  const pool = await freshSchema();
  const { funnel: first } = await createFunnel(pool, {
    name: "first",
    steps: [{ type: "goal", config: {} }],
  });
  // Delay first so the routed enrollment is still active after the tick
  // drains (a trailing delay would complete instantly — delays gate the
  // NEXT step, they don't hold a funnel open at its end).
  const { funnel: second } = await createFunnel(pool, {
    name: "second",
    steps: [
      { type: "delay", config: { seconds: 3600 } },
      { type: "email", config: { subject: "welcome-2", body: "b" } },
    ],
  });
  await setFunnelRoute(pool, first.id, "completed", second.id);

  const contact = await createContact(pool, { email: "route@example.com" });
  await enrollContact(pool, first.id, contact.id);
  await runTick(pool);

  const rows = await enrollments(pool, contact.id);
  assert.deepEqual(
    rows.map((r) => [r.funnel_id, r.state]),
    [
      [first.id, "completed"],
      [second.id, "active"],
    ],
  );
});

test("interest click stops the current enrollment and routes to the interest funnel", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { funnel: onboarding } = await createFunnel(pool, {
    name: "onboarding",
    steps: [
      { type: "email", config: { subject: "e1", body: `<a href="https://example.com/book">book</a>` } },
      { type: "delay", config: { seconds: 3600 } },
      { type: "email", config: { subject: "e2", body: "b" } },
    ],
  });
  const { funnel: discovery } = await createFunnel(pool, {
    name: "discovery",
    steps: [{ type: "email", config: { subject: "disco", body: "b" } }],
  });
  await setFunnelRoute(pool, onboarding.id, "interest", discovery.id);

  const contact = await createContact(pool, { email: "hot@example.com" });
  const enrollment = await enrollContact(pool, onboarding.id, contact.id);
  await runTick(pool);
  await runSendLoop(pool, mailer);

  const send = await pool.query(`SELECT id FROM sends WHERE enrollment_id = $1`, [enrollment.id]);
  const result = await recordClick(pool, send.rows[0].id, "https://example.com/book", true);
  assert.equal(result.routed, true);

  const rows = await enrollments(pool, contact.id);
  assert.deepEqual(
    rows.map((r) => [r.funnel_id, r.state]),
    [
      [onboarding.id, "stopped"],
      [discovery.id, "active"],
    ],
  );
});

test("open-ended funnels park at the frontier and wake on append", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { funnel: queue } = await createFunnel(pool, { name: "newsletter", steps: [], openEnded: true });
  const contact = await createContact(pool, { email: "news@example.com" });
  const enrollment = await enrollContact(pool, queue.id, contact.id);
  assert.equal(enrollment.currentStepId, null);

  const idle = await runTick(pool);
  assert.equal(idle.processed, 0); // frontier: nothing due

  await appendFunnelStep(pool, queue.id, { type: "email", config: { subject: "issue-1", body: "b" } });
  const t = await runTick(pool);
  assert.equal(t.processed, 1); // the email step; frontier re-park happens in its advance
  await runSendLoop(pool, mailer);
  assert.deepEqual(mailer.sent.map((m) => m.subject), ["issue-1"]);

  const row = await pool.query(`SELECT state, current_step_id FROM enrollments WHERE id = $1`, [enrollment.id]);
  assert.equal(row.rows[0].state, "active"); // never completes
  assert.equal(row.rows[0].current_step_id, null); // parked again
});

test("routing never duplicates an active enrollment", async () => {
  const pool = await freshSchema();
  const { funnel: a } = await createFunnel(pool, { name: "a", steps: [{ type: "goal", config: {} }] });
  const { funnel: b } = await createFunnel(pool, {
    name: "b",
    steps: [
      { type: "delay", config: { seconds: 3600 } },
      { type: "email", config: { subject: "held", body: "x" } },
    ],
  });
  await setFunnelRoute(pool, a.id, "completed", b.id);
  const contact = await createContact(pool, { email: "dup@example.com" });

  await enrollContact(pool, a.id, contact.id);
  await runTick(pool); // routes into b
  await enrollContact(pool, a.id, contact.id); // second run of funnel a
  await runTick(pool); // would route again — must not duplicate

  const rows = await pool.query(
    `SELECT count(*)::int AS n FROM enrollments WHERE contact_id = $1 AND funnel_id = $2 AND state = 'active'`,
    [contact.id, b.id],
  );
  assert.equal(rows.rows[0].n, 1);
});
