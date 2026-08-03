import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { freshSchema } from "./helpers";
import { createFunnel } from "../data/funnel-repository";
import { createContact } from "../data/contact-repository";
import { enrollContact } from "../data/enrollment-repository";
import { createContent, createEmail, createTemplate } from "../data/email-repository";
import { activateVariant, createVariant, markValidated } from "../data/variant-repository";
import { LogMailer } from "../engine/mailer";
import { runSendLoop } from "../engine/send-loop";
import { runTick } from "../engine/tick";
import { recordClick } from "../engine/ingest";

const MJML = "<mjml><mj-body><mj-text>{{{slots.body}}}</mj-text></mj-body></mjml>";

async function seedVariantStep(pool: Pool) {
  const { funnel, steps } = await createFunnel(pool, {
    name: "alloc",
    steps: [{ type: "email", config: { subject: "fallback", body: "b" } }],
  });
  const template = await createTemplate(pool, { name: "t", mjml: MJML });
  const mkVariant = async (name: string, subject: string) => {
    const content = await createContent(pool, { name, subject, slots: { body: name } });
    const email = await createEmail(pool, {
      name: `${name}-email`,
      templateId: template.id,
      contentId: content.id,
      fromEmail: "f@x.com",
    });
    const variant = await createVariant(pool, { stepId: steps[0].id, emailId: email.id });
    await markValidated(pool, variant.id);
    await activateVariant(pool, variant.id);
    return variant.id;
  };
  return { funnel, stepId: steps[0].id, mkVariant };
}

test("bandit shifts traffic toward the higher-interest variant", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { funnel, mkVariant } = await seedVariantStep(pool);
  const control = await mkVariant("control", "Control");
  const challenger = await mkVariant("challenger", "Challenger");

  // Seed history: challenger converts interest 20x better.
  await pool.query(`UPDATE variant_stats SET sends = 200, interests = 2 WHERE variant_id = $1`, [control]);
  await pool.query(`UPDATE variant_stats SET sends = 200, interests = 40 WHERE variant_id = $1`, [challenger]);

  for (let i = 0; i < 40; i++) {
    const c = await createContact(pool, { email: `alloc-${i}@example.com` });
    await enrollContact(pool, funnel.id, c.id);
  }
  await runTick(pool, { batchSize: 100 });
  const flushed = await runSendLoop(pool, mailer, { batchSize: 100 });
  assert.equal(flushed.sent, 40);

  const counts = await pool.query(
    `SELECT variant_id, count(*)::int AS n FROM sends GROUP BY variant_id`,
  );
  const byVariant = Object.fromEntries(counts.rows.map((r) => [r.variant_id, r.n]));
  const challengerShare = (byVariant[challenger] ?? 0) / 40;
  assert.ok(
    challengerShare > 0.6,
    `challenger got ${byVariant[challenger] ?? 0}/40 sends, expected > 60%`,
  );
  // Send counters incremented by the send loop on top of the seeded 200s.
  const stats = await pool.query(`SELECT sends FROM variant_stats WHERE variant_id = $1`, [challenger]);
  assert.equal(stats.rows[0].sends, 200 + (byVariant[challenger] ?? 0));
  // The variant's email (not the step fallback) was composed.
  assert.ok(mailer.sent.every((m) => m.subject === "Control" || m.subject === "Challenger"));
});

test("engagement events attribute to the variant that sent them", async () => {
  const pool = await freshSchema();
  const mailer = new LogMailer();
  const { funnel, mkVariant } = await seedVariantStep(pool);
  const only = await mkVariant("solo", "Solo");

  const c = await createContact(pool, { email: "attr@example.com" });
  const enrollment = await enrollContact(pool, funnel.id, c.id);
  await runTick(pool);
  await runSendLoop(pool, mailer);

  const send = await pool.query(`SELECT id, variant_id FROM sends WHERE enrollment_id = $1`, [enrollment.id]);
  assert.equal(send.rows[0].variant_id, only);
  await recordClick(pool, send.rows[0].id, "https://x.example/a", true);

  const stats = await pool.query(
    `SELECT sends, clicks, interests FROM variant_stats WHERE variant_id = $1`,
    [only],
  );
  assert.deepEqual(stats.rows[0], { sends: 1, clicks: 1, interests: 1 });
});
