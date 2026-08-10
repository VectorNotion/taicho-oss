/**
 * Pure unit tests for the deterministic scoring engine (spec §7, §8, §11, §14).
 * No network, no DB — everything takes an injected `now`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  DimensionDefinition,
  DimensionMatch,
  ObservationRecord,
  TimingSignal,
} from '../domain/qualification';
import { DEFAULT_THRESHOLDS } from '../domain/qualification';
import {
  ageDays,
  applyConfidenceRouting,
  computeFitScore,
  computeTimingScore,
  decideStatus,
  effectiveConfidence,
  signalValue,
  timingDimensionValue,
} from '../domain/scoring';

const NOW = new Date('2026-08-10T00:00:00Z');

function dim(partial: Partial<DimensionDefinition> & { key: string }): DimensionDefinition {
  return {
    id: `dim-${partial.key}`,
    name: partial.key,
    dimensionType: 'fit',
    appliesTo: 'account',
    researchInstruction: 'research it',
    weight: 1,
    freshnessWindowDays: 120,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

function match(partial: Partial<DimensionMatch> & { dimensionKey: string }): DimensionMatch {
  const matchScore = partial.matchScore ?? 1;
  const confidence = partial.confidence ?? 1;
  return {
    matchScore,
    confidence,
    effectiveMatch: partial.effectiveMatch ?? matchScore * confidence,
    classification: 'strong_match',
    hardExclusion: false,
    ...partial,
  };
}

function timingObs(dimensionKey: string, signals: TimingSignal[]): ObservationRecord {
  return {
    id: `obs-${dimensionKey}`,
    dimensionKey,
    shape: 'signals',
    signals,
    evidence: [],
    confidence: 1,
    researchedAt: NOW.toISOString(),
    runId: 'run-1',
  };
}

test('ageDays computes whole-day age from ISO date', () => {
  assert.equal(ageDays('2026-08-01', NOW), 9);
  assert.equal(ageDays(NOW.toISOString(), NOW), 0);
});

test('signalValue follows confidence × e^(−age/halfLife)', () => {
  // Age exactly one half-life constant → e^-1 (spec §7 formula, taken literally).
  const s: TimingSignal = { signal: 'posted jobs', date: '2026-06-26', evidence: [], confidence: 1 };
  assert.equal(ageDays(s.date, NOW), 45);
  const v = signalValue(s, 45, NOW);
  assert.ok(Math.abs(v - Math.exp(-1)) < 1e-9, `expected e^-1, got ${v}`);

  // Confidence scales linearly.
  const half = signalValue({ ...s, confidence: 0.5 }, 45, NOW);
  assert.ok(Math.abs(half - Math.exp(-1) / 2) < 1e-9);

  // Fresh signal → exactly its confidence.
  const fresh = signalValue({ ...s, date: '2026-08-10' }, 45, NOW);
  assert.ok(Math.abs(fresh - 1) < 1e-9);
});

test('timingDimensionValue sums signals and caps at 1', () => {
  const fresh: TimingSignal = { signal: 's', date: '2026-08-10', evidence: [], confidence: 1 };
  assert.equal(timingDimensionValue([fresh, fresh, fresh], 45, NOW), 1, 'capped at 1');
  const v = timingDimensionValue([{ ...fresh, confidence: 0.3 }], 45, NOW);
  assert.ok(Math.abs(v - 0.3) < 1e-9);
  assert.equal(timingDimensionValue([], 45, NOW), 0);
});

test('computeTimingScore weights dimensions and counts missing observations as cold', () => {
  const dims = [
    dim({ key: 'hiring_activity', dimensionType: 'timing', weight: 0.6, halfLifeDays: 45 }),
    dim({ key: 'funding_events', dimensionType: 'timing', weight: 0.4, halfLifeDays: 90 }),
  ];
  const observations = [
    timingObs('hiring_activity', [
      { signal: 'Posted 3 Sales Manager openings', date: '2026-08-10', evidence: ['u'], confidence: 1 },
    ]),
    // funding_events: no observation → contributes 0 but stays in the denominator.
  ];

  const { score, breakdown } = computeTimingScore(dims, observations, NOW);
  // hiring dimensionValue = 1, weighted: 0.6×1 / (0.6+0.4) × 100 = 60.
  assert.ok(Math.abs(score - 60) < 1e-6, `expected 60, got ${score}`);
  assert.deepEqual(
    breakdown.map((b) => ({ key: b.dimensionKey, count: b.signalCount })),
    [
      { key: 'hiring_activity', count: 1 },
      { key: 'funding_events', count: 0 },
    ],
  );
});

test('effectiveConfidence: fresh observations keep confidence, lapsed ones decay', () => {
  // 30 days old, 120-day window → untouched.
  assert.equal(effectiveConfidence(0.9, '2026-07-11', 120, NOW), 0.9);
  // Exactly at the window boundary → untouched.
  assert.equal(effectiveConfidence(0.9, '2026-04-12', 120, NOW), 0.9);
  // 14-day window, 28 days old → one window past lapse → ×e^-1.
  const decayed = effectiveConfidence(0.8, '2026-07-13', 14, NOW);
  assert.ok(Math.abs(decayed - 0.8 * Math.exp(-1)) < 1e-9, `got ${decayed}`);
});

test('computeFitScore: weighted mean of effective matches × 100, only observed dims count', () => {
  const dims = [
    dim({ key: 'a', weight: 0.75 }),
    dim({ key: 'b', weight: 0.25 }),
    dim({ key: 'c', weight: 0.5 }), // no match → excluded from numerator and denominator
  ];
  const matches = [
    match({ dimensionKey: 'a', matchScore: 0.94, confidence: 0.91 }), // effective 0.8554
    match({ dimensionKey: 'b', matchScore: 0.5, confidence: 1 }),
  ];
  const score = computeFitScore(matches, dims);
  const expected = ((0.75 * 0.94 * 0.91 + 0.25 * 0.5) / (0.75 + 0.25)) * 100;
  assert.ok(Math.abs(score - expected) < 1e-6, `expected ${expected}, got ${score}`);

  assert.equal(computeFitScore([], dims), 0, 'no matches → 0');
});

test('decideStatus implements the spec §11 tree', () => {
  const t = DEFAULT_THRESHOLDS;
  const decide = (icpScore: number, personaScore: number, hardExcluded = false) =>
    decideStatus({ icpScore, personaScore, hardExcluded, thresholds: t });

  assert.equal(decide(95, 95, true), 'HARD_EXCLUDED', 'hard exclusion wins over everything');
  assert.equal(decide(50, 95), 'UNQUALIFIED', 'ICP below minimum');
  assert.equal(decide(80, 40), 'CONTACT_DISCOVERY_REQUIRED', 'good company, wrong person');
  assert.equal(decide(80, 80), 'QUALIFIED');
  assert.equal(decide(t.icpMinimum, t.personaMinimum), 'QUALIFIED', 'thresholds are inclusive');
});

test('confidence routing: decisive low-confidence dimension → REVIEW', () => {
  const icpDims = [dim({ key: 'a', weight: 0.5 }), dim({ key: 'b', weight: 0.5 })];
  const personaDims = [dim({ key: 'p', appliesTo: 'prospect', weight: 1 })];
  const personaMatches = [match({ dimensionKey: 'p', matchScore: 0.9, confidence: 0.9 })];

  // 'b' has low confidence but carries the score: without it ICP drops below minimum.
  const icpMatches = [
    match({ dimensionKey: 'a', matchScore: 0.6, confidence: 1 }), // alone → 60 < 70
    match({ dimensionKey: 'b', matchScore: 1, confidence: 0.45 }),
  ];
  // Baseline: (0.5×0.6 + 0.5×0.45)/1 ×100 = 52.5 → UNQUALIFIED either way? No:
  // effectiveMatch b = 1×0.45 = 0.45; baseline 52.5 → UNQUALIFIED; excluding b → 60 → still UNQUALIFIED.
  // Use a stronger case: b at high matchScore drags the average UP past the gate.
  const strongB = [
    match({ dimensionKey: 'a', matchScore: 0.55, confidence: 1 }),
    match({ dimensionKey: 'b', matchScore: 1, confidence: 0.49, effectiveMatch: 0.9 }),
  ];
  // baseline: (0.5×0.55 + 0.5×0.9) ×100 = 72.5 → QUALIFIED; without b: 55 → UNQUALIFIED → REVIEW.
  const routed = applyConfidenceRouting({
    icpMatches: strongB,
    personaMatches,
    icpDims,
    personaDims,
    hardExcluded: false,
    thresholds: DEFAULT_THRESHOLDS,
  });
  assert.equal(routed.status, 'REVIEW');
  assert.ok(routed.reviewReason?.includes('b'), `reason names the dimension: ${routed.reviewReason}`);

  // Non-decisive low-confidence dimension does not trigger REVIEW.
  const stable = applyConfidenceRouting({
    icpMatches,
    personaMatches,
    icpDims,
    personaDims,
    hardExcluded: false,
    thresholds: DEFAULT_THRESHOLDS,
  });
  assert.equal(stable.status, 'UNQUALIFIED');
  assert.equal(stable.reviewReason, undefined);

  // Hard exclusion bypasses routing entirely (spec §11 order).
  const excluded = applyConfidenceRouting({
    icpMatches: strongB,
    personaMatches,
    icpDims,
    personaDims,
    hardExcluded: true,
    thresholds: DEFAULT_THRESHOLDS,
  });
  assert.equal(excluded.status, 'HARD_EXCLUDED');
});

test('timing never gates: decideStatus has no timing input by construction', () => {
  // Compile-time guarantee — decideStatus's input type has no timing field.
  // Runtime spot-check: QUALIFIED result is independent of any timing computation.
  const status = decideStatus({
    icpScore: 90,
    personaScore: 90,
    hardExcluded: false,
    thresholds: DEFAULT_THRESHOLDS,
  });
  assert.equal(status, 'QUALIFIED');
});
