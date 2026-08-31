/**
 * DI-stubbed unit tests for the build-project-graph orchestrator (no network /
 * no DB). All dependencies (repositories, settings, the entity extractor, the
 * type index, and the type resolver) are injected.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  localProjectExtractEntities,
  runBuildProjectGraph,
  type BuildProjectGraphDeps,
  type ProjectEntities,
} from '../agent/actions/project-graph';
import { resolveExtractedTypes, type TypeIndexEntry } from '../agent/actions/project-graph-typing';
import { stubEmbedTexts } from '@content-automation/knowledge';
import type { Settings } from '@/packages/platform/settings/types';

const PROJECT = {
  title: 'Acme Analytics',
  description: 'A Next.js dashboard on Postgres that surfaces RAG-powered insights.',
};

const SETTINGS: Settings = {
  id: 'global',
  mission: 'mission',
  identity: 'identity',
  voice: 'voice',
  updatedAt: '2026-01-01T00:00:00Z',
};

const TYPE_INDEX: TypeIndexEntry[] = [
  { key: 'content.framework', name: 'Framework', description: 'A reusable technical or business framework.', baseKind: 'concept' },
  { key: 'content.database', name: 'Database', description: 'A database technology or data-store concept.', baseKind: 'concept' },
  { key: 'content.ai_component', name: 'AI component', description: 'An AI or machine-learning capability or subsystem.', baseKind: 'concept' },
];

test('local project extraction emits progress and returns only concepts named by the description', async () => {
  const emitted: Array<{ type: string; data: unknown }> = [];
  const extract = localProjectExtractEntities((part) => emitted.push(part));
  const result = await extract({
    title: 'Browser QA knowledge project',
    description: 'A Next.js app backed by PostgreSQL with durable workflow recovery and signed webhooks.',
  }, SETTINGS, TYPE_INDEX);

  assert.deepEqual(result.entities.map(({ name, type }) => ({ name, type })), [
    { name: 'Next.js', type: 'content.framework' },
    { name: 'PostgreSQL', type: 'content.database' },
    { name: 'Signed webhooks', type: 'content.integration' },
    { name: 'Durable workflow recovery', type: 'content.feature' },
  ]);
  assert.deepEqual(emitted.map(({ type }) => type), ['data-reasoning', 'data-partial']);
  assert.deepEqual((emitted[1].data as { entities: unknown[] }).entities, result.entities.map(({ name, type }) => ({ name, type })));
});

interface Recorder {
  stored: Array<{ projectId: string; entity: { name: string; typeKey: string } }>;
  misses: Array<{ name: string; proposedTypeName: string }>;
  processed: Array<{ projectId: string; entityCount: number }>;
  extractCalls: number;
}

function makeDeps(config: {
  state: { processed: boolean; entityCount: number } | null;
  project?: { title: string; description: string } | null;
  entities?: ProjectEntities['entities'];
}): { deps: Partial<BuildProjectGraphDeps>; rec: Recorder } {
  const rec: Recorder = { stored: [], misses: [], processed: [], extractCalls: 0 };

  const deps: Partial<BuildProjectGraphDeps> = {
    getProjectProcessingState: async () => config.state,
    getProjectById: async () =>
      config.project === undefined ? PROJECT : config.project,
    getSettings: async () => SETTINGS,
    resolveTypeIndex: async () => TYPE_INDEX,
    resolveTypes: (entities, index) => resolveExtractedTypes(entities, index, stubEmbedTexts),
    extractEntities: async () => {
      rec.extractCalls++;
      return { entities: config.entities ?? [] };
    },
    reconcileProjectKnowledge: async ({ projectId, entities }) => {
      for (const entity of entities) {
        rec.stored.push({ projectId, entity: { name: entity.name, typeKey: entity.typeKey } });
        if (entity.miss) rec.misses.push({ name: entity.name, proposedTypeName: entity.miss.proposedTypeName });
      }
      return { claims: [], created: entities.length, unchanged: 0, superseded: 0 };
    },
    markProjectProcessed: async (projectId, entityCount) => {
      rec.processed.push({ projectId, entityCount });
    },
  };

  return { deps, rec };
}

test('unknown project (null state) throws, no writes', async () => {
  const { deps, rec } = makeDeps({ state: null });

  await assert.rejects(
    runBuildProjectGraph({ projectId: 'proj-missing' }, deps),
    /Project not found: proj-missing/
  );
  assert.equal(rec.extractCalls, 0, 'must not extract');
  assert.equal(rec.stored.length, 0, 'must not store entities');
  assert.equal(rec.processed.length, 0, 'must not mark processed');
});

test('already-processed project is reconciled again so changed knowledge can supersede stale claims', async () => {
  const { deps, rec } = makeDeps({
    state: { processed: true, entityCount: 12 },
  });

  const result = await runBuildProjectGraph({ projectId: 'proj-1' }, deps);

  assert.equal(result.status, 'success');
  assert.equal(rec.extractCalls, 1);
  assert.equal(rec.stored.length, 0);
  assert.deepEqual(rec.processed, [{ projectId: 'proj-1', entityCount: 0 }]);
});

test('unprocessed project → extracts, types registered entities, marks processed', async () => {
  const entities: ProjectEntities['entities'] = [
    { name: 'Next.js', type: 'content.framework', kind: 'concept', definition: 'A React web framework.' },
    { name: 'Postgres', type: 'Database', kind: 'concept', definition: 'A relational database.' },
    { name: 'RAG pipeline', type: 'ai component', kind: 'concept', definition: 'Retrieval-augmented generation subsystem.' },
  ];
  const { deps, rec } = makeDeps({
    state: { processed: false, entityCount: 0 },
    entities,
  });

  const result = await runBuildProjectGraph({ projectId: 'proj-1' }, deps);

  assert.equal(result.status, 'success');
  assert.equal(result.projectId, 'proj-1');
  assert.equal(result.entityCount, 3);
  // Key, label, and key-tail matches all resolve to registered type keys.
  assert.deepEqual(
    result.entities,
    [
      { name: 'Next.js', type: 'content.framework' },
      { name: 'Postgres', type: 'content.database' },
      { name: 'RAG pipeline', type: 'content.ai_component' },
    ]
  );
  assert.deepEqual(result.typeCandidates, []);
  assert.equal(rec.misses.length, 0);

  assert.equal(rec.stored.length, 3);
  assert.ok(rec.stored.every((s) => s.projectId === 'proj-1'));
  assert.equal(rec.processed.length, 1);
  assert.deepEqual(rec.processed[0], { projectId: 'proj-1', entityCount: 3 });
});

test('a concept no registered type fits falls back to its core kind and becomes a type candidate', async () => {
  const entities: ProjectEntities['entities'] = [
    { name: 'Postgres', type: 'content.database', kind: 'concept', definition: 'A relational database.' },
    { name: 'hybrid retrieval', type: 'retrieval technique', kind: 'concept', definition: 'Combining vector and graph search for lookup.' },
  ];
  const { deps, rec } = makeDeps({
    state: { processed: false, entityCount: 0 },
    entities,
  });

  const result = await runBuildProjectGraph({ projectId: 'proj-1' }, deps);

  assert.equal(result.entityCount, 2, 'the miss is stored, never dropped');
  assert.deepEqual(result.entities?.[1], { name: 'hybrid retrieval', type: 'core.concept' });
  assert.deepEqual(result.typeCandidates, [{ name: 'hybrid retrieval', proposedTypeName: 'retrieval technique' }]);
  assert.deepEqual(rec.misses, [{ name: 'hybrid retrieval', proposedTypeName: 'retrieval technique' }]);
});

test('project row vanishes after the state check → throws before extraction', async () => {
  const { deps, rec } = makeDeps({
    state: { processed: false, entityCount: 0 },
    project: null,
  });

  await assert.rejects(
    runBuildProjectGraph({ projectId: 'proj-1' }, deps),
    /Project not found: proj-1/
  );
  assert.equal(rec.extractCalls, 0);
  assert.equal(rec.stored.length, 0);
  assert.equal(rec.processed.length, 0);
});
