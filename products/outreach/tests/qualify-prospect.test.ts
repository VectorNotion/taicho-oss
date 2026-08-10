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
import type { Prospect } from '../domain/types';

const NOW = new Date('2026-08-10T00:00:00Z');
const PROSPECT: Prospect = {
  id: 'p1', name: 'Jane Doe', title: 'COO', company: 'Acme',
  status: 'new', source: 'manual', priority: 'low', tags: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
const ACCOUNT = { id: 'acct-1', name: 'Acme', normalizedName: 'acme', createdAt: '2026-01-01T00:00:00Z' };

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
  researchSpy?: () => void;
}): { deps: Partial<QualifyProspectDeps>; rec: Rec } {
  const rec: Rec = { saved: [], priorities: [] };
  const deps: Partial<QualifyProspectDeps> = {
    getProspectById: async () => (config.prospect === undefined ? PROSPECT : config.prospect),
    resolveAccountForProspect: async () => (config.account === undefined ? ACCOUNT : config.account),
    getAccountScore: async () => (config.accountScore === undefined ? accountScore({}) : config.accountScore),
    getProspectScore: async () => (config.prospectScore === undefined ? prospectScore({}) : config.prospectScore),
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

test('timing never gates: zero timing still QUALIFIED', async () => {
  const { deps } = makeDeps({ accountScore: accountScore({ icpScore: 90, timingScore: 0 }), prospectScore: prospectScore({ personaScore: 90 }) });
  assert.equal((await runQualifyProspect('p1', deps)).qualification?.status, 'QUALIFIED');
});

test('missing prospect throws', async () => {
  const { deps } = makeDeps({ prospect: null });
  await assert.rejects(() => runQualifyProspect('missing', deps), /Prospect not found/);
});
