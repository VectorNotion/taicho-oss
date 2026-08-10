/**
 * Deterministic scoring engine (docs/icp-update-v2.md §7, §8, §11, §14).
 *
 * No ML, no semantic recency judgment: the LLM extracts facts and dates;
 * everything here is arithmetic. All functions are pure — `now` is injected.
 */
import type {
  DimensionDefinition,
  DimensionMatch,
  ObservationRecord,
  QualificationStatus,
  QualificationThresholds,
  TimingDimensionBreakdown,
  TimingSignal,
} from './qualification';

const MS_PER_DAY = 86_400_000;

/** Whole-day age of an ISO date/datetime relative to `now` (never negative). */
export function ageDays(iso: string, now: Date): number {
  const then = new Date(iso.includes('T') ? iso : `${iso}T00:00:00Z`);
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / MS_PER_DAY));
}

/**
 * Freshness decay (spec §14): inside the window confidence is untouched;
 * past the window it decays exponentially with the window as time constant.
 */
export function effectiveConfidence(
  confidence: number,
  researchedAt: string,
  freshnessWindowDays: number,
  now: Date,
): number {
  const age = ageDays(researchedAt, now);
  if (age <= freshnessWindowDays) return confidence;
  return confidence * Math.exp(-(age - freshnessWindowDays) / freshnessWindowDays);
}

/** Spec §7: signal_value = confidence × e^(−age_days / half_life). */
export function signalValue(signal: TimingSignal, halfLifeDays: number, now: Date): number {
  const clamped = Math.min(1, Math.max(0, signal.confidence));
  return clamped * Math.exp(-ageDays(signal.date, now) / halfLifeDays);
}

/** Sum of signal values, capped at the dimension max of 1 (spec §7). */
export function timingDimensionValue(
  signals: TimingSignal[],
  halfLifeDays: number,
  now: Date,
): number {
  const sum = signals.reduce((acc, s) => acc + signalValue(s, halfLifeDays, now), 0);
  return Math.min(1, sum);
}

/**
 * Timing Score: weighted sum of timing dimension values, normalized 0–100.
 * Dimensions without observations stay in the denominator — silence is cold.
 */
export function computeTimingScore(
  dims: DimensionDefinition[],
  observations: ObservationRecord[],
  now: Date,
): { score: number; breakdown: TimingDimensionBreakdown[] } {
  const timingDims = dims.filter((d) => d.dimensionType === 'timing');
  const byKey = new Map(observations.map((o) => [o.dimensionKey, o]));

  let weighted = 0;
  let totalWeight = 0;
  const breakdown: TimingDimensionBreakdown[] = [];

  for (const d of timingDims) {
    const signals = byKey.get(d.key)?.signals ?? [];
    const value = timingDimensionValue(signals, d.halfLifeDays ?? 45, now);
    weighted += d.weight * value;
    totalWeight += d.weight;
    breakdown.push({ dimensionKey: d.key, dimensionValue: value, signalCount: signals.length });
  }

  return { score: totalWeight > 0 ? (weighted / totalWeight) * 100 : 0, breakdown };
}

/**
 * Fit score (spec §4, §8): weighted mean of effective matches × 100.
 * Only dimensions that have a match participate — unresearched dimensions
 * neither help nor hurt.
 */
export function computeFitScore(matches: DimensionMatch[], dims: DimensionDefinition[]): number {
  const weightByKey = new Map(dims.map((d) => [d.key, d.weight]));
  let weighted = 0;
  let totalWeight = 0;
  for (const m of matches) {
    const weight = weightByKey.get(m.dimensionKey);
    if (weight == null) continue;
    weighted += weight * m.effectiveMatch;
    totalWeight += weight;
  }
  return totalWeight > 0 ? (weighted / totalWeight) * 100 : 0;
}

/** Spec §11 decision tree. Timing has no input here by construction. */
export function decideStatus(input: {
  icpScore: number;
  personaScore: number;
  hardExcluded: boolean;
  thresholds: QualificationThresholds;
}): QualificationStatus {
  const { icpScore, personaScore, hardExcluded, thresholds } = input;
  if (hardExcluded) return 'HARD_EXCLUDED';
  if (icpScore < thresholds.icpMinimum) return 'UNQUALIFIED';
  if (personaScore < thresholds.personaMinimum) return 'CONTACT_DISCOVERY_REQUIRED';
  return 'QUALIFIED';
}

/**
 * Confidence routing (spec §8): if excluding the dimensions whose confidence
 * is below the cutoff changes the decision, the decision is not trustworthy —
 * route to REVIEW. Hard exclusion is checked first (spec §11 order).
 */
export function applyConfidenceRouting(input: {
  icpMatches: DimensionMatch[];
  personaMatches: DimensionMatch[];
  icpDims: DimensionDefinition[];
  personaDims: DimensionDefinition[];
  hardExcluded: boolean;
  thresholds: QualificationThresholds;
}): { status: QualificationStatus; reviewReason?: string } {
  const { icpMatches, personaMatches, icpDims, personaDims, hardExcluded, thresholds } = input;

  if (hardExcluded) return { status: 'HARD_EXCLUDED' };

  const baseline = decideStatus({
    icpScore: computeFitScore(icpMatches, icpDims),
    personaScore: computeFitScore(personaMatches, personaDims),
    hardExcluded: false,
    thresholds,
  });

  const confident = (m: DimensionMatch) => m.confidence >= thresholds.lowConfidenceCutoff;
  const lowConfidenceKeys = [...icpMatches, ...personaMatches]
    .filter((m) => !confident(m))
    .map((m) => m.dimensionKey);
  if (lowConfidenceKeys.length === 0) return { status: baseline };

  const withoutLowConfidence = decideStatus({
    icpScore: computeFitScore(icpMatches.filter(confident), icpDims),
    personaScore: computeFitScore(personaMatches.filter(confident), personaDims),
    hardExcluded: false,
    thresholds,
  });

  if (withoutLowConfidence !== baseline) {
    return {
      status: 'REVIEW',
      reviewReason: `low-confidence dimension(s) ${lowConfidenceKeys.join(', ')} are decisive: ${baseline} without them becomes ${withoutLowConfidence}`,
    };
  }
  return { status: baseline };
}
