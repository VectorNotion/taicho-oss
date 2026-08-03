import { Liquid } from "liquidjs";
import { renderToMjml } from "@templatical/renderer";
import type { TemplateContent } from "@templatical/types";
import { SLOT_MARKERS_BY_TYPE, designerBlockDefinitions } from "./design-blocks";
import { validateTemplateSource } from "../agent/template-agent";

const liquid = new Liquid();
const definitionsByType = new Map(designerBlockDefinitions().map((definition) => [definition.type, definition]));

export async function renderDesignToMjml(design: TemplateContent): Promise<string> {
  return renderToMjml(design, {
    async renderCustomBlock(block) {
      const marker = SLOT_MARKERS_BY_TYPE[block.customType];
      if (marker) return marker;
      const definition = definitionsByType.get(block.customType);
      if (!definition) throw new Error(`unknown custom block type: ${block.customType}`);
      return liquid.parseAndRender(definition.template, block.fieldValues);
    },
  });
}

const FRIENDLY_ERRORS: Array<[marker: string, message: string]> = [
  ["{{{slots.hero}}}", "Add the Hero slot block — content variants fill it at send time."],
  ["{{{slots.body}}}", "Add the Body slot block — content variants fill it at send time."],
  ["{{{slots.cta}}}", "Add the CTA slot block — content variants fill it at send time."],
  [
    "{{{unsubscribeUrl}}}",
    "Add the Unsubscribe footer block — every email design must carry the one-click unsubscribe link.",
  ],
];

export async function deriveTemplateMjml(design: TemplateContent): Promise<string> {
  const mjml = await renderDesignToMjml(design);
  try {
    return await validateTemplateSource(mjml);
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    for (const [marker, message] of FRIENDLY_ERRORS) {
      if (raw.includes(`missing ${marker}`)) throw new Error(message);
    }
    throw new Error(`Email design failed validation: ${raw}`);
  }
}
