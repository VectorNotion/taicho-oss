/**
 * DI-stubbed tests for the decision-only qualify orchestrator. It reads the
 * account's ICP/timing score and the prospect's persona score and applies the
 * spec §11 tree — no research, no LLM.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { runWithExecutionContext } from '@content-automation/observability';
import {
  drainProductEvents,
  setProductEventSinkForTests,
} from '@content-automation/platform/events/emit';
import type { ProductEventInsert } from '@content-automation/platform/events/repository';
import { runQualifyProspect, type QualifyProspectDeps } from '../agent/qualify-prospect';
import type { AccountScoreRecord, ProspectScoreRecord } from '../data/qualification-repository';
import type { DimensionDefinition, DimensionMatch } from '../domain/qualification';
import type { Prospect } from '../domain/types';

const NOW = new Date('2026-08-10T00:00:00Z');
const PROSPECT: Prospect = {
  id: 'p1', name: 'Jane Doe', title: 'COO', company: 'Acme',
  status: 'new', source: 'manual', priority: 'low', tags: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
const ACCOUNT = { id: 'acct-1', name: 'Acme', normalizedName: 'acme', createdAt: '2026-01-01T00:00:00Z' };
const DIMENSIONS: DimensionDefinition[] = [
  {
    id: 'd-account', key: 'company_fit', name: 'Company fit', dimensionType: 'fit', appliesTo: 'account',
    researchInstruction: 'Assess company fit.', idealValue: 'Strong fit', weight: 1, freshnessWindowDays: 30,
    isActive: true, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  },
  {
    id: 'd-person', key: 'person_fit', name: 'Person fit', dimensionType: 'fit', appliesTo: 'prospect',
    researchInstruction: 'Assess person fit.', idealValue: 'Strong fit', weight: 1, freshnessWindowDays: 30,
    isActive: true, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  },
];

function accountScore(p: Partial<AccountScoreRecord>): AccountScoreRecord {
  const icpScore = p.icpScore ?? 90;
  return { icpScore, icpScoreConfident: icpScore, timingScore: 40, hardExcluded: false, timingBreakdown: [], computedAt: NOW.toISOString(), ...p };
}
function prospectScore(p: Partial<ProspectScoreRecord>): ProspectScoreRecord {
  const personaScore = p.personaScore ?? 80;
  return { personaScore, personaScoreConfident: personaScore, hardExcluded: false, computedAt: NOW.toISOString(), ...p };
}

interface Rec { saved: Array<Parameters<QualifyProspectDeps['saveProspectQualification']>[1]>; priorities: number[] }

function makeDeps(config: {
  prospect?: Prospect | null;
  account?: typeof ACCOUNT | null;
  accountScore?: AccountScoreRecord | null;
  prospectScore?: ProspectScoreRecord | null;
  dimensions?: DimensionDefinition[];
  accountMatches?: DimensionMatch[];
  prospectMatches?: DimensionMatch[];
  researchSpy?: () => void;
}): { deps: Partial<QualifyProspectDeps>; rec: Rec } {
  const rec: Rec = { saved: [], priorities: [] };
  const deps: Partial<QualifyProspectDeps> = {
    getProspectById: async () => (config.prospect === undefined ? PROSPECT : config.prospect),
    resolveAccountForProspect: async () => (config.account === undefined ? ACCOUNT : config.account),
    getAccountScore: async () => (config.accountScore === undefined ? accountScore({}) : config.accountScore),
    getProspectScore: async () => (config.prospectScore === undefined ? prospectScore({}) : config.prospectScore),
    getDimensionDefinitions: async () => config.dimensions ?? DIMENSIONS,
    getMatches: async (entity) => entity.kind === 'account'
      ? config.accountMatches ?? []
      : config.prospectMatches ?? [],
    saveProspectQualification: async (_id, result) => { rec.saved.push(result); },
    updateProspectPriorityByScore: async (_id, score) => { rec.priorities.push(score); },
    now: () => NOW,
  };
  return { deps, rec };
}

test('reads scores → QUALIFIED, emits event, no research', async () => {
  const recorded: ProductEventInsert[] = [];
  setProductEventSinkForTests(async (e) => { recorded.push(e); return { id: randomUUID() }; });
  try {
    const { deps, rec } = makeDeps({ accountScore: accountScore({ icpScore: 85, timingScore: 60 }), prospectScore: prospectScore({ personaScore: 90 }) });
    const result = await runWithExecutionContext(
      { organizationId: 'org-q', actorId: 't', actorType: 'service' },
      () => runQualifyProspect('p1', deps),
    );
    await drainProductEvents();
    assert.equal(result.status, 'success');
    assert.equal(result.qualification?.status, 'QUALIFIED');
    assert.equal(result.qualification?.icpScore, 85);
    assert.equal(result.qualification?.personaScore, 90);
    assert.equal(result.qualification?.timingScore, 60);
    assert.deepEqual(rec.priorities, [85]);
    assert.equal(recorded[0].name, 'prospect.qualified');
    assert.equal(recorded[0].payload.status, 'QUALIFIED');
  } finally {
    setProductEventSinkForTests(null);
  }
});

test('high ICP + low persona → CONTACT_DISCOVERY_REQUIRED', async () => {
  const { deps } = makeDeps({ accountScore: accountScore({ icpScore: 90 }), prospectScore: prospectScore({ personaScore: 20 }) });
  const result = await runQualifyProspect('p1', deps);
  assert.equal(result.qualification?.status, 'CONTACT_DISCOVERY_REQUIRED');
});

test('low ICP → UNQUALIFIED regardless of persona', async () => {
  const { deps } = makeDeps({ accountScore: accountScore({ icpScore: 30 }), prospectScore: prospectScore({ personaScore: 99 }) });
  const result = await runQualifyProspect('p1', deps);
  assert.equal(result.qualification?.status, 'UNQUALIFIED');
});

test('hard exclusion on either entity → HARD_EXCLUDED', async () => {
  const { deps } = makeDeps({ accountScore: accountScore({ hardExcluded: true }), prospectScore: prospectScore({}) });
  assert.equal((await runQualifyProspect('p1', deps)).qualification?.status, 'HARD_EXCLUDED');
});

test('confidence routing: decision flips when low-confidence excluded → REVIEW', async () => {
  // Full scores QUALIFY; confident-only scores drop ICP below the gate.
  const { deps } = makeDeps({
    accountScore: accountScore({ icpScore: 75, icpScoreConfident: 55 }),
    prospectScore: prospectScore({ personaScore: 80, personaScoreConfident: 80 }),
  });
  const result = await runQualifyProspect('p1', deps);
  assert.equal(result.qualification?.status, 'REVIEW');
  assert.match(result.qualification?.reviewReason ?? '', /confidence/i);
});

test('no company → REVIEW with reason', async () => {
  const { deps } = makeDeps({ account: null, accountScore: null });
  const result = await runQualifyProspect('p1', deps);
  assert.equal(result.qualification?.status, 'REVIEW');
  assert.match(result.qualification?.reviewReason ?? '', /company/);
  assert.equal(result.qualification?.icpScore, 0);
});

test('missing research scores → REVIEW with an exact missing-scope reason', async () => {
  const { deps } = makeDeps({ accountScore: null, prospectScore: null });
  const result = await runQualifyProspect('p1', deps);
  assert.equal(result.qualification?.status, 'REVIEW');
  assert.match(result.qualification?.reviewReason ?? '', /company research and person research/);
});

test('scored partial research with insufficient evidence routes to REVIEW instead of rejection', async () => {
  const { deps } = makeDeps({
    accountScore: accountScore({ reviewReason: 'insufficient evidence for: company_fit' }),
    prospectScore: prospectScore({ reviewReason: 'insufficient evidence for: person_fit' }),
  });
  const result = await runQualifyProspect('p1', deps);
  assert.equal(result.qualification?.status, 'REVIEW');
  assert.match(result.qualification?.reviewReason ?? '', /company_fit/);
  assert.match(result.qualification?.reviewReason ?? '', /person_fit/);
});

test('missing fit policy fails before persisting a misleading decision', async () => {
  const { deps, rec } = makeDeps({ dimensions: DIMENSIONS.filter((dimension) => dimension.appliesTo === 'prospect') });
  await assert.rejects(() => runQualifyProspect('p1', deps), /active company-fit targeting dimension/);
  assert.equal(rec.saved.length, 0);
  assert.equal(rec.priorities.length, 0);
});

test('persists the evidence-backed dimension matches used by the decision', async () => {
  const accountMatch: DimensionMatch = {
    dimensionKey: 'company_fit', matchScore: 0.9, effectiveMatch: 0.81,
    classification: 'strong_match', hardExclusion: false, confidence: 0.9,
  };
  const prospectMatch: DimensionMatch = {
    dimensionKey: 'person_fit', matchScore: 0.8, effectiveMatch: 0.72,
    classification: 'strong_match', hardExclusion: false, confidence: 0.9,
  };
  const { deps, rec } = makeDeps({ accountMatches: [accountMatch], prospectMatches: [prospectMatch] });
  await runQualifyProspect('p1', deps);
  assert.deepEqual(rec.saved[0]?.icpMatches, [accountMatch]);
  assert.deepEqual(rec.saved[0]?.personaMatches, [prospectMatch]);
});

test('timing never gates: zero timing still QUALIFIED', async () => {
  const { deps } = makeDeps({ accountScore: accountScore({ icpScore: 90, timingScore: 0 }), prospectScore: prospectScore({ personaScore: 90 }) });
  assert.equal((await runQualifyProspect('p1', deps)).qualification?.status, 'QUALIFIED');
});

test('missing prospect throws', async () => {
  const { deps } = makeDeps({ prospect: null });
  await assert.rejects(() => runQualifyProspect('missing', deps), /Prospect not found/);
});
