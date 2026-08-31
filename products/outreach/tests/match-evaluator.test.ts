import assert from 'node:assert/strict';
import test from 'node:test';
import type { DimensionDefinition, ObservationRecord } from '../domain/qualification';
import { evaluateFitMatches } from '../agent/match-evaluator';

const DIMENSION: DimensionDefinition = {
  id: 'dimension-1',
  key: 'operational_scale',
  name: 'Operational scale',
  dimensionType: 'fit',
  appliesTo: 'account',
  researchInstruction: 'Find the company scale.',
  idealValue: 'Large global operation',
  weight: 1,
  freshnessWindowDays: 120,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const OBSERVATION: ObservationRecord = {
  id: 'observation-1',
  dimensionKey: DIMENSION.key,
  shape: 'prose',
  observedValue: 'The company only operates in one city.',
  evidence: ['https://example.test/source'],
  confidence: 0.9,
  researchedAt: '2026-08-19T00:00:00.000Z',
  runId: 'run-1',
  claimIds: ['claim-1'],
};

test('mismatch claims contradict an assessment and are not also support', async () => {
  const [match] = await evaluateFitMatches(
    [DIMENSION],
    [OBSERVATION],
    new Date('2026-08-19T00:00:00.000Z'),
    {
      completeJson: async () => ({
        matches: [{
          dimensionKey: DIMENSION.key,
          matchScore: 0.1,
          classification: 'mismatch',
          hardExclusionTriggered: false,
          rationale: 'The observed operation is small.',
        }],
      }),
    },
  );

  assert.deepEqual(match.supportingClaimIds, []);
  assert.deepEqual(match.contradictingClaimIds, ['claim-1']);
});
