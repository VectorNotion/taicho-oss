/**
 * Fit match evaluation (docs/icp-update-v2.md §2, §8, §12).
 *
 * The LLM performs semantic comparison of each fit observation against its
 * dimension's ideal value. Policy stays deterministic here:
 *   effectiveMatch = matchScore × effectiveConfidence (freshness-decayed),
 *   hardExclusion is only honored when the dimension defines a rule.
 * Timing dimensions never pass through this module.
 */
import { z } from 'zod';
import { effectiveConfidence } from '../domain/scoring';
import type {
  DimensionDefinition,
  DimensionMatch,
  ObservationRecord,
} from '../domain/qualification';
import { defaultCompleteJson, type DimensionResearchDeps } from './dimension-research';

export const matchEvaluationSchema = z.object({
  matches: z.array(
    z.object({
      dimensionKey: z.string(),
      matchScore: z.number().min(0).max(1),
      classification: z.enum(['strong_match', 'partial_match', 'weak_match', 'mismatch']),
      hardExclusionTriggered: z.boolean(),
      rationale: z.string(),
    }),
  ),
});

export function buildEvaluationPrompt(
  dims: DimensionDefinition[],
  observations: ObservationRecord[],
): string {
  const obsByKey = new Map(observations.map((o) => [o.dimensionKey, o]));
  const blocks = dims
    .filter((d) => obsByKey.has(d.key))
    .map((d) => {
      const obs = obsByKey.get(d.key)!;
      return `### ${d.key}
Ideal value: ${d.idealValue ?? '(not specified)'}
${d.hardExclusionRule ? `Hard exclusion rule: ${d.hardExclusionRule}` : ''}
Observation: ${obs.observedValue ?? '(none)'}`;
    })
    .join('\n\n');

  return `Compare each observation against its dimension's ideal value.

For every dimension return:
- matchScore (0-1): how closely the observation matches the ideal value. Semantic comparison only — judge the substance, not the wording.
- classification: strong_match (≥0.8), partial_match (≥0.5), weak_match (≥0.25), mismatch (<0.25).
- hardExclusionTriggered: true ONLY if the observation factually satisfies the stated hard exclusion rule. If no rule is stated, always false.
- rationale: one sentence.

Do not consider recency, confidence or evidence quality — those are handled elsewhere.

${blocks}`;
}

/**
 * Evaluate fit matches for the given dimensions and observations.
 * Dimensions without an observation are skipped (not zero-scored).
 */
export async function evaluateFitMatches(
  dims: DimensionDefinition[],
  observations: ObservationRecord[],
  now: Date,
  deps: Pick<DimensionResearchDeps, 'completeJson'> = {},
): Promise<DimensionMatch[]> {
  const fitDims = dims.filter((d) => d.dimensionType === 'fit');
  const obsByKey = new Map(observations.map((o) => [o.dimensionKey, o]));
  const evaluable = fitDims.filter((d) => obsByKey.has(d.key));
  if (evaluable.length === 0) return [];

  const completeJson = deps.completeJson ?? defaultCompleteJson;

  const raw = await completeJson({
    schemaName: 'match_evaluation',
    schema: matchEvaluationSchema,
    system:
      'You compare research observations against ideal values. Semantic evaluation only; policy, recency and confidence are handled deterministically elsewhere. Return only JSON.',
    prompt: buildEvaluationPrompt(evaluable, observations),
  });
  const parsed = matchEvaluationSchema.parse(raw);
  const evaluated = new Map(parsed.matches.map((m) => [m.dimensionKey, m]));

  const matches: DimensionMatch[] = [];
  for (const dim of evaluable) {
    const evaluation = evaluated.get(dim.key);
    if (!evaluation) continue;
    const obs = obsByKey.get(dim.key)!;
    const confidence = effectiveConfidence(
      obs.confidence,
      obs.researchedAt,
      dim.freshnessWindowDays,
      now,
    );
    const matchScore = Math.min(1, Math.max(0, evaluation.matchScore));
    matches.push({
      dimensionKey: dim.key,
      matchScore,
      effectiveMatch: matchScore * confidence,
      classification: evaluation.classification,
      hardExclusion: evaluation.hardExclusionTriggered && dim.hardExclusionRule != null,
      confidence,
    });
  }
  return matches;
}
