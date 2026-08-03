import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { freshSchema } from "./helpers";
import { createFunnel } from "../data/funnel-repository";
import { createContent, createEmail, createTemplate } from "../data/email-repository";
import {
  activateVariant,
  createVariant,
  deleteVariant,
  getSetting,
  listActiveVariants,
  markValidated,
  setSetting,
} from "../data/variant-repository";

async function seedStepAndEmail(pool: Pool) {
  const { steps } = await createFunnel(pool, {
    name: "v",
    steps: [{ type: "email", config: { subject: "base", body: "b" } }],
  });
  const template = await createTemplate(pool, { name: "t", mjml: "<mjml><mj-body><mj-text>x</mj-text></mj-body></mjml>" });
  const content = await createContent(pool, { name: "c", subject: "s", slots: {} });
  const makeEmail = (n: number) =>
    createEmail(pool, { name: `e${n}`, templateId: template.id, contentId: content.id, fromEmail: "f@x.com" });
  return { stepId: steps[0].id, makeEmail };
}

test("activation enforces validated status and the 4-arm cap", async () => {
  const pool = await freshSchema();
  const { stepId, makeEmail } = await seedStepAndEmail(pool);

  const draft = await createVariant(pool, { stepId, emailId: (await makeEmail(0)).id });
  await assert.rejects(() => activateVariant(pool, draft.id), /only validated/);

  const ids: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const v = await createVariant(pool, { stepId, emailId: (await makeEmail(i)).id });
    await markValidated(pool, v.id);
    ids.push(v.id);
  }
  for (let i = 0; i < 4; i++) await activateVariant(pool, ids[i]);
  await assert.rejects(() => activateVariant(pool, ids[4]), /arm cap exceeded/);

  const arms = await listActiveVariants(pool, stepId);
  assert.equal(arms.length, 4);
  assert.deepEqual([arms[0].sends, arms[0].interests], [0, 0]); // stats row auto-created
});

test("settings roundtrip with fallback", async () => {
  const pool = await freshSchema();
  assert.equal(await getSetting(pool, "autonomy", "approve_all"), "approve_all");
  await setSetting(pool, "autonomy", "auto_activate");
  assert.equal(await getSetting(pool, "autonomy", "approve_all"), "auto_activate");
});

test("an unsent non-active variant can be detached but active and sent variants retain history", async () => {
  const pool = await freshSchema();
  const { stepId, makeEmail } = await seedStepAndEmail(pool);

  const draft = await createVariant(pool, { stepId, emailId: (await makeEmail(1)).id });
  await deleteVariant(pool, draft.id);
  const removed = await pool.query(`SELECT id FROM variants WHERE id = $1`, [draft.id]);
  assert.equal(removed.rowCount, 0);

  const active = await createVariant(pool, { stepId, emailId: (await makeEmail(2)).id });
  await markValidated(pool, active.id);
  await activateVariant(pool, active.id);
  await assert.rejects(() => deleteVariant(pool, active.id), /must be retired/);

  await pool.query(`UPDATE variants SET status = 'retired' WHERE id = $1`, [active.id]);
  await pool.query(
    `INSERT INTO contacts (email) VALUES ('variant-history@example.com')`,
  );
  const contact = await pool.query(
    `SELECT id FROM contacts WHERE email = 'variant-history@example.com'`,
  );
  const funnel = await pool.query(`SELECT funnel_id FROM funnel_steps WHERE id = $1`, [stepId]);
  const enrollment = await pool.query(
    `INSERT INTO enrollments (contact_id, funnel_id, current_step_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [contact.rows[0].id, funnel.rows[0].funnel_id, stepId],
  );
  await pool.query(
    `INSERT INTO sends (enrollment_id, step_id, variant_id)
     VALUES ($1, $2, $3)`,
    [enrollment.rows[0].id, stepId, active.id],
  );
  await assert.rejects(() => deleteVariant(pool, active.id), /send history/);
});
