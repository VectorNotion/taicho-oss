import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compileKnowledgeRegistry } from '../registry/compiler';
import { coreKnowledgeManifest } from '../registry/core-manifest';
import { canonicalManifestPayload, knowledgeModuleManifestJsonSchema, loadExternalKnowledgeManifest, manifestDigest } from '../registry/external';
import { InMemoryKnowledgeRepository } from '../repository';

test('a trusted external module compiles without graph-specific code', async () => {
  const input = JSON.parse(await readFile(new URL('./fixtures/external-module.json', import.meta.url), 'utf8'));
  const signature = manifestDigest(input);
  const options = {
    trustedModuleKeys: new Set(['partner']),
    supportedVersions: new Set([1]),
    signature,
    verifySignature: (payload: string, candidate: string) => candidate === manifestDigest(JSON.parse(payload)),
  };
  const manifest = loadExternalKnowledgeManifest(input, options);
  const compiled = compileKnowledgeRegistry([coreKnowledgeManifest, manifest], { capabilityIds: new Set([...coreKnowledgeManifest.capabilityIds, 'partner.signals.get']) });
  assert.ok(compiled.entityTypes.has('partner.signal'));
  assert.ok(compiled.readProjections.has('partner.context'));
  const repository = new InMemoryKnowledgeRepository('org_partner', compiled);
  const source = await repository.upsertSource({ kind: 'api', canonicalUri: 'partner://signals/1', allowedUses: ['research', 'internal'] });
  const content = 'Partner signal 1 concerns Acme.';
  const { revision } = await repository.putSourceRevision({ sourceId: source.id, content, contentHash: 'partner_hash_1' });
  const [evidence] = await repository.putEvidenceSpans(revision.id, [{ start: 0, end: content.length, excerpt: content }]);
  const signal = await repository.resolveEntity({ typeKey: 'partner.signal', name: 'Partner signal 1', externalIds: { partner: 'signal-1' } });
  const organization = await repository.resolveEntity({ typeKey: 'core.organization', name: 'Acme', externalIds: { domain: 'acme.test' } });
  assert.notEqual(signal.status, 'review_required');
  assert.notEqual(organization.status, 'review_required');
  if (signal.status === 'review_required' || organization.status === 'review_required') throw new Error('external fixture identity resolution failed');
  const reconciled = await repository.reconcileClaims({ ownerProfile: 'partner.research', revisionId: revision.id, extractionVersion: 'partner@1', claims: [{ subjectEntityId: signal.entity.id, predicateKey: 'partner.signal_about', object: { kind: 'entity', entityId: organization.entity.id }, statement: content, evidenceIds: [evidence.id], confidence: 0.92 }] });
  const context = await repository.queryContext({ projectionKey: 'partner.context', subjectEntityIds: [signal.entity.id], policy: { organizationId: 'org_partner', use: 'research', maxSensitivity: 'workspace' } });
  assert.deepEqual(context.claims.map(({ id }) => id), [reconciled.claims[0].id]);
  assert.equal(context.evidence[0]?.excerpt, content);
  assert.equal((knowledgeModuleManifestJsonSchema as { type?: string }).type, 'object');
  assert.equal(canonicalManifestPayload(input), canonicalManifestPayload({ ...input, entityTypes: input.entityTypes.map((entry: Record<string, unknown>) => Object.fromEntries(Object.entries(entry).reverse())) }));
  assert.throws(() => loadExternalKnowledgeManifest(input, { ...options, trustedModuleKeys: new Set() }), /not trusted/);
  assert.throws(() => loadExternalKnowledgeManifest(input, { ...options, supportedVersions: new Set([2]) }), /not supported/);
  assert.throws(() => loadExternalKnowledgeManifest(input, { ...options, signature: 'tampered' }), /signature is invalid/);
});
