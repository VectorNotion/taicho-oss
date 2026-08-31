import assert from 'node:assert/strict';
import test from 'node:test';
import { compileKnowledgeRegistry } from '../registry/compiler';
import { coreKnowledgeManifest } from '../registry/core-manifest';
import { defineKnowledgeManifest } from '../registry/schema';
import { InMemoryKnowledgeRepository } from '../repository';

const testManifest = defineKnowledgeManifest({
  moduleKey: 'test', version: 1, knowledge: 'contributes',
  entityTypes: [
    { key: 'test.employer', name: 'Employer', description: 'An organization in an employment claim.', baseKind: 'organization', extends: 'core.organization', sensitivity: 'workspace', allowedUses: ['research', 'outreach', 'internal'] },
    { key: 'test.employee', name: 'Employee', description: 'A person in an employment claim.', baseKind: 'person', extends: 'core.person', sensitivity: 'restricted', allowedUses: ['research', 'outreach', 'internal'] },
  ],
  predicates: [{ key: 'test.employs', name: 'Employs', description: 'An employer employs a person.', subjectTypes: ['test.employer'], objectTypes: ['test.employee'], objectKind: 'entity', sensitivity: 'restricted', allowedUses: ['research', 'outreach', 'internal'] }],
  extractionProfiles: [{ key: 'test.research', name: 'Research', description: 'Extract employment relationships.', entityTypes: ['test.employer', 'test.employee'], predicates: ['test.employs'], instructions: ['Require exact evidence.'] }],
  readProjections: [
    { key: 'test.context', name: 'Context', description: 'Read employment context.', entityTypes: ['test.employer', 'test.employee'], predicates: ['test.employs'], artifactKinds: ['outreach.message'], assessmentKinds: ['outreach.fit'], allowedUses: ['research', 'outreach', 'internal'], defaultLimit: 20 },
    { key: 'test.employer_only_context', name: 'Employer-only context', description: 'A projection that deliberately excludes employee identities.', entityTypes: ['test.employer'], predicates: ['test.employs'], allowedUses: ['research'], defaultLimit: 20 },
  ],
  capabilityIds: [], aliases: [], migrations: [],
});

const registry = compileKnowledgeRegistry([coreKnowledgeManifest, testManifest]);

async function fixture() {
  const repository = new InMemoryKnowledgeRepository('org_a', registry);
  const source = await repository.upsertSource({ kind: 'web', canonicalUri: 'https://example.com/team', sensitivity: 'restricted', allowedUses: ['research', 'outreach', 'internal'] });
  const text = 'Acme employs Jane as its engineering leader.';
  const { revision } = await repository.putSourceRevision({ sourceId: source.id, content: text, contentHash: 'hash_1' });
  const [evidence] = await repository.putEvidenceSpans(revision.id, [{ start: 0, end: text.length, excerpt: text }]);
  const company = await repository.resolveEntity({ typeKey: 'test.employer', name: 'Acme', externalIds: { domain: 'acme.test' } });
  const person = await repository.resolveEntity({ typeKey: 'test.employee', name: 'Jane', externalIds: { crm: 'jane-1' }, sensitivity: 'restricted' });
  assert.notEqual(company.status, 'review_required');
  assert.notEqual(person.status, 'review_required');
  if (company.status === 'review_required' || person.status === 'review_required') throw new Error('fixture identity failed');
  return { repository, source, revision, evidence, company: company.entity, person: person.entity };
}

test('source revisions and evidence spans are idempotent and exact', async () => {
  const { repository, source, revision } = await fixture();
  const replay = await repository.putSourceRevision({ sourceId: source.id, content: revision.content, contentHash: revision.contentHash });
  assert.equal(replay.created, false);
  assert.equal(replay.revision.id, revision.id);
  await assert.rejects(repository.putEvidenceSpans(revision.id, [{ start: 0, end: 4, excerpt: 'Nope' }]), /does not match/);
});

test('source policy cannot be weakened by a later module upsert', async () => {
  const repository = new InMemoryKnowledgeRepository('org_source_policy', registry);
  const original = await repository.upsertSource({ kind: 'web', canonicalUri: 'https://example.com/private', sensitivity: 'restricted', allowedUses: ['research'] });
  const replay = await repository.upsertSource({ kind: 'web', canonicalUri: original.canonicalUri, sensitivity: 'public', allowedUses: ['research', 'outreach'] });
  assert.equal(replay.id, original.id);
  assert.equal(replay.sensitivity, 'restricted');
  assert.deepEqual(replay.allowedUses, ['research']);
});

