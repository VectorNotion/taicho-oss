import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clusterCandidates,
  learnedTypeKey,
  planCuration,
  planEntityMerges,
  planTypeDecay,
  type CurationThresholds,
} from '../curation/engine';
import { cosineSimilarity, stubEmbedTexts } from '../curation/embeddings';
import { ONTOLOGY_SCHEMA_VERSION, type TypeCandidate } from '../ontology/types';

const thresholds: CurationThresholds = {
  clusterSimilarity: 0.82,
  aliasSimilarity: 0.86,
  minimumSources: 2,
  candidateTtlDays: 30,
  typeDecayDays: 45,
};

let sequence = 0;
async function candidate(input: Partial<TypeCandidate> & { surface: string; proposedTypeName: string }): Promise<TypeCandidate> {
  sequence += 1;
  const [embedding] = await stubEmbedTexts([`${input.proposedTypeName}: ${input.definition ?? input.surface}`]);
  return {
    id: `cand_${sequence}`,
    schemaVersion: ONTOLOGY_SCHEMA_VERSION,
    organizationId: 'org',
    surface: input.surface,
    normalizedSurface: input.surface.toLowerCase(),
    proposedTypeName: input.proposedTypeName,
    normalizedProposedTypeName: input.proposedTypeName.toLowerCase(),
    definition: input.definition ?? `${input.surface} definition`,
    baseKind: input.baseKind ?? 'concept',
    profileKey: 'content.project_extraction',
    evidence: 'evidence',
    docRefs: input.docRefs ?? ['doc-1'],
    entityIds: input.entityIds ?? [],
    recurrence: (input.docRefs ?? ['doc-1']).length,
    status: input.status ?? 'open',
    embedding: input.embedding ?? embedding,
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test('stub embeddings are deterministic and rank identical text highest', async () => {
  const [first, second, other] = await stubEmbedTexts(['hybrid retrieval technique', 'hybrid retrieval technique', 'noise cancellation feature']);
  assert.deepEqual(first, second);
  assert.ok(cosineSimilarity(first, second) > 0.999);
  assert.ok(cosineSimilarity(first, other) < cosineSimilarity(first, second));
});

test('identical candidates cluster together; unrelated ones do not', async () => {
  const members = [
    await candidate({ surface: 'hybrid retrieval', proposedTypeName: 'technique', definition: 'combining vector and graph search' }),
    await candidate({ surface: 'hybrid retrieval', proposedTypeName: 'technique', definition: 'combining vector and graph search' }),
    await candidate({ surface: 'noise cancellation', proposedTypeName: 'capability', definition: 'filtering audio input noise' }),
  ];
  const clusters = clusterCandidates(members, thresholds.clusterSimilarity);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].members.length, 2);
});

test('a cluster recurring across enough sources becomes a learned type', async () => {
  const recurring = await candidate({
    surface: 'audit trail',
    proposedTypeName: 'capability',
    definition: 'traceable record of automated decisions',
    docRefs: ['doc-1', 'doc-2', 'doc-3'],
    entityIds: ['ent-1', 'ent-2'],
  });
  const plan = planCuration({ candidates: [recurring], existingTypes: [], vetoedNames: new Set(), takenTypeKeys: new Set(), thresholds });
  assert.equal(plan.newTypes.length, 1);
  assert.equal(plan.newTypes[0].key, 'learned.capability');
  assert.deepEqual(plan.newTypes[0].entityIds, ['ent-1', 'ent-2']);
  assert.equal(plan.aliasMappings.length, 0);
});

test('a recurrent candidate without definition or evidence stays deferred instead of becoming a type', async () => {
  const ungrounded = await candidate({
    surface: 'mystery pattern',
    proposedTypeName: 'unsupported pattern',
    definition: '',
    evidence: '',
    docRefs: ['doc-1', 'doc-2'],
  });
  const plan = planCuration({
    candidates: [ungrounded],
    existingTypes: [],
    vetoedNames: new Set(),
    takenTypeKeys: new Set(),
    thresholds,
  });
  assert.equal(plan.newTypes.length, 0);
  assert.deepEqual(plan.deferredCandidateIds, [ungrounded.id]);
  assert.equal(plan.stillOpen, 1);
});

