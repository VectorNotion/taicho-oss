import type { OutreachMedium } from "./types";

export const OUTREACH_PROMPT_KEY = "outreach.message.generate";

export interface OutreachPromptContent {
  systemInstructions: string;
  mediumTemplates: Record<OutreachMedium, string>;
}

export interface OutreachPromptVersion {
  id: string;
  key: typeof OUTREACH_PROMPT_KEY;
  version: number;
  status: "published";
  content: OutreachPromptContent;
  contentHash: string;
  createdAt: string;
  createdBy: string;
}

export interface OutreachPromptDraft {
  key: typeof OUTREACH_PROMPT_KEY;
  basedOnVersion: number;
  content: OutreachPromptContent;
  contentHash: string;
  updatedAt: string;
  updatedBy: string;
}

export interface OutreachPromptWorkspace {
  key: typeof OUTREACH_PROMPT_KEY;
  owner: "Outreach";
  purpose: string;
  allowedVariables: string[];
  active: OutreachPromptVersion;
  draft: OutreachPromptDraft | null;
  versions: Array<Pick<OutreachPromptVersion, "id" | "version" | "contentHash" | "createdAt" | "createdBy">>;
}

export const OUTREACH_PROMPT_VARIABLES = [
  "first_name",
  "prospect_context",
  "resonance_context",
  "target_content",
] as const;

export const DEFAULT_OUTREACH_PROMPT_CONTENT: OutreachPromptContent = {
  systemInstructions: `Write customer-first outreach in three compact moves: their evidence-grounded pain and its consequence, the practical path forward with at most one verified proof clause, and one concrete next step with one easy action.

Keep at least 80% of the copy about the recipient, never introduce the sender, never fabricate proof, and omit weak or adjacent proof.

For email and InMail, use a greeting on its own line followed by short paragraphs separated by blank lines; content comments do not use a greeting.`,
  mediumTemplates: {
    inmail: `## Task: Write an InMail

Start with "Hi {{first_name}}," on its own line, followed by a blank line.
Use the prospect context below to identify their operating pain, consequence, and a practical path.
Keep the body under 150 words, add no more than one verified proof clause, and finish with one concrete offer and one easy action.

{{prospect_context}}
{{resonance_context}}`,
    inmail_traditional: `## Task: Write a Traditional InMail

Start with "Hi {{first_name}}," on its own line, followed by a blank line.
Use a lighter customer-first structure: their pain, a useful path forward, and one low-friction next step.
Never introduce or profile the sender, and separate each move with a blank line.

{{prospect_context}}
{{resonance_context}}`,
    email: `## Task: Write a Cold Email

Write an honest 3–6 word subject and a body under 120 words.
Start with "Hi {{first_name}}," on its own line, followed by a blank line, then write their pain, the practical path, and one clear next step as separate short paragraphs.
Do not use first-person language before the final concrete offer.

{{prospect_context}}
{{resonance_context}}`,
    content_comment: `## Task: Write a Comment on Their Content

Engage with one specific point in the content, add a useful implication or practical path for the audience, and stay within 2–4 sentences.
Do not turn the comment into a sender credential or capabilities pitch.

Target content:
{{target_content}}

{{prospect_context}}
{{resonance_context}}`,
  },
};

export function validateOutreachPromptContent(content: OutreachPromptContent): string[] {
  const errors: string[] = [];
  if (!content.systemInstructions.trim()) errors.push("System instructions are required.");
  if (content.systemInstructions.length > 20_000) errors.push("System instructions must be at most 20,000 characters.");
  for (const [medium, template] of Object.entries(content.mediumTemplates)) {
    if (!template.trim()) errors.push(`${medium} template is required.`);
    if (template.length > 20_000) errors.push(`${medium} template must be at most 20,000 characters.`);
    const variables = [...template.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map((match) => match[1]);
    for (const variable of variables) {
      if (!(OUTREACH_PROMPT_VARIABLES as readonly string[]).includes(variable)) {
        errors.push(`${medium} uses unsupported variable {{${variable}}}.`);
      }
    }
  }
  return errors;
}

export function renderOutreachPromptTemplate(
  template: string,
  variables: Record<(typeof OUTREACH_PROMPT_VARIABLES)[number], string>,
): string {
  return template.replace(/{{\s*([^{}]+?)\s*}}/g, (token, key: string) => (
    key in variables ? variables[key as keyof typeof variables] : token
  ));
}