test('claim reconciliation has zero delta on replay and supersedes stale owned claims', async () => {
  const { repository, revision, evidence, company, person } = await fixture();
  const desired = [{ subjectEntityId: company.id, predicateKey: 'test.employs', object: { kind: 'entity' as const, entityId: person.id }, statement: 'Acme employs Jane.', evidenceIds: [evidence.id], confidence: 0.97, sensitivity: 'restricted' as const, allowedUses: ['research', 'outreach', 'internal'] as const }];
  const first = await repository.reconcileClaims({ ownerProfile: 'test.research', revisionId: revision.id, extractionVersion: 'extractor-1', claims: desired.map((claim) => ({ ...claim, allowedUses: [...claim.allowedUses] })) });
  const replay = await repository.reconcileClaims({ ownerProfile: 'test.research', revisionId: revision.id, extractionVersion: 'extractor-1', claims: desired.map((claim) => ({ ...claim, allowedUses: [...claim.allowedUses] })) });
  assert.deepEqual({ created: first.created, unchanged: first.unchanged, superseded: first.superseded }, { created: 1, unchanged: 0, superseded: 0 });
  assert.deepEqual({ created: replay.created, unchanged: replay.unchanged, superseded: replay.superseded }, { created: 0, unchanged: 1, superseded: 0 });
  const removed = await repository.reconcileClaims({ ownerProfile: 'test.research', revisionId: revision.id, extractionVersion: 'extractor-1', claims: [] });
  assert.equal(removed.superseded, 1);
});

test('a new source revision supersedes extraction-owned claims from the prior revision', async () => {
  const { repository, source, revision, evidence, company, person } = await fixture();
  const first = await repository.reconcileClaims({ ownerProfile: 'test.research', revisionId: revision.id, extractionVersion: 'extractor-1', claims: [{ subjectEntityId: company.id, predicateKey: 'test.employs', object: { kind: 'entity', entityId: person.id }, statement: 'Acme employs Jane.', evidenceIds: [evidence.id], confidence: 0.97 }] });
  const nextText = 'Acme no longer employs Jane.';
  const { revision: nextRevision } = await repository.putSourceRevision({ sourceId: source.id, content: nextText, contentHash: 'hash_2', capturedAt: '2099-01-01T00:00:00.000Z' });
  const [nextEvidence] = await repository.putEvidenceSpans(nextRevision.id, [{ start: 0, end: nextText.length, excerpt: nextText }]);
  const next = await repository.reconcileClaims({ ownerProfile: 'test.research', revisionId: nextRevision.id, extractionVersion: 'extractor-1', claims: [{ subjectEntityId: company.id, predicateKey: 'test.employs', object: { kind: 'entity', entityId: person.id }, statement: 'Acme no longer employs Jane.', evidenceIds: [nextEvidence.id], confidence: 0.9 }] });
  assert.equal(next.superseded, 1);
  assert.equal(repository.claims.get(first.claims[0].id)?.status, 'superseded');
  assert.equal(next.claims[0].status, 'accepted');

  const reverted = await repository.putSourceRevision({ sourceId: source.id, content: revision.content, contentHash: revision.contentHash, capturedAt: '2100-01-01T00:00:00.000Z' });
  assert.equal(reverted.created, false);
  assert.equal(repository.sources.get(source.id)?.latestRevisionId, revision.id);
  const restored = await repository.reconcileClaims({ ownerProfile: 'test.research', revisionId: revision.id, extractionVersion: 'extractor-1', claims: [{ subjectEntityId: company.id, predicateKey: 'test.employs', object: { kind: 'entity', entityId: person.id }, statement: 'Acme employs Jane.', evidenceIds: [evidence.id], confidence: 0.97 }] });
  assert.equal(restored.claims[0].status, 'accepted');
  assert.equal(repository.claims.get(next.claims[0].id)?.status, 'superseded');
});

