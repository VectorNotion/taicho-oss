import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { Pool } from "pg";
import { freshSchema } from "./helpers";
import { createFunnel } from "../data/funnel-repository";
import { createContact } from "../data/contact-repository";
import { enrollContact } from "../data/enrollment-repository";
import { createContent, createEmail, createTemplate } from "../data/email-repository";
import { activateVariant, createVariant, markValidated, setSetting } from "../data/variant-repository";
import { StaticContentSource, syncAssets } from "../data/asset-repository";
import { StubLlm } from "../agent/llm";
import { runOptimizer } from "../agent/optimizer";
import { runTick } from "../engine/tick";
import { runSendLoop } from "../engine/send-loop";
import { LogMailer } from "../engine/mailer";

const MJML = `<mjml><mj-body><mj-section><mj-column>
  <mj-text>{{{slots.hero}}}</mj-text><mj-text>{{{slots.body}}}</mj-text><mj-text>{{{slots.cta}}}</mj-text>
  <mj-text><a href="{{{unsubscribeUrl}}}">Unsubscribe</a></mj-text>
</mj-column></mj-section></mj-body></mjml>`;

const BRED_VARIANTS = JSON.stringify([
  { subject: "Winning angle, new subject", slots: { hero: "h", body: "See {{assets.[vid-1].url}}", cta: "Book now" } },
  { subject: "Winning angle, sharper CTA", slots: { hero: "h", body: "b", cta: "Grab a slot" } },
]);

async function seedArm(pool: Pool, stepId: string, templateId: string, name: string, subject: string) {
  const content = await createContent(pool, { name, subject, slots: { hero: "h", body: "b", cta: "c" } });
  const email = await createEmail(pool, {
    name: `${name}-email`,
    templateId,
    contentId: content.id,
    fromEmail: "hello@mail.example.com",
  });
  const variant = await createVariant(pool, { stepId, emailId: email.id });
  await markValidated(pool, variant.id);
  await activateVariant(pool, variant.id);
  return variant.id;
}

test("closed loop: measure -> retire loser -> breed from winner -> allocate", async () => {
  const pool = await freshSchema();
  const { funnel, steps } = await createFunnel(pool, {
    name: "loop",
    steps: [{ type: "email", config: { subject: "fallback", body: "b" } }],
  });
  const template = await createTemplate(pool, { name: "t", mjml: MJML });
  await syncAssets(
    pool,
    new StaticContentSource([
      { sourceId: "vid-1", type: "video", title: "V", url: "https://v.example/1", topics: [] },
    ]),
  );
  await setSetting(pool, "autonomy", "auto_activate");

  const armA = await seedArm(pool, steps[0].id, template.id, "arm-a", "Angle A");
  const armB = await seedArm(pool, steps[0].id, template.id, "arm-b", "Angle B");

  // A generation of measurement: B converts interest 15x better than A.
  await pool.query(`UPDATE variant_stats SET sends = 100, interests = 2 WHERE variant_id = $1`, [armA]);
  await pool.query(`UPDATE variant_stats SET sends = 100, interests = 30 WHERE variant_id = $1`, [armB]);

  const llm = new StubLlm([BRED_VARIANTS]);
  const outcome = await runOptimizer(pool, llm, { minSends: 50, retireFraction: 0.5, breedCount: 2 });

  // Loser retired, winner survives, two children bred from the winner's angle.
  assert.deepEqual(outcome.retired, [armA]);
  assert.equal(outcome.bred.length, 2);
  assert.ok(llm.calls[0].prompt.includes("Angle B"), "briefing carries the winner's copy");

  const states = await pool.query(
    `SELECT id, status, generation, created_by FROM variants WHERE step_id = $1 ORDER BY created_at`,
    [steps[0].id],
  );
  const byId = new Map(states.rows.map((r) => [r.id, r]));
  assert.equal(byId.get(armA)!.status, "retired");
  assert.equal(byId.get(armB)!.status, "active");
  for (const bredId of outcome.bred) {
    const row = byId.get(bredId)!;
    assert.equal(row.status, "active"); // auto_activate mode
    assert.equal(row.generation, 2);
    assert.equal(row.created_by, "agent");
    const stats = await pool.query(`SELECT sends FROM variant_stats WHERE variant_id = $1`, [bredId]);
    assert.equal(stats.rows[0].sends, 0);
  }

  // Allocation sanity: new sends go only to surviving active arms.
  const mailer = new LogMailer();
  for (let i = 0; i < 10; i++) {
    const c = await createContact(pool, { email: `loop-${i}@example.com` });
    await enrollContact(pool, funnel.id, c.id);
  }
  await runTick(pool, { batchSize: 50 });
  await runSendLoop(pool, mailer, { batchSize: 50 });
  const sendVariants = await pool.query(
    `SELECT DISTINCT variant_id FROM sends WHERE variant_id IS NOT NULL`,
  );
  for (const row of sendVariants.rows) {
    assert.notEqual(row.variant_id, armA, "retired arm receives no traffic");
  }
  assert.equal(mailer.sent.length, 10);
});

test("under approve_all the loop breeds but waits for a human", async () => {
  const pool = await freshSchema();
  const { steps } = await createFunnel(pool, {
    name: "gated",
    steps: [{ type: "email", config: { subject: "fallback", body: "b" } }],
  });
  const template = await createTemplate(pool, { name: "t2", mjml: MJML });
  await syncAssets(
    pool,
    new StaticContentSource([
      { sourceId: "vid-1", type: "video", title: "V", url: "https://v.example/1", topics: [] },
    ]),
  );
  // autonomy defaults to approve_all — no setting written.

  const armA = await seedArm(pool, steps[0].id, template.id, "g-a", "Angle A");
  const armB = await seedArm(pool, steps[0].id, template.id, "g-b", "Angle B");
  await pool.query(`UPDATE variant_stats SET sends = 100, interests = 1 WHERE variant_id = $1`, [armA]);
  await pool.query(`UPDATE variant_stats SET sends = 100, interests = 25 WHERE variant_id = $1`, [armB]);

  const outcome = await runOptimizer(pool, new StubLlm([BRED_VARIANTS]), {
    minSends: 50,
    retireFraction: 0.5,
    breedCount: 2,
  });
  assert.equal(outcome.retired.length, 1);
  for (const bredId of outcome.bred) {
    const row = await pool.query(`SELECT status FROM variants WHERE id = $1`, [bredId]);
    assert.equal(row.rows[0].status, "validated"); // awaiting human approval — the dial
  }
});

test("agents never touch the hot path (static check)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const engineDir = path.join(here, "..", "engine");
  for (const file of readdirSync(engineDir)) {
    const source = readFileSync(path.join(engineDir, file), "utf8");
    assert.ok(!source.includes("../agent/"), `${file} imports from the agent layer`);
    assert.ok(!source.includes("LlmClient"), `${file} references the LLM client`);
    for (const marker of ["@anthropic-ai/sdk", "openrouter.ai", "api.anthropic.com"]) {
        assert.ok(!source.includes(marker), `${file} references the model API (${marker})`);
      }
  }
});
