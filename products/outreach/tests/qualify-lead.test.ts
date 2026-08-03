/**
 * DI-stubbed unit tests for the qualify-lead orchestrator (no network / no DB).
 * All dependencies (repositories, settings, the per-persona scorer) are injected.
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
import { runQualifyLead, type QualifyLeadDeps } from '../agent/qualify-lead';
import type { Lead, LeadQualification, Persona, Settings } from '../domain/types';

const LEAD: Lead = {
  id: 'lead-1',
  name: 'Jane Doe',
  title: 'CTO',
  company: 'Acme',
  location: 'San Francisco',
  status: 'new',
  source: 'manual',
  priority: 'low',
  tags: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const SETTINGS: Settings = {
  id: 'global',
  mission: 'mission',
  identity: 'identity',
  voice: 'voice',
  updatedAt: '2026-01-01T00:00:00Z',
};

function persona(id: string, name: string): Persona {
  return {
    id,
    name,
    description: `${name} description`,
    targetTitles: ['CTO'],
    signals: ['AI interest'],
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

interface Recorder {
  qualifications: Array<{ leadId: string; data: Parameters<QualifyLeadDeps['createLeadQualification']>[1] }>;
  priorities: Array<{ leadId: string; score: number }>;
}

/**
 * Build a fully-stubbed deps object plus a call recorder.
 */
function makeDeps(config: {
  personas: Persona[];
  scores?: Record<string, { score: number; notes: string }>;
}): { deps: Partial<QualifyLeadDeps>; rec: Recorder } {
  const rec: Recorder = { qualifications: [], priorities: [] };

  const deps: Partial<QualifyLeadDeps> = {
    getLeadById: async () => LEAD,
    getLeadResearch: async () => null,
    getPersonas: async () => config.personas,
    getSettings: async () => SETTINGS,
    scorePersona: async ({ persona: p }) =>
      config.scores?.[p.id] ?? { score: 0, notes: 'no score' },
    createLeadQualification: async (leadId, data) => {
      rec.qualifications.push({ leadId, data });
      return {
        id: 'qual-1',
        leadId,
        matchedPersonaId: data.matchedPersonaId,
        matchedPersonaName: data.matchedPersonaName,
        score: data.score,
        notes: data.notes,
        qualifiedAt: '2026-01-01T00:00:00Z',
      } satisfies LeadQualification;
    },
    updateLeadPriorityByScore: async (leadId, score) => {
      rec.priorities.push({ leadId, score });
      return null;
    },
  };

  return { deps, rec };
}

// Mirror of the repository's score → priority mapping (updateLeadPriorityByScore).
function priorityFor(score: number): 'low' | 'medium' | 'high' {
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

test('no active personas → skipped, no writes', async () => {
  const { deps, rec } = makeDeps({ personas: [] });

  const result = await runQualifyLead('lead-1', deps);

  assert.deepEqual(result, { status: 'skipped' });
  assert.equal(rec.qualifications.length, 0, 'must not write a qualification');
  assert.equal(rec.priorities.length, 0, 'must not update priority');
});

test('two personas → highest score wins and is persisted', async () => {
  const p1 = persona('p1', 'AI-Curious CTO');
  const p2 = persona('p2', 'Scaling Founder');
  const { deps, rec } = makeDeps({
    personas: [p1, p2],
    scores: {
      p1: { score: 40, notes: 'weak fit' },
      p2: { score: 85, notes: 'strong fit' },
    },
  });

  const result = await runQualifyLead('lead-1', deps);

  assert.equal(result.status, 'success');
  assert.equal(result.score, 85);
  assert.equal(result.personaName, 'Scaling Founder');

  assert.equal(rec.qualifications.length, 1);
  assert.equal(rec.qualifications[0].data.matchedPersonaId, 'p2');
  assert.equal(rec.qualifications[0].data.matchedPersonaName, 'Scaling Founder');
  assert.equal(rec.qualifications[0].data.score, 85);
  assert.equal(rec.qualifications[0].data.notes, 'strong fit');

  assert.equal(rec.priorities.length, 1);
  assert.equal(rec.priorities[0].score, 85);
});

test('priority thresholds: winning score maps to the correct band', async () => {
  // score, expected priority band per updateLeadPriorityByScore thresholds.
  const cases: Array<[number, 'low' | 'medium' | 'high']> = [
    [0, 'low'],
    [49, 'low'],
    [50, 'medium'],
    [79, 'medium'],
    [80, 'high'],
    [100, 'high'],
  ];

  for (const [score, expected] of cases) {
    const p = persona('p1', 'Persona');
    const { deps, rec } = makeDeps({
      personas: [p],
      scores: { p1: { score, notes: 'n' } },
    });

    const result = await runQualifyLead('lead-1', deps);

    assert.equal(result.status, 'success');
    assert.equal(rec.priorities.length, 1);
    assert.equal(rec.priorities[0].score, score, `score ${score} forwarded`);
    assert.equal(
      priorityFor(rec.priorities[0].score),
      expected,
      `score ${score} → ${expected}`
    );
  }
});

test('runQualifyLead emits lead.qualified with the persisted score', async () => {
  const recorded: ProductEventInsert[] = [];
  setProductEventSinkForTests(async (event) => {
    recorded.push(event);
    return { id: randomUUID() };
  });
  try {
    const { deps } = makeDeps({
      personas: [persona('persona-1', 'Founders')],
      scores: { 'persona-1': { score: 84, notes: 'strong fit' } },
    });
    const result = await runWithExecutionContext(
      { organizationId: 'org-qualify-events', actorId: 'test', actorType: 'service' },
      () => runQualifyLead('lead-emit-1', deps),
    );
    await drainProductEvents();
    assert.equal(result.status, 'success');
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].name, 'lead.qualified');
    assert.equal(recorded[0].organizationId, 'org-qualify-events');
    assert.equal(recorded[0].leadId, 'lead-emit-1');
    assert.equal(recorded[0].payload.score, 84);
    assert.equal(recorded[0].payload.personaId, 'persona-1');
    assert.equal(recorded[0].payload.personaName, 'Founders');
  } finally {
    setProductEventSinkForTests(null);
  }
});
