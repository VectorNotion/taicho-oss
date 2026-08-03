import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { freshSchema } from "./helpers";
import { createFunnel } from "../data/funnel-repository";
import { createTemplate } from "../data/email-repository";
import { setSetting } from "../data/variant-repository";
import { StaticContentSource, syncAssets } from "../data/asset-repository";
import { StubLlm } from "../agent/llm";
import { generateContentVariants } from "../agent/content-agent";
import { generateTemplate } from "../agent/template-agent";
import { approveVariant, maybeAutoActivate, validateVariant } from "../agent/validate";

const GOOD_MJML = `<mjml><mj-body><mj-section><mj-column>
  <mj-text>{{{slots.hero}}}</mj-text><mj-text>{{{slots.body}}}</mj-text><mj-text>{{{slots.cta}}}</mj-text>
  <mj-text><a href="{{{unsubscribeUrl}}}">Unsubscribe</a></mj-text>
</mj-column></mj-section></mj-body></mjml>`;

async function seedStep(pool: Pool) {
  const { steps } = await createFunnel(pool, {
    name: "gen",
    steps: [{ type: "email", config: { subject: "base", body: "b" } }],
  });
  const template = await createTemplate(pool, { name: "layout", mjml: GOOD_MJML });
  await syncAssets(
    pool,
    new StaticContentSource([
      { sourceId: "vid-1", type: "video", title: "The Video", url: "https://v.example/1", topics: [] },
    ]),
  );
  return { stepId: steps[0].id, templateId: template.id };
}

const VALID_VARIANTS = JSON.stringify([
  {
    subject: "Watch {{assets.[vid-1].title}}",
    preheader: "p1",
    slots: { hero: "h1", body: "See {{assets.[vid-1].url}}", cta: "Book a call" },
  },
  { subject: "Second angle", preheader: "p2", slots: { hero: "h2", body: "b2", cta: "Reply now" } },
]);

test("content agent creates draft variants wired to content and emails", async () => {
  const pool = await freshSchema();
  const { stepId, templateId } = await seedStep(pool);
  const llm = new StubLlm([VALID_VARIANTS]);

  const created = await generateContentVariants(pool, llm, {
    stepId,
    count: 2,
    briefing: "Onboarding welcome",
    templateId,
    fromEmail: "hello@mail.example.com",
  });

  assert.equal(created.length, 2);
  assert.ok(llm.calls[0].prompt.includes("vid-1"), "assets listed in the prompt");
  const statuses = await pool.query(`SELECT status, created_by FROM variants WHERE step_id = $1`, [stepId]);
  assert.deepEqual(statuses.rows.map((r) => [r.status, r.created_by]), [
    ["draft", "agent"],
    ["draft", "agent"],
  ]);
});

test("content agent rejects unparseable model output", async () => {
  const pool = await freshSchema();
  const { stepId, templateId } = await seedStep(pool);
  const llm = new StubLlm(["I would be happy to help with variants!"]);
  await assert.rejects(
    () =>
      generateContentVariants(pool, llm, {
        stepId,
        count: 2,
        briefing: "x",
        templateId,
        fromEmail: "f@x.com",
      }),
    /unparseable JSON/,
  );
});

test("template agent stores valid layouts and rejects missing markers", async () => {
  const pool = await freshSchema();
  const good = new StubLlm([GOOD_MJML]);
  const stored = await generateTemplate(pool, good, { name: "agent-layout", briefing: "clean b2b" });
  assert.ok(stored.templateId);

  const missingUnsub = GOOD_MJML.replace(`<a href="{{{unsubscribeUrl}}}">Unsubscribe</a>`, "no link");
  const bad = new StubLlm([missingUnsub]);
  await assert.rejects(
    () => generateTemplate(pool, bad, { name: "bad-layout", briefing: "x" }),
    /missing \{\{\{unsubscribeUrl\}\}\}/,
  );
});

test("validation gate rejects dangling assets and unbacked offers, passes clean variants", async () => {
  const pool = await freshSchema();
  const { stepId, templateId } = await seedStep(pool);

  const withDangling = JSON.stringify([
    { subject: "Watch {{assets.[vid-404].title}}", slots: { hero: "h", body: "b", cta: "c" } },
  ]);
  const withOffer = JSON.stringify([
    { subject: "40% off this week", slots: { hero: "h", body: "b", cta: "c" } },
  ]);
  const llm = new StubLlm([withDangling, withOffer, VALID_VARIANTS]);

  const [dangling] = await generateContentVariants(pool, llm, {
    stepId, count: 1, briefing: "x", templateId, fromEmail: "f@x.com",
  });
  const r1 = await validateVariant(pool, dangling.variantId);
  assert.equal(r1.ok, false);
  assert.ok(r1.errors[0].includes("vid-404"));

  const [offer] = await generateContentVariants(pool, llm, {
    stepId, count: 1, briefing: "x", templateId, fromEmail: "f@x.com",
  });
  const r2 = await validateVariant(pool, offer.variantId);
  assert.equal(r2.ok, false);
  assert.ok(r2.errors[0].includes("40"));

  // Same claim becomes valid once the offer exists in the source of truth.
  await pool.query(`INSERT INTO offers (code, claim) VALUES ('LAUNCH40', 'Launch week: 40% off annual plans')`);
  const [offer2] = await generateContentVariants(pool, new StubLlm([withOffer]), {
    stepId, count: 1, briefing: "x", templateId, fromEmail: "f@x.com",
  });
  const r3 = await validateVariant(pool, offer2.variantId);
  assert.equal(r3.ok, true);

  const [clean] = await generateContentVariants(pool, new StubLlm([VALID_VARIANTS]), {
    stepId, count: 1, briefing: "x", templateId, fromEmail: "f@x.com",
  });
  const r4 = await validateVariant(pool, clean.variantId);
  assert.deepEqual(r4, { ok: true, errors: [] });

  // Approval activates; autonomy gate is a no-op under approve_all.
  await approveVariant(pool, clean.variantId);
  const activated = await pool.query(`SELECT status FROM variants WHERE id = $1`, [clean.variantId]);
  assert.equal(activated.rows[0].status, "active");

  assert.equal(await maybeAutoActivate(pool, r3.ok ? offer2.variantId : ""), false);
  await setSetting(pool, "autonomy", "auto_activate");
  assert.equal(await maybeAutoActivate(pool, offer2.variantId), true);
});
