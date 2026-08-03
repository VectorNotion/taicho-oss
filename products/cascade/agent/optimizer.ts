import { databaseFor, variantsInCascade } from "@content-automation/database";
import { eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { getEmailBundle } from "../data/email-repository";
import { listActiveVariants, retireVariant } from "../data/variant-repository";
import { generateContentVariants } from "./content-agent";
import type { LlmClient } from "./llm";
import { maybeAutoActivate, validateVariant } from "./validate";

export interface OptimizerOptions {
  /** Arms need at least this many sends before retirement decisions. */
  minSends?: number;
  /** Retire arms whose interest rate is below best * retireFraction. */
  retireFraction?: number;
  /** How many replacement variants to breed from the winner. */
  breedCount?: number;
}

export interface OptimizerResult {
  retired: string[];
  bred: string[];
}

/**
 * The outer loop (docs/closed-loop.md): reads per-variant performance,
 * retires losers, and breeds the next generation from winners. Runs offline
 * only (script/cron) — never on the hot path. Under autonomy "approve_all",
 * bred variants stop at `validated` for human review; under "auto_activate"
 * they go live immediately, still capped at 4 arms.
 */
export async function runOptimizer(
  pool: Pool,
  llm: LlmClient,
  opts: OptimizerOptions = {},
): Promise<OptimizerResult> {
  const minSends = opts.minSends ?? 50;
  const retireFraction = opts.retireFraction ?? 0.5;
  const breedCount = opts.breedCount ?? 2;
  const result: OptimizerResult = { retired: [], bred: [] };

  const steps = await databaseFor(pool)
    .select({ stepId: variantsInCascade.step_id })
    .from(variantsInCascade)
    .where(eq(variantsInCascade.status, "active"))
    .groupBy(variantsInCascade.step_id)
    .having(sql`count(*) >= 2`);

  for (const stepRow of steps) {
    const arms = await listActiveVariants(pool, stepRow.stepId);
    const measured = arms.filter((a) => a.sends >= minSends);
    if (measured.length < 2) continue;

    const rate = (a: { sends: number; interests: number }) => (a.sends === 0 ? 0 : a.interests / a.sends);
    const best = measured.reduce((top, a) => (rate(a) > rate(top) ? a : top));
    const losers = measured.filter((a) => a.id !== best.id && rate(a) < rate(best) * retireFraction);

    // Never retire the last remaining arm.
    const survivors = arms.length - losers.length;
    if (survivors < 1) losers.pop();

    for (const loser of losers) {
      await retireVariant(pool, loser.id);
      result.retired.push(loser.id);
    }
    if (losers.length === 0) continue;

    // Breed the next generation from the winner's angle.
    const winnerBundle = await getEmailBundle(pool, best.emailId);
    if (!winnerBundle) continue;
    const loserSummary = losers
      .map((l) => `- interest rate ${(rate(l) * 100).toFixed(1)}% (retired)`)
      .join("\n");
    const briefing = `Previous winner (interest rate ${(rate(best) * 100).toFixed(1)}%):
${JSON.stringify({ subject: winnerBundle.subject, slots: winnerBundle.slots })}
Losers:
${loserSummary}
Write NEW variants that keep the winning angle but vary the subject and CTA.`;

    const bred = await generateContentVariants(pool, llm, {
      stepId: stepRow.stepId,
      count: breedCount,
      briefing,
      templateId: winnerBundle.email.templateId,
      fromEmail: winnerBundle.email.fromEmail,
      fromName: winnerBundle.email.fromName ?? undefined,
      interestUrl: winnerBundle.email.interestUrl ?? undefined,
      generation: best.generation + 1,
      createdBy: "agent",
    });

    for (const child of bred) {
      const validation = await validateVariant(pool, child.variantId);
      if (!validation.ok) continue; // rejected drafts stay behind with their error recorded
      try {
        await maybeAutoActivate(pool, child.variantId);
      } catch {
        // Arm cap reached: the variant stays validated, awaiting a slot or human call.
      }
      result.bred.push(child.variantId);
    }
  }
  return result;
}
