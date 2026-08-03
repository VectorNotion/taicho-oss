import assert from "node:assert/strict";
import test from "node:test";
import { freshSchema } from "./helpers";
import { createFunnel } from "../data/funnel-repository";
import { createContact } from "../data/contact-repository";
import { enrollContact } from "../data/enrollment-repository";
import { claimDueEnrollment } from "../engine/tick";

test("claims only due, active enrollments", async () => {
  const pool = await freshSchema();
  const { funnel } = await createFunnel(pool, {
    name: "f",
    steps: [{ type: "email", config: { subject: "s", body: "b" } }],
  });
  const due = await createContact(pool, { email: "due@example.com" });
  const later = await createContact(pool, { email: "later@example.com" });
  const dueEnrollment = await enrollContact(pool, funnel.id, due.id);
  const laterEnrollment = await enrollContact(pool, funnel.id, later.id);
  await pool.query(`UPDATE enrollments SET next_run_at = now() + interval '1 hour' WHERE id = $1`, [
    laterEnrollment.id,
  ]);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const first = await claimDueEnrollment(client);
    assert.equal(first?.enrollmentId, dueEnrollment.id);
    assert.equal(first?.contactEmail, "due@example.com");
    // Park the claimed row (what real execution does by advancing the cursor);
    // otherwise this same transaction would just claim it again — SKIP LOCKED
    // only skips rows locked by OTHER transactions.
    await client.query(`UPDATE enrollments SET next_run_at = now() + interval '1 hour' WHERE id = $1`, [
      first!.enrollmentId,
    ]);
    const second = await claimDueEnrollment(client);
    assert.equal(second, null); // the other enrollment is an hour out
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
});

test("two concurrent transactions never claim the same enrollment", async () => {
  const pool = await freshSchema();
  const { funnel } = await createFunnel(pool, {
    name: "f",
    steps: [{ type: "email", config: { subject: "s", body: "b" } }],
  });
  for (let i = 0; i < 10; i++) {
    const c = await createContact(pool, { email: `c${i}@example.com` });
    await enrollContact(pool, funnel.id, c.id);
  }

  const a = await pool.connect();
  const b = await pool.connect();
  try {
    await a.query("BEGIN");
    await b.query("BEGIN");
    const park = `UPDATE enrollments SET next_run_at = now() + interval '1 hour' WHERE id = $1`;
    const taken: string[] = [];
    for (let i = 0; i < 5; i++) {
      const ra = await claimDueEnrollment(a);
      if (ra) {
        taken.push(ra.enrollmentId);
        await a.query(park, [ra.enrollmentId]); // park own claim so we don't re-claim it
      }
      const rb = await claimDueEnrollment(b);
      if (rb) {
        taken.push(rb.enrollmentId);
        await b.query(park, [rb.enrollmentId]);
      }
    }
    // Without SKIP LOCKED, b's first claim would block on a's lock instead of
    // taking the next row. Disjointness + no blocking is the proof.
    assert.equal(taken.length, 10);
    assert.equal(new Set(taken).size, 10);
    await a.query("ROLLBACK");
    await b.query("ROLLBACK");
  } finally {
    a.release();
    b.release();
  }
});
