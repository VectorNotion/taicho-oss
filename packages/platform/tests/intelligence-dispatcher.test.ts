import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import type {
  ArtifactDraft,
  IntelligenceRun,
  StructuredArtifact,
} from '../intelligence/contracts';
import { executeIntelligenceWorkflow } from '../intelligence/dispatcher';
import { drainProductEvents, setProductEventSinkForTests } from '../events/emit';

const running: IntelligenceRun = {
  id: 'run-1',
  organizationId: 'org-1',
  workflow: 'prospect_intelligence',
  status: 'running',
  trigger: 'chat',
  input: { prospectId: 'prospect-1' },
  idempotencyKey: 'attention:item-1',
  initiatingUserId: 'user-1',
  actorType: 'user',
  error: null,
  createdAt: '2026-08-02T00:00:00.000Z',
  startedAt: '2026-08-02T00:00:00.000Z',
  completedAt: null,
};

const draft: ArtifactDraft = {
  workflow: 'prospect_intelligence',
  kind: 'prospect_dossier',
  title: 'Prospect dossier · Aisha',
  summary: 'Qualified prospect',
  content: { prospect: { id: 'prospect-1' } },
  sourceRefs: [{ type: 'prospect', id: 'prospect-1' }],
  recommendations: [{ action: 'outreach_intelligence', label: 'Prepare outreach' }],
  provenance: { workflowVersion: 'test' },
};

const artifact: StructuredArtifact = {
  ...draft,
  id: 'artifact-1',
  organizationId: 'org-1',
  runId: 'run-1',
  status: 'ready',
  createdAt: '2026-08-02T00:00:01.000Z',
  updatedAt: '2026-08-02T00:00:01.000Z',
};

afterEach(async () => {
  await drainProductEvents();
  setProductEventSinkForTests(null);
});

test('a workflow persists one artifact, resolves attention, and emits readiness', async () => {
  const calls: string[] = [];
  const events: string[] = [];
  setProductEventSinkForTests(async (event) => {
    events.push(event.name);
    return { id: 'event-1' };
  });
  const result = await executeIntelligenceWorkflow({
    workflow: 'prospect_intelligence',
    workflowInput: { prospectId: 'prospect-1' },
    context: {
      organizationId: 'org-1',
      initiatingUserId: 'user-1',
      actorType: 'user',
      trigger: 'chat',
      idempotencyKey: 'attention:item-1',
      attentionItemId: 'item-1',
    },
  }, {
    createRun: async () => ({ run: running, created: true }),
    failRun: async () => { calls.push('fail'); },
    getRun: async () => ({ ...running, status: 'completed', completedAt: artifact.createdAt }),
    commitArtifact: async () => { calls.push('commit'); return artifact; },
    getArtifactForRun: async () => null,
    resolveAttention: async () => { calls.push('resolve'); return null; },
    actOnNotification: async () => { calls.push('act'); return null; },
    handlers: { prospect_intelligence: async () => draft },
  } as never);
  await drainProductEvents();
  assert.equal(result.artifact.id, 'artifact-1');
  assert.equal(result.replayed, false);
  assert.deepEqual(calls, ['commit', 'resolve', 'act']);
  assert.deepEqual(events, ['intelligence.artifact.ready']);
});

test('an idempotent completed run replays its existing artifact', async () => {
  let invoked = false;
  const result = await executeIntelligenceWorkflow({
    workflow: 'prospect_intelligence',
    workflowInput: { prospectId: 'prospect-1' },
    context: {
      organizationId: 'org-1',
      actorType: 'service',
      trigger: 'external',
      idempotencyKey: 'n8n-run-1',
    },
  }, {
    createRun: async () => ({
      run: { ...running, status: 'completed', completedAt: artifact.createdAt },
      created: false,
    }),
    getArtifactForRun: async () => artifact,
    handlers: { prospect_intelligence: async () => { invoked = true; return draft; } },
  } as never);
  assert.equal(result.replayed, true);
  assert.equal(invoked, false);
});
