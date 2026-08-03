import mjml2html from "mjml";
import type { Pool } from "pg";
import { createTemplate } from "../data/email-repository";
import type { LlmClient } from "./llm";

const REQUIRED_MARKERS = ["{{{slots.hero}}}", "{{{slots.body}}}", "{{{slots.cta}}}", "{{{unsubscribeUrl}}}"];

export const TEMPLATE_SYSTEM = "You produce MJML email layouts. Respond with ONLY MJML.";

export function templatePrompt(briefing: string): string {
  return `Design an email layout for: ${briefing}

Requirements:
- Valid MJML (<mjml><mj-body>...).
- Must contain these Handlebars markers exactly: {{{slots.hero}}}, {{{slots.body}}}, {{{slots.cta}}}.
- Must contain an unsubscribe link: <a href="{{{unsubscribeUrl}}}">Unsubscribe</a>.
- Distinctive, intentional design: real palette and typographic hierarchy, not a plain default.`;
}

export async function validateTemplateSource(raw: string): Promise<string> {
  const mjmlSource = raw.replace(/```(?:mjml|xml|html)?/g, "").trim();
  for (const marker of REQUIRED_MARKERS) {
    if (!mjmlSource.includes(marker)) throw new Error(`generated template failed validation: missing ${marker}`);
  }
  try {
    const compiled = await mjml2html(mjmlSource, { validationLevel: "strict" });
    if (!compiled.html) throw new Error("empty output");
  } catch (err) {
    throw new Error(`generated template failed validation: ${err instanceof Error ? err.message : err}`);
  }
  return mjmlSource;
}

/**
 * Generate a validated MJML layout without persisting it — the Template
 * Studio hands the result to a human for tweaking before saving.
 */
export async function generateTemplateMjml(llm: LlmClient, briefing: string): Promise<string> {
  const raw = await llm.complete(TEMPLATE_SYSTEM, templatePrompt(briefing));
  return validateTemplateSource(raw);
}

/**
 * The template agent: generates an MJML layout with the standard typed slots
 * and stores it. The layout must compile and carry every required slot
 * marker plus the unsubscribe link.
 */
export async function generateTemplate(
  pool: Pool,
  llm: LlmClient,
  args: { name: string; briefing: string },
): Promise<{ templateId: string }> {
  const mjmlSource = await generateTemplateMjml(llm, args.briefing);
  const template = await createTemplate(pool, { name: args.name, mjml: mjmlSource });
  return { templateId: template.id };
}
