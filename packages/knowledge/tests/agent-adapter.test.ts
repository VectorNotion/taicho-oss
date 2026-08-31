import assert from 'node:assert/strict';
import test from 'node:test';
import { KnowledgeAgentAdapter } from '../agent-adapter';
import { compileKnowledgeRegistry } from '../registry/compiler';
import { coreKnowledgeManifest } from '../registry/core-manifest';
import { InMemoryKnowledgeRepository } from '../repository';
import { KnowledgeService } from '../service';

async function fixture() {
  const registry = compileKnowledgeRegistry([coreKnowledgeManifest]);
  const repository = new InMemoryKnowledgeRepository('org_agents', registry);
  const company = await repository.resolveEntity({ typeKey: 'core.organization', name: 'Acme' });
  assert.notEqual(company.status, 'review_required');
  if (company.status === 'review_required') throw new Error('identity resolution failed');
  const service = new KnowledgeService('org_agents', repository, registry);
  const policy = {
    projectionKeys: ['core.agent_memory'],
    allowedUses: ['internal'] as const,
    maxSensitivity: 'restricted' as const,
    maxHops: 2,
    maxResults: 20,
    canWriteNotes: true,
    writableNoteKinds: ['observation', 'decision'] as const,
  };
  const first = new KnowledgeAgentAdapter(service, policy, { actorType: 'service', clientId: 'agents-runtime', agentId: 'agent-a', runId: 'run-a', channel: 'slack' });
  const second = new KnowledgeAgentAdapter(service, policy, { actorType: 'service', clientId: 'agents-runtime', agentId: 'agent-b', runId: 'run-b', channel: 'api' });
  return { repository, company: company.entity, first, second };
}

test('agents share attributable evidence-backed notes through the canonical graph', async () => {
  const { repository, company, first, second } = await fixture();
  const created = await first.createNote({
    projectionKey: 'core.agent_memory',
    use: 'internal',
    key: 'run-a:acme-observation',
    kind: 'observation',
    content: 'Acme prefers concise technical updates.',
    subjectEntityIds: [company.id],
    confidence: 0.9,
  });
  assert.equal(created.attribution.agentId, 'agent-a');
  assert.equal(created.claimIds.length, 1);
  assert.equal(created.evidenceIds.length, 1);
  const explanation = await first.explain({ projectionKey: 'core.agent_memory', use: 'internal', id: created.claimIds[0] });
  assert.equal(explanation?.evidence[0]?.excerpt, created.content);

  const shared = await second.queryNotes({ projectionKey: 'core.agent_memory', use: 'internal', subjectEntityIds: [company.id] });
  assert.deepEqual(shared.map(({ id }) => id), [created.id]);
  await assert.rejects(second.reviseNote({ projectionKey: 'core.agent_memory', use: 'internal', noteId: created.id, content: 'Changed.' }), /only notes it authored/);

  const revised = await first.reviseNote({
    projectionKey: 'core.agent_memory',
    use: 'internal',
    noteId: created.id,
    expectedRevisionId: created.revisionId,
    content: 'Acme prefers concise, evidence-linked technical updates.',
  });
  assert.notEqual(revised.revisionId, created.revisionId);
  assert.equal(repository.claims.get(created.claimIds[0])?.status, 'superseded');
  await assert.rejects(first.reviseNote({ projectionKey: 'core.agent_memory', use: 'internal', noteId: created.id, expectedRevisionId: created.revisionId, content: 'Stale update.' }), /changed since/);

  const retracted = await first.retractNote({ projectionKey: 'core.agent_memory', use: 'internal', noteId: created.id, expectedRevisionId: revised.revisionId, reason: 'No longer current' });
  assert.equal(retracted.status, 'retracted');
  assert.equal(retracted.claimIds.length, 0);
  assert.equal((await second.queryNotes({ projectionKey: 'core.agent_memory', use: 'internal' })).length, 0);
  assert.equal((await second.queryNotes({ projectionKey: 'core.agent_memory', use: 'internal', statuses: ['retracted'] }))[0]?.id, created.id);
});

test('adapter boundaries prevent read and write policy escalation', async () => {
  const { company, first } = await fixture();
  await assert.rejects(first.traverse({ projectionKey: 'core.agent_memory', use: 'internal', startEntityIds: [company.id], maxHops: 3 }), /at most 2 hops/);
  await assert.rejects(first.createNote({ projectionKey: 'core.agent_memory', use: 'research', key: 'bad-use', kind: 'observation', content: 'No.', subjectEntityIds: [company.id] }), /not allowed to use/);
  await assert.rejects(first.createNote({ projectionKey: 'core.agent_memory', use: 'internal', key: 'bad-kind', kind: 'hypothesis', content: 'No.', subjectEntityIds: [company.id] }), /cannot write hypothesis/);
  await assert.rejects(first.createNote({ projectionKey: 'core.agent_memory', use: 'internal', key: 'bad-uses', kind: 'observation', content: 'No.', subjectEntityIds: [company.id], allowedUses: ['content'] }), /outside its policy/);
});
