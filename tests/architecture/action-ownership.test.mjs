import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const catalog = JSON.parse(
  await readFile(path.join(root, 'packages/platform/agents/action-catalog.json'), 'utf8'),
);

test('every background action has exactly one product owner', () => {
  const actions = [
    ...catalog.content,
    ...catalog.outreach,
    ...catalog.cascade,
    ...catalog.resonance,
  ];
  assert.equal(new Set(actions).size, actions.length);
  assert.equal(catalog.outreachGenerationRuntime, 'mastra');
  assert.equal(catalog.outreach.includes('generate_outreach'), true);
  assert.equal(catalog.runtimes.generate_outreach, 'mastra');
});

test('the Python LangGraph service and its proxy routes are fully removed', async () => {
  await assert.rejects(stat(path.join(root, 'graph')));
  await assert.rejects(stat(path.join(root, 'apps/unified/app/api/langgraph')));
  await assert.rejects(stat(path.join(root, 'apps/content-generator/app/api/langgraph')));
  await assert.rejects(
    stat(path.join(root, 'packages/platform/jobs/workers/generate-outreach.js')),
  );
});
