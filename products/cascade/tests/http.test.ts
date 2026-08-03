import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { freshSchema } from "./helpers";
import { createFunnel } from "../data/funnel-repository";
import { createContact } from "../data/contact-repository";
import { enrollContact } from "../data/enrollment-repository";
import { createCascadeHttpServer } from "../engine/http";
import { signToken } from "../engine/tokens";

async function withServer(pool: any, fn: (base: string) => Promise<void>) {
  const server = createCascadeHttpServer(pool);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}

test("one-click unsubscribe stops the contact and their enrollments", async () => {
  const pool = await freshSchema();
  const { funnel } = await createFunnel(pool, {
    name: "f",
    steps: [{ type: "delay", config: { seconds: 3600 } }],
  });
  const contact = await createContact(pool, { email: "u@example.com" });
  const enrollment = await enrollContact(pool, funnel.id, contact.id);
  const token = signToken({ t: "unsub", c: contact.id, o: "legacy" });

  await withServer(pool, async (base) => {
    const res = await fetch(`${base}/u/${token}`, { method: "POST", body: "List-Unsubscribe=One-Click" });
    assert.equal(res.status, 200);

    const c = await pool.query(`SELECT subscription_status FROM contacts WHERE id = $1`, [contact.id]);
    assert.equal(c.rows[0].subscription_status, "unsubscribed");
    const e = await pool.query(`SELECT state FROM enrollments WHERE id = $1`, [enrollment.id]);
    assert.equal(e.rows[0].state, "stopped");

    // Idempotent: second POST adds no second unsub event.
    await fetch(`${base}/u/${token}`, { method: "POST" });
    const events = await pool.query(`SELECT count(*)::int AS n FROM events WHERE contact_id = $1 AND type = 'unsub'`, [
      contact.id,
    ]);
    assert.equal(events.rows[0].n, 1);
  });
});

test("dashboard renders funnel and variant state", async () => {
  const pool = await freshSchema();
  await createFunnel(pool, { name: "dash-funnel", steps: [{ type: "delay", config: { seconds: 60 } }] });
  await withServer(pool, async (base) => {
    const res = await fetch(`${base}/dashboard`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("Cascade"));
    assert.ok(html.includes("dash-funnel"));
  });
});

test("tampered unsubscribe tokens are rejected", async () => {
  const pool = await freshSchema();
  await withServer(pool, async (base) => {
    const res = await fetch(`${base}/u/not-a-token`, { method: "POST" });
    assert.equal(res.status, 400);
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
  });
});