test('policy-bounded context and artifacts preserve exact explainable lineage', async () => {
  const { repository, revision, evidence, company, person } = await fixture();
  const result = await repository.reconcileClaims({ ownerProfile: 'test.research', revisionId: revision.id, extractionVersion: 'extractor-1', claims: [{ subjectEntityId: company.id, predicateKey: 'test.employs', object: { kind: 'entity', entityId: person.id }, statement: 'Acme employs Jane.', evidenceIds: [evidence.id], confidence: 0.97, sensitivity: 'restricted', allowedUses: ['research', 'outreach', 'internal'] }] });
  const claim = result.claims[0];
  const denied = await repository.queryContext({ projectionKey: 'test.context', subjectEntityIds: [company.id], policy: { organizationId: 'org_a', use: 'outreach', maxSensitivity: 'workspace' } });
  assert.equal(denied.claims.length, 0);
  const allowed = await repository.queryContext({ projectionKey: 'test.context', subjectEntityIds: [company.id], policy: { organizationId: 'org_a', use: 'outreach', maxSensitivity: 'restricted' } });
  assert.deepEqual(allowed.claims.map(({ id }) => id), [claim.id]);
  assert.deepEqual(allowed.contradictions, []);
  const excludedObjectType = await repository.queryContext({ projectionKey: 'test.employer_only_context', subjectEntityIds: [company.id], policy: { organizationId: 'org_a', use: 'research', maxSensitivity: 'restricted' } });
  assert.equal(excludedObjectType.claims.length, 0);
  const artifact = await repository.recordArtifact({ kind: 'outreach.message', externalId: 'message_1', usedClaimIds: [claim.id], usedEvidenceIds: [evidence.id], metadata: {} });
  const assessment = await repository.recordAssessment({ kind: 'outreach.fit', subjectEntityIds: [company.id], policyKey: 'icp', policyVersion: 1, result: { matched: true }, supportingClaimIds: [claim.id], contradictingClaimIds: [] });
  assert.equal(artifact.sensitivity, 'restricted');
  assert.deepEqual(artifact.allowedUses, ['research', 'outreach', 'internal']);
  const reusable = await repository.queryContext({ projectionKey: 'test.context', subjectEntityIds: [company.id], policy: { organizationId: 'org_a', use: 'outreach', maxSensitivity: 'restricted' } });
  assert.deepEqual(reusable.artifacts.map(({ id }) => id), [artifact.id]);
  assert.deepEqual(reusable.assessments.map(({ id }) => id), [assessment.id]);
  assert.equal(await repository.explain(artifact.id, { organizationId: 'org_a', use: 'outreach', maxSensitivity: 'workspace' }), null);
  const explanation = await repository.explain(artifact.id, { organizationId: 'org_a', use: 'outreach', maxSensitivity: 'restricted' });
  assert.equal(explanation?.evidence[0]?.excerpt, 'Acme employs Jane as its engineering leader.');
  assert.equal(explanation?.sources[0]?.canonicalUri, 'https://example.com/team');
  await assert.rejects(repository.recordArtifact({ kind: 'bad', usedClaimIds: ['claim_elsewhere'], usedEvidenceIds: [], metadata: {} }), /not accepted/);
});

test('search and bounded traversal honor projections, confidence, and sensitivity', async () => {
  const { repository, revision, evidence, company, person } = await fixture();
  const { claims } = await repository.reconcileClaims({
    ownerProfile: 'test.research',
    revisionId: revision.id,
    extractionVersion: 'extractor-1',
    claims: [{ subjectEntityId: company.id, predicateKey: 'test.employs', object: { kind: 'entity', entityId: person.id }, statement: 'Acme employs Jane.', evidenceIds: [evidence.id], confidence: 0.97 }],
  });
  const policy = { organizationId: 'org_a', use: 'research' as const, maxSensitivity: 'restricted' as const };
  const search = await repository.search({ projectionKey: 'test.context', query: 'Acme', policy });
  assert.equal(search.hits[0]?.id, company.id);
  assert.ok(search.hits.some((hit) => hit.claimIds.includes(claims[0].id)));

  const traversal = await repository.traverse({ projectionKey: 'test.context', startEntityIds: [company.id], direction: 'outgoing', maxHops: 1, policy });
  assert.deepEqual(traversal.entities.map(({ id }) => id).sort(), [company.id, person.id].sort());
  assert.deepEqual(traversal.edges.map(({ claimId }) => claimId), [claims[0].id]);
  assert.deepEqual(traversal.paths[0], { entityIds: [company.id, person.id], claimIds: [claims[0].id], directions: ['outgoing'] });

  const restricted = await repository.traverse({
    projectionKey: 'test.context',
    startEntityIds: [company.id],
    maxHops: 1,
    policy: { ...policy, maxSensitivity: 'workspace' },
  });
  assert.equal(restricted.edges.length, 0);
  await assert.rejects(repository.traverse({ projectionKey: 'test.context', startEntityIds: [company.id], maxHops: 4, policy }), /between 1 and 3/);
  await assert.rejects(repository.traverse({ projectionKey: 'test.employer_only_context', startEntityIds: [person.id], policy }), /unavailable/);
});

