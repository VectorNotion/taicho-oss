import assert from "node:assert/strict";
import test from "node:test";
import mjml2html from "mjml";
import { createCustomBlock, createDefaultTemplateContent } from "@templatical/types";
import type { TemplateContent } from "@templatical/types";
import { freshSchema } from "./helpers";
import { createContact } from "../data/contact-repository";
import {
  createContent,
  createEmail,
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from "../data/email-repository";
import {
  DESIGNER_PALETTE,
  SLOT_MARKERS_BY_TYPE,
  designerBlockDefinitions,
} from "../domain/design-blocks";
import { deriveTemplateMjml, renderDesignToMjml } from "../domain/design-render";
import { composeSend } from "../engine/compose";

function slotOnlyDesign(types: string[]): TemplateContent {
  const defaults = createDefaultTemplateContent("Arial, sans-serif");
  const definitions = new Map(designerBlockDefinitions().map((definition) => [definition.type, definition]));
  return {
    settings: {
      ...defaults.settings,
      preheaderText: "Preview line",
    },
    blocks: types.map((customType) =>
      createCustomBlock(
        definitions.get(customType) ?? {
          type: customType,
          name: customType,
          description: "Unknown fixture block",
          fields: [],
          template: "",
        },
      ),
    ),
  };
}

const FULL_DESIGN = slotOnlyDesign(["slot-hero", "slot-body", "slot-cta", "unsubscribe-footer"]);

test("templates.design_json round-trips through the repository", async () => {
  const pool = await freshSchema();
  const design = { blocks: [], settings: { width: 600 } };
  const created = await createTemplate(pool, {
    name: "designed",
    mjml: "<mjml><mj-body></mj-body></mjml>",
    designJson: design,
  });
  const fetched = await getTemplate(pool, created.id);
  assert.deepEqual(fetched?.designJson, design);
  const listed = await listTemplates(pool);
  assert.equal(listed.find((template) => template.id === created.id)?.hasDesign, true);
});

test("templates without a design report hasDesign false and designJson null", async () => {
  const pool = await freshSchema();
  const created = await createTemplate(pool, { name: "plain", mjml: "<mjml><mj-body></mj-body></mjml>" });
  const fetched = await getTemplate(pool, created.id);
  assert.equal(fetched?.designJson, null);
  const listed = await listTemplates(pool);
  assert.equal(listed.find((template) => template.id === created.id)?.hasDesign, false);
});

test("updating a template with raw MJML detaches the stored design", async () => {
  const pool = await freshSchema();
  const created = await createTemplate(pool, {
    name: "detach",
    mjml: "<mjml><mj-body></mj-body></mjml>",
    designJson: { blocks: [], settings: { width: 600 } },
  });
  await updateTemplate(pool, created.id, {
    mjml: "<mjml><mj-body><mj-section></mj-section></mj-body></mjml>",
  });
  const fetched = await getTemplate(pool, created.id);
  assert.equal(fetched?.designJson, null);
});

test("slot blocks cover exactly the marker vocabulary the engine expects", async () => {
  await freshSchema();
  assert.deepEqual(
    Object.values(SLOT_MARKERS_BY_TYPE).filter((marker) => marker.startsWith("{{{slots.")),
    ["{{{slots.hero}}}", "{{{slots.body}}}", "{{{slots.cta}}}"],
  );
  assert.ok(SLOT_MARKERS_BY_TYPE["unsubscribe-footer"].includes(`href="{{{unsubscribeUrl}}}"`));
  const types = designerBlockDefinitions().map((definition) => definition.type);
  assert.deepEqual(new Set(types), new Set(Object.keys(SLOT_MARKERS_BY_TYPE)));
  for (const entry of DESIGNER_PALETTE.filter((paletteEntry) => paletteEntry.startsWith("custom:"))) {
    assert.ok(types.includes(entry.slice("custom:".length)), `palette entry ${entry} has a definition`);
  }
});

test("deriveTemplateMjml emits all four engine markers and compiles strictly", async () => {
  await freshSchema();
  const mjml = await deriveTemplateMjml(FULL_DESIGN);
  for (const marker of ["{{{slots.hero}}}", "{{{slots.body}}}", "{{{slots.cta}}}", "{{{unsubscribeUrl}}}"]) {
    assert.ok(mjml.includes(marker), `derived MJML contains ${marker}`);
  }
  const compiled = await mjml2html(mjml, { validationLevel: "strict" });
  assert.ok(compiled.html.length > 0);
  assert.ok(mjml.includes("<mj-preview>Preview line</mj-preview>"), "preheader carried into mj-preview");
});

test("a design missing a slot block fails with a human-readable error", async () => {
  await freshSchema();
  await assert.rejects(
    deriveTemplateMjml(slotOnlyDesign(["slot-body", "slot-cta", "unsubscribe-footer"])),
    /Hero slot block/,
  );
});

test("a design missing the unsubscribe footer fails with a compliance error", async () => {
  await freshSchema();
  await assert.rejects(
    deriveTemplateMjml(slotOnlyDesign(["slot-hero", "slot-body", "slot-cta"])),
    /Unsubscribe footer/,
  );
});

test("an unknown custom block type is rejected", async () => {
  await freshSchema();
  await assert.rejects(
    renderDesignToMjml(slotOnlyDesign(["slot-hero", "mystery-widget"])),
    /unknown custom block type: mystery-widget/,
  );
});

test("a designed template composes end-to-end through the engine untouched", async () => {
  const pool = await freshSchema();
  const mjml = await deriveTemplateMjml(FULL_DESIGN);
  const template = await createTemplate(pool, { name: "designed-e2e", mjml, designJson: FULL_DESIGN });
  const content = await createContent(pool, {
    name: "designed-e2e-content",
    subject: "Hello {{contact.attributes.first_name}}",
    preheader: "A designed template",
    slots: {
      hero: "<h1>Big welcome</h1>",
      body: "<p>Real body copy.</p>",
      cta: `<a href="https://example.com/book">Book a call</a>`,
    },
  });
  const email = await createEmail(pool, {
    name: "designed-e2e-email",
    templateId: template.id,
    contentId: content.id,
    fromEmail: "hello@example.com",
  });
  const contact = await createContact(pool, { email: "sam@example.com" });
  contact.attributes = { first_name: "Sam" };
  const composed = await composeSend(pool, { sendId: "designed-send", emailId: email.id, contact });
  assert.equal(composed.subject, "Hello Sam");
  assert.ok(composed.html.includes("Big welcome"), "hero slot filled");
  assert.ok(composed.html.includes("Real body copy."), "body slot filled");
  assert.ok(composed.html.includes("/u/"), "unsubscribe link rendered");
  assert.ok(composed.html.includes("/o/"), "open pixel appended");
  assert.ok(composed.headers["List-Unsubscribe"], "one-click unsub header set");
});
