/**
 * DI-stubbed unit tests for the build-project-graph orchestrator (no network /
 * no DB). All dependencies (repositories, settings, the entity extractor) are
 * injected.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runBuildProjectGraph,
  type BuildProjectGraphDeps,
  type ProjectEntities,
} from '../agent/actions/project-graph';
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

interface Recorder {
  stored: Array<{ projectId: string; entity: { name: string; type: string } }>;
  processed: Array<{ projectId: string; entityCount: number }>;
  extractCalls: number;
}

function makeDeps(config: {
  state: { processed: boolean; entityCount: number } | null;
  project?: { title: string; description: string } | null;
  entities?: ProjectEntities['entities'];
}): { deps: Partial<BuildProjectGraphDeps>; rec: Recorder } {
  const rec: Recorder = { stored: [], processed: [], extractCalls: 0 };

  const deps: Partial<BuildProjectGraphDeps> = {
    getProjectProcessingState: async () => config.state,
    getProjectById: async () =>
      config.project === undefined ? PROJECT : config.project,
    getSettings: async () => SETTINGS,
    extractEntities: async () => {
      rec.extractCalls++;
      return { entities: config.entities ?? [] };
    },
    storeProjectEntity: async (projectId, entity) => {
      rec.stored.push({ projectId, entity });
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

test('already-processed project → skipped, no extraction or writes', async () => {
  const { deps, rec } = makeDeps({
    state: { processed: true, entityCount: 12 },
  });

  const result = await runBuildProjectGraph({ projectId: 'proj-1' }, deps);

  assert.deepEqual(result, {
    status: 'skipped',
    projectId: 'proj-1',
    entityCount: 12,
    reason: 'already processed',
  });
  assert.equal(rec.extractCalls, 0, 'must not extract when already processed');
  assert.equal(rec.stored.length, 0);
  assert.equal(rec.processed.length, 0);
});

test('unprocessed project → extracts, stores each entity, marks processed', async () => {
  const entities: ProjectEntities['entities'] = [
    { name: 'Next.js', type: 'Framework' },
    { name: 'Postgres', type: 'Database' },
    { name: 'RAG pipeline', type: 'AIComponent' },
  ];
  const { deps, rec } = makeDeps({
    state: { processed: false, entityCount: 0 },
    entities,
  });

  const result = await runBuildProjectGraph({ projectId: 'proj-1' }, deps);

  assert.equal(result.status, 'success');
  assert.equal(result.projectId, 'proj-1');
  assert.equal(result.entityCount, 3);
  assert.deepEqual(result.entities, entities);

  // Every extracted entity is stored against the project...
  assert.equal(rec.stored.length, 3);
  assert.deepEqual(
    rec.stored.map((s) => s.entity),
    entities
  );
  assert.ok(rec.stored.every((s) => s.projectId === 'proj-1'));

  // ...and the project is marked processed with the entity count.
  assert.equal(rec.processed.length, 1);
  assert.deepEqual(rec.processed[0], { projectId: 'proj-1', entityCount: 3 });
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
