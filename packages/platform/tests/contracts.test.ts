import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTION_CATALOG,
  getActionProduct,
  type BackgroundAction,
} from '../agents/contracts';
import {
  AI_GENERATION_NOT_CONFIGURED_MESSAGE,
  LANGUAGE_RUNTIME_VERSION,
  PRIMARY_LANGUAGE_MODEL_SLUG,
  createLanguageModelRuntime,
  modelSlug,
  routerModel,
} from '../agents/model';
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
  assert.equal(getActionProduct('add_to_funnel'), 'cascade');
  assert.equal(getActionProduct('generate_outreach'), 'outreach');
  assert.ok('schedule_post' in actionHandlers);
  assert.ok('add_to_funnel' in actionHandlers);
  assert.ok('generate_outreach' in actionHandlers);
  assert.ok(!('resonance_run' in actionHandlers)); // Modal-dispatched — contracts.ts
});

test('unknown actions are rejected instead of silently becoming outreach actions', () => {
  assert.throws(
    () => getActionProduct('not_registered' as BackgroundAction),
    /Unknown background action/,
  );
});

test('the language runtime exposes one release-owned OpenRouter target', () => {
  assert.equal(modelSlug(), PRIMARY_LANGUAGE_MODEL_SLUG);
  assert.equal(routerModel(), `openrouter/${PRIMARY_LANGUAGE_MODEL_SLUG}`);

  const configured = createLanguageModelRuntime({
    environment: { OPENROUTER_API_KEY: 'test-key' },
  });
  assert.equal(configured.isConfigured(), true);
  assert.deepEqual(configured.requireReady(), {
    provider: 'openrouter',
    modelId: PRIMARY_LANGUAGE_MODEL_SLUG,
    runtimeVersion: LANGUAGE_RUNTIME_VERSION,
  });
});

test('runtime readiness and test injection do not mutate global process state', () => {
  const missing = createLanguageModelRuntime({ environment: {} });
  assert.equal(missing.isConfigured(), false);
  assert.throws(
    () => missing.requireReady(),
    new RegExp(AI_GENERATION_NOT_CONFIGURED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );

  const injected = createLanguageModelRuntime({
    environment: { OPENROUTER_API_KEY: 'test-key' },
    primaryModelSlug: 'test/provider-model',
  });
  assert.equal(injected.routerModel, 'openrouter/test/provider-model');
  assert.equal(injected.execution.modelId, 'test/provider-model');
  assert.equal(modelSlug(), PRIMARY_LANGUAGE_MODEL_SLUG);
});

test('production rejects language-generation simulation modes', () => {
  const runtime = createLanguageModelRuntime({
    environment: {
      NODE_ENV: 'production',
      OPENROUTER_API_KEY: 'test-key',
      TAICHO_CHAT_SIMULATION: '1',
    },
  });
  assert.throws(() => runtime.requireReady(), /TAICHO_CHAT_SIMULATION=1 is forbidden/);
});
