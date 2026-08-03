import { assetsInCascade, databaseFor, offersInCascade } from "@content-automation/database";
import { desc, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { createContent, createEmail } from "../data/email-repository";
import { createVariant } from "../data/variant-repository";
import type { LlmClient } from "./llm";

interface GeneratedVariant {
  subject: string;
  preheader?: string;
  slots: Record<string, string>;
}

function parseVariantJson(raw: string, count: number): GeneratedVariant[] {
  const stripped = raw.replace(/```(?:json)?/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error("agent returned unparseable JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("agent returned no variants");
  }
  return (parsed as GeneratedVariant[]).slice(0, count);
}

/**
 * The content agent: generates draft email variants for a step, grounded in
 * the synced asset library and the offers source of truth. Everything it
 * produces stays `draft` until the validation gate and approval flow run.
 */
export async function generateContentVariants(
  pool: Pool,
  llm: LlmClient,
  args: {
    stepId: string;
    count: number;
    briefing: string;
    templateId: string;
    fromEmail: string;
    fromName?: string;
    interestUrl?: string;
    generation?: number;
    createdBy?: string;
  },
): Promise<Array<{ variantId: string; emailId: string }>> {
  const db = databaseFor(pool);
  const assets = await db
    .select({
      sourceId: assetsInCascade.source_id,
      type: assetsInCascade.type,
      title: assetsInCascade.title,
      url: assetsInCascade.url,
    })
    .from(assetsInCascade)
    .orderBy(desc(assetsInCascade.synced_at))
    .limit(20);
  const offers = await db
    .select({ code: offersInCascade.code, claim: offersInCascade.claim })
    .from(offersInCascade)
    .where(eq(offersInCascade.active, true));

  const assetList = assets
    .map((a) => `- ${a.sourceId} (${a.type}): "${a.title}" -> ${a.url}`)
    .join("\n");
  const offerList = offers.map((o) => `- ${o.code}: ${o.claim}`).join("\n") || "(none)";

  const system = "You write email variants for a B2B funnel. Respond with ONLY a JSON array.";
  const prompt = `Briefing: ${args.briefing}

Available assets (reference only via {{assets.[source-id].title}} / {{assets.[source-id].url}}):
${assetList || "(none)"}

Allowed offer claims (never invent discounts, prices, or offers beyond these):
${offerList}

Return a JSON array of ${args.count} objects:
{"subject": string, "preheader": string, "slots": {"hero": string, "body": string, "cta": string}}`;

  const raw = await llm.complete(system, prompt);
  const generated = parseVariantJson(raw, args.count);
  const stamp = Date.now();
  const generation = args.generation ?? 1;

  const results: Array<{ variantId: string; emailId: string }> = [];
  for (const [i, item] of generated.entries()) {
    const content = await createContent(pool, {
      name: `agent-${args.stepId.slice(0, 8)}-g${generation}-${i}-${stamp}`,
      subject: item.subject,
      preheader: item.preheader,
      slots: item.slots ?? {},
    });
    const email = await createEmail(pool, {
      name: `agent-email-${args.stepId.slice(0, 8)}-g${generation}-${i}-${stamp}`,
      templateId: args.templateId,
      contentId: content.id,
      fromEmail: args.fromEmail,
      fromName: args.fromName,
      interestUrl: args.interestUrl,
    });
    const variant = await createVariant(pool, {
      stepId: args.stepId,
      emailId: email.id,
      generation,
      createdBy: args.createdBy ?? "agent",
    });
    results.push({ variantId: variant.id, emailId: email.id });
  }
  return results;
}