test('lineage policy cannot be weakened by a claim, assessment, or artifact', async () => {
  const { repository, revision, evidence, company, person } = await fixture();
  const candidate = { subjectEntityId: company.id, predicateKey: 'test.employs', object: { kind: 'entity' as const, entityId: person.id }, statement: 'Acme employs Jane.', evidenceIds: [evidence.id], confidence: 0.97 };
  await assert.rejects(
    repository.reconcileClaims({ ownerProfile: 'test.research', revisionId: revision.id, extractionVersion: 'extractor-1', claims: [{ ...candidate, sensitivity: 'workspace' }] }),
    /less restrictive/,
  );
  await assert.rejects(
    repository.reconcileClaims({ ownerProfile: 'test.research', revisionId: revision.id, extractionVersion: 'extractor-1', claims: [{ ...candidate, allowedUses: ['citation'] }] }),
    /broader/,
  );
  const { claims } = await repository.reconcileClaims({ ownerProfile: 'test.research', revisionId: revision.id, extractionVersion: 'extractor-1', claims: [candidate] });
  const claim = claims[0];
  await assert.rejects(repository.recordArtifact({ kind: 'message', usedClaimIds: [claim.id], usedEvidenceIds: [evidence.id], sensitivity: 'workspace', metadata: {} }), /less restrictive/);
  await assert.rejects(repository.recordAssessment({ kind: 'fit', subjectEntityIds: [company.id], policyKey: 'icp', policyVersion: 1, result: {}, supportingClaimIds: [claim.id], contradictingClaimIds: [], allowedUses: ['citation'] }), /broader/);
  await assert.rejects(repository.recordAssessment({ kind: 'fit', subjectEntityIds: [company.id], policyKey: 'icp', policyVersion: 1, result: {}, supportingClaimIds: [claim.id], contradictingClaimIds: [claim.id] }), /both support and contradict/);
});

test('a module role is added to one canonical identity instead of cloning it', async () => {
  const repository = new InMemoryKnowledgeRepository('org_roles', registry);
  const core = await repository.resolveEntity({ typeKey: 'core.organization', name: 'Acme', externalIds: { domain: 'acme.test' } });
  const role = await repository.resolveEntity({ typeKey: 'test.employer', name: 'Acme Incorporated', externalIds: { domain: 'acme.test' } });
  assert.notEqual(core.status, 'review_required');
  assert.notEqual(role.status, 'review_required');
  if (core.status === 'review_required' || role.status === 'review_required') throw new Error('identity resolution failed');
  assert.equal(role.entity.id, core.entity.id);
  assert.deepEqual(role.entity.typeKeys, ['core.organization', 'test.employer']);
  assert.equal(repository.entities.size, 1);
});

test('one matching provider identifier unifies roles and retains every identifier', async () => {
  const repository = new InMemoryKnowledgeRepository('org_multi_provider', registry);
  const core = await repository.resolveEntity({
    typeKey: 'core.person',
    name: 'Jane Doe',
    externalIds: { email: 'jane@example.test', workspace_contact: 'contact-1' },
  });
  const role = await repository.resolveEntity({
    typeKey: 'test.employee',
    name: 'J. Doe',
    externalIds: { workspace_contact: 'contact-1', outreach_prospect: 'prospect-9' },
  });
  assert.notEqual(core.status, 'review_required');
  assert.notEqual(role.status, 'review_required');
  if (core.status === 'review_required' || role.status === 'review_required') throw new Error('identity resolution failed');
  assert.equal(role.entity.id, core.entity.id);
  assert.deepEqual(role.entity.externalIds, {
    email: 'jane@example.test',
    workspace_contact: 'contact-1',
    outreach_prospect: 'prospect-9',
  });
  assert.ok(role.entity.aliases.includes('j doe'));
});

test('a restrictive module role raises the sensitivity of the canonical identity', async () => {
  const repository = new InMemoryKnowledgeRepository('org_role_policy', registry);
  const core = await repository.resolveEntity({ typeKey: 'core.person', name: 'Jane', externalIds: { crm: 'jane-1' }, sensitivity: 'public' });
  const role = await repository.resolveEntity({ typeKey: 'test.employee', name: 'Jane', externalIds: { crm: 'jane-1' } });
  assert.notEqual(core.status, 'review_required');
  assert.notEqual(role.status, 'review_required');
  if (core.status === 'review_required' || role.status === 'review_required') throw new Error('identity resolution failed');
  assert.equal(role.entity.id, core.entity.id);
  assert.equal(role.entity.sensitivity, 'restricted');
});

test('distinct entities of the same registered type are created without false ambiguity', async () => {
  const repository = new InMemoryKnowledgeRepository('org_distinct_concepts', registry);
  const first = await repository.resolveEntity({ typeKey: 'core.concept', name: 'Vector databases' });
  const second = await repository.resolveEntity({ typeKey: 'core.concept', name: 'Semantic search' });

  assert.notEqual(first.status, 'review_required');
  assert.notEqual(second.status, 'review_required');
  if (first.status === 'review_required' || second.status === 'review_required') throw new Error('unexpected identity review');
  assert.notEqual(first.entity.id, second.entity.id);
  assert.equal(repository.entities.size, 2);
});