test('a single-source cluster stays open instead of becoming a type', async () => {
  const single = await candidate({ surface: 'audit trail', proposedTypeName: 'capability', docRefs: ['doc-1'] });
  const plan = planCuration({ candidates: [single], existingTypes: [], vetoedNames: new Set(), takenTypeKeys: new Set(), thresholds });
  assert.equal(plan.newTypes.length, 0);
  assert.equal(plan.stillOpen, 1);
});

test('a cluster matching an existing type maps as an alias, never a duplicate type', async () => {
  const definition = 'a reusable technical or business framework';
  const [typeEmbedding] = await stubEmbedTexts([`Framework: ${definition}`]);
  const near = await candidate({
    surface: 'LangChain',
    proposedTypeName: 'Framework',
    definition,
    docRefs: ['doc-1', 'doc-2'],
    entityIds: ['ent-9'],
  });
  const plan = planCuration({
    candidates: [near],
    existingTypes: [{ key: 'content.framework', name: 'Framework', description: definition, baseKind: 'concept', embedding: typeEmbedding }],
    vetoedNames: new Set(),
    takenTypeKeys: new Set(['content.framework']),
    thresholds,
  });
  assert.equal(plan.newTypes.length, 0);
  assert.equal(plan.aliasMappings.length, 1);
  assert.equal(plan.aliasMappings[0].typeKey, 'content.framework');
});

test('vetoed names are dismissed and never become types again', async () => {
  const recurring = await candidate({ surface: 'audit trail', proposedTypeName: 'capability', docRefs: ['doc-1', 'doc-2', 'doc-3'] });
  const plan = planCuration({ candidates: [recurring], existingTypes: [], vetoedNames: new Set(['capability']), takenTypeKeys: new Set(), thresholds });
  assert.equal(plan.newTypes.length, 0);
  assert.ok(plan.dismissedCandidateIds.includes(recurring.id));
});

test('stale single-source candidates are dismissed after the TTL', async () => {
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const stale = await candidate({ surface: 'one off thing', proposedTypeName: 'oddity', docRefs: ['doc-1'], createdAt: old });
  const plan = planCuration({ candidates: [stale], existingTypes: [], vetoedNames: new Set(), takenTypeKeys: new Set(), thresholds });
  assert.ok(plan.dismissedCandidateIds.includes(stale.id));
});

test('learned type keys are namespaced, slugged, and collision-safe', () => {
  const taken = new Set(['learned.technique']);
  assert.equal(learnedTypeKey('Technique', taken), 'learned.technique_2');
  assert.equal(learnedTypeKey('Buying Signal!', new Set()), 'learned.buying_signal');
});

test('unused learned types decay after the window; used ones survive', () => {
  const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const decayed = planTypeDecay({
    learnedTypes: [
      { key: 'learned.dead', createdAt: old },
      { key: 'learned.alive', createdAt: old },
      { key: 'learned.young', createdAt: new Date().toISOString() },
    ],
    instanceCounts: new Map([['learned.alive', 4]]),
    thresholds,
  });
  assert.deepEqual(decayed, ['learned.dead']);
});

test('exact-name duplicate entities sharing a type merge into the oldest', () => {
  const merges = planEntityMerges([
    { id: 'young', normalizedName: 'neo4j', typeKeys: ['content.database'], createdAt: '2026-08-02T00:00:00Z' },
    { id: 'old', normalizedName: 'neo4j', typeKeys: ['content.database'], createdAt: '2026-08-01T00:00:00Z' },
    { id: 'unrelated', normalizedName: 'neo4j', typeKeys: ['core.person'], createdAt: '2026-08-03T00:00:00Z' },
    { id: 'solo', normalizedName: 'langgraph', typeKeys: ['content.framework'], createdAt: '2026-08-01T00:00:00Z' },
  ]);
  assert.deepEqual(merges, [{ survivorId: 'old', duplicateId: 'young' }]);
});

test('a cluster named after a bare core kind is dismissed, never created', async () => {
  const first = await candidate({ surface: 'Scania', proposedTypeName: 'organization', baseKind: 'organization', docRefs: ['doc-1'] });
  const second = await candidate({ surface: 'Wand.ai', proposedTypeName: 'organization', baseKind: 'organization', docRefs: ['doc-2'] });
  const plan = planCuration({ candidates: [first, second], existingTypes: [], vetoedNames: new Set(), takenTypeKeys: new Set(), thresholds });
  assert.equal(plan.newTypes.length, 0);
  assert.ok(plan.dismissedCandidateIds.includes(first.id));
  assert.ok(plan.dismissedCandidateIds.includes(second.id));
});
