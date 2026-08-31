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
import { traceable } from '@content-automation/observability';
import { effectiveConfidence } from '../domain/scoring';
import type {
  DimensionDefinition,
  DimensionMatch,
  ObservationRecord,
} from '../domain/qualification';
import {
  defaultCompleteJson,
  type DimensionResearchDeps,
} from './dimension-research';
import { modelSlug } from '@content-automation/platform/agents/model';

export const matchEvaluationItemSchema = z.object({
  dimensionKey: z.string(),
  matchScore: z.number().min(0).max(1),
  classification: z.enum(['strong_match', 'partial_match', 'weak_match', 'mismatch']),
  hardExclusionTriggered: z.boolean(),
  rationale: z.string(),
});

export const matchEvaluationSchema = z.object({
  matches: z.array(matchEvaluationItemSchema),
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

  return `Compare each observation against its dimension's ideal value. Return exactly one match for every dimension block and copy each dimension key verbatim.

For every dimension return:
- matchScore (0-1): how closely the observation matches the ideal value. Semantic comparison only — judge the substance, not the wording.
- classification: strong_match (≥0.8), partial_match (≥0.5), weak_match (≥0.25), mismatch (<0.25).
- hardExclusionTriggered: true ONLY if the observation factually satisfies the stated hard exclusion rule. If no rule is stated, always false.
- rationale: one sentence.

Do not consider recency, confidence or evidence quality — those are handled elsewhere.

${blocks}`;
}

/**
 * Evaluate fit matches for every fit dimension. Missing or unsupported
 * observations are retained explicitly as insufficient evidence rather than
 * being confused with a factual mismatch or disappearing from the scorecard.
 */
export async function evaluateFitMatches(
  dims: DimensionDefinition[],
  observations: ObservationRecord[],
  now: Date,
  deps: Pick<DimensionResearchDeps, 'completeJson'> = {},
): Promise<DimensionMatch[]> {
  const fitDims = dims.filter((d) => d.dimensionType === 'fit');
  const obsByKey = new Map(observations.map((o) => [o.dimensionKey, o]));
  const hasUsableEvidence = (dimension: DimensionDefinition) => {
    const observation = obsByKey.get(dimension.key);
    if (!observation || observation.confidence <= 0) return false;
    return !/^no evidence found\b/i.test(observation.observedValue?.trim() ?? '');
  };
  const evaluable = fitDims.filter(hasUsableEvidence);

  const completeJson = deps.completeJson ?? defaultCompleteJson;

  const system =
    'You compare research observations against ideal values. Semantic evaluation only; policy, recency and confidence are handled deterministically elsewhere. Return only JSON.';
  const prompt = buildEvaluationPrompt(evaluable, observations);
  const model = modelSlug();
  const tracedCompletion = traceable(completeJson, {
    name: 'research.match_evaluation',
    kind: 'generation',
    attributes: {
      provider: 'openrouter',
      'llm.provider': 'openrouter',
      'llm.model_name': model,
      'taicho.provider.model': model,
      'taicho.research.dimension_count': evaluable.length,
    },
    processInputs: ([input]) => ({
      model,
      system: input.system,
      prompt: input.prompt,
      schema: input.schemaName,
    }),
  });
  const evaluated = new Map<string, z.infer<typeof matchEvaluationItemSchema>>();
  if (evaluable.length > 0) {
    const raw = await tracedCompletion({
      schemaName: 'match_evaluation',
      schema: matchEvaluationSchema,
      system,
      prompt,
    });
    const rawMatches = raw && typeof raw === 'object' && Array.isArray((raw as { matches?: unknown }).matches)
      ? (raw as { matches: unknown[] }).matches
      : [];
    const normalizedKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    for (const candidate of rawMatches) {
      const parsed = matchEvaluationItemSchema.safeParse(candidate);
      if (!parsed.success) continue;
      const evaluation = parsed.data;
      const dimension = evaluable.find((candidate) => (
        candidate.key === evaluation.dimensionKey
        || normalizedKey(candidate.key) === normalizedKey(evaluation.dimensionKey)
        || normalizedKey(candidate.name) === normalizedKey(evaluation.dimensionKey)
      ));
      if (dimension && !evaluated.has(dimension.key)) evaluated.set(dimension.key, evaluation);
    }
  }

  const matches: DimensionMatch[] = [];
  for (const dim of fitDims) {
    const obs = obsByKey.get(dim.key);
    if (!obs || !hasUsableEvidence(dim)) {
      matches.push({
        dimensionKey: dim.key,
        matchScore: 0,
        effectiveMatch: 0,
        classification: 'insufficient_evidence',
        hardExclusion: false,
        confidence: 0,
      });
      continue;
    }
    const evaluation = evaluated.get(dim.key);
    if (!evaluation) {
      matches.push({
        dimensionKey: dim.key,
        matchScore: 0,
        effectiveMatch: 0,
        classification: 'insufficient_evidence',
        hardExclusion: false,
        confidence: effectiveConfidence(obs.confidence, obs.researchedAt, dim.freshnessWindowDays, now),
      });
      continue;
    }
    const confidence = effectiveConfidence(
      obs.confidence,
      obs.researchedAt,
      dim.freshnessWindowDays,
      now,
    );
    const matchScore = Math.min(1, Math.max(0, evaluation.matchScore));
    const claimIds = obs.claimIds ?? [];
    const isMismatch = evaluation.classification === 'mismatch';
    matches.push({
      dimensionKey: dim.key,
      matchScore,
      effectiveMatch: matchScore * confidence,
      classification: evaluation.classification,
      hardExclusion: evaluation.hardExclusionTriggered && dim.hardExclusionRule != null,
      confidence,
      supportingClaimIds: isMismatch ? [] : claimIds,
      contradictingClaimIds: isMismatch ? claimIds : [],
    });
  }
  return matches;
}
