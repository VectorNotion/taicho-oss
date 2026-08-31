import assert from 'node:assert/strict';
import test from 'node:test';
import { runExtractionPipeline } from '../extraction/pipeline';
import type { ExtractorAdapter } from '../extraction/types';
import { InlineSourceAdapter } from '../ingestion/source-adapter';
import { InMemoryKnowledgeRepository } from '../repository';
import { compileKnowledgeRegistry } from '../registry/compiler';
import { coreKnowledgeManifest } from '../registry/core-manifest';
import { defineKnowledgeManifest } from '../registry/schema';

const moduleManifest = defineKnowledgeManifest({
  moduleKey: 'pipeline', version: 1, knowledge: 'contributes',
  entityTypes: [
    { key: 'pipeline.company', name: 'Company', description: 'A company.', baseKind: 'organization', extends: 'core.organization' },
    { key: 'pipeline.technology', name: 'Technology', description: 'A technology.', baseKind: 'concept', extends: 'core.concept' },
  ],
  predicates: [{ key: 'pipeline.uses', name: 'Uses', description: 'A company uses a technology.', subjectTypes: ['pipeline.company'], objectTypes: ['pipeline.technology'], objectKind: 'entity', allowedUses: ['research', 'content', 'outreach', 'internal'] }],
  extractionProfiles: [{ key: 'pipeline.research', name: 'Research', description: 'Extract company technology use.', entityTypes: ['pipeline.company', 'pipeline.technology'], predicates: ['pipeline.uses'], instructions: ['Use only exact evidence.'] }],
  readProjections: [{ key: 'pipeline.context', name: 'Context', description: 'Company technology context.', entityTypes: ['pipeline.company', 'pipeline.technology'], predicates: ['pipeline.uses'], allowedUses: ['research'], defaultLimit: 20 }],
  capabilityIds: [], aliases: [], migrations: [],
});
const registry = compileKnowledgeRegistry([coreKnowledgeManifest, moduleManifest]);

let extractionCalls = 0;
const extractor: ExtractorAdapter = {
  key: 'fixture', version: '1',
  async extract({ chunks, schema }) {
    extractionCalls += 1;
    assert.deepEqual(schema.entityTypes.map(({ key }) => key), ['pipeline.company', 'pipeline.technology']);
    const statement = 'Acme uses GraphDB.';
    const start = chunks[0].text.indexOf(statement);
    return {
      entities: [
        { localKey: 'acme', typeKey: 'pipeline.company', name: 'Acme', externalIds: { domain: 'acme.test' } },
        { localKey: 'graphdb', typeKey: 'pipeline.technology', name: 'GraphDB' },
      ],
      claims: [{ subjectKey: 'acme', predicateKey: 'pipeline.uses', object: { kind: 'entity', entityKey: 'graphdb' }, statement, evidence: [{ start, end: start + statement.length, excerpt: statement }], confidence: 0.98, allowedUses: ['research', 'content', 'outreach', 'internal'] }],
    };
  },
};

test('bounded extraction writes evidence-backed claims and unchanged replay has zero graph delta', async () => {
  extractionCalls = 0;
  const repository = new InMemoryKnowledgeRepository('org_pipeline', registry);
  const input = {
    adapter: new InlineSourceAdapter(),
    adapterInput: { kind: 'web' as const, canonicalUri: 'https://example.com/?utm_source=test', content: 'Heading\n\nAcme uses GraphDB.', allowedUses: ['research', 'content', 'outreach', 'internal'] as const },
    extractor,
    profileKey: 'pipeline.research',
    registry,
    repository,
  };
  const first = await runExtractionPipeline({ ...input, adapterInput: { ...input.adapterInput, allowedUses: [...input.adapterInput.allowedUses] } });
  const replay = await runExtractionPipeline({ ...input, adapterInput: { ...input.adapterInput, allowedUses: [...input.adapterInput.allowedUses] } });
  assert.equal(first.source.canonicalUri, 'https://example.com/');
  assert.equal(first.revisionCreated, true);
  assert.equal(first.replayed, false);
  assert.equal(first.reconciled.created, 1);
  assert.equal(replay.revisionCreated, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.source.updatedAt, first.source.updatedAt);
  assert.deepEqual({ created: replay.reconciled.created, unchanged: replay.reconciled.unchanged, superseded: replay.reconciled.superseded }, { created: 0, unchanged: 1, superseded: 0 });
  assert.equal(replay.run.metrics.accepted, 1);
  assert.equal(extractionCalls, 1);
  assert.equal(repository.runs.size, 1);

  const changedRegistry = { ...registry, hash: 'registry_hash_changed' };
  const afterSchemaChange = await runExtractionPipeline({ ...input, registry: changedRegistry, adapterInput: { ...input.adapterInput, allowedUses: [...input.adapterInput.allowedUses] } });
  assert.equal(afterSchemaChange.replayed, false);
  assert.equal(extractionCalls, 2);
  assert.equal(repository.runs.size, 2);
});
