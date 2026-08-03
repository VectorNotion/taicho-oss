import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTION_CATALOG,
  getActionProduct,
  type BackgroundAction,
} from '../agents/contracts';
import { DEFAULT_MODEL_SLUG, modelSlug, routerModel } from '../agents/model';
import { actionHandlers } from '../agents/registry';

test('every catalog action has exactly one runtime handler', () => {
  const catalogActions = [
    ...ACTION_CATALOG.content,
    ...ACTION_CATALOG.outreach,
    ...ACTION_CATALOG.cascade,
  ].sort();
  assert.equal(new Set(catalogActions).size, catalogActions.length);
  assert.deepEqual(Object.keys(actionHandlers).sort(), catalogActions);
  assert.deepEqual(Object.keys(ACTION_CATALOG.runtimes).sort(), catalogActions);
});

test('catalog actions resolve to their owning product', () => {
  for (const action of ACTION_CATALOG.content) {
    assert.equal(getActionProduct(action as BackgroundAction), 'content');
  }
  for (const action of ACTION_CATALOG.outreach) {
    assert.equal(getActionProduct(action as BackgroundAction), 'outreach');
  }
  for (const action of ACTION_CATALOG.cascade) {
    assert.equal(getActionProduct(action as BackgroundAction), 'cascade');
  }
});

test('shipping actions are registry-backed, resonance_run never is', () => {
  assert.equal(getActionProduct('schedule_post'), 'content');
  assert.equal(getActionProduct('enroll_in_funnel'), 'cascade');
  assert.equal(getActionProduct('generate_outreach'), 'outreach');
  assert.ok('schedule_post' in actionHandlers);
  assert.ok('enroll_in_funnel' in actionHandlers);
  assert.ok('generate_outreach' in actionHandlers);
  assert.ok(!('resonance_run' in actionHandlers)); // Modal-dispatched — contracts.ts
});

test('unknown actions are rejected instead of silently becoming outreach actions', () => {
  assert.throws(
    () => getActionProduct('not_registered' as BackgroundAction),
    /Unknown background action/,
  );
});

test('model selection has one default and a deterministic OpenRouter prefix', () => {
  const previous = process.env.MODEL_NAME;
  try {
    delete process.env.MODEL_NAME;
    assert.equal(modelSlug(), DEFAULT_MODEL_SLUG);
    assert.equal(routerModel(), `openrouter/${DEFAULT_MODEL_SLUG}`);

    process.env.MODEL_NAME = 'vendor/custom-model';
    assert.equal(modelSlug(), 'vendor/custom-model');
    assert.equal(routerModel(), 'openrouter/vendor/custom-model');
  } finally {
    if (previous === undefined) delete process.env.MODEL_NAME;
    else process.env.MODEL_NAME = previous;
  }
});
