process.env.FALKORDB_URL = process.env.FALKORDB_URL ?? 'redis://localhost:6380';
process.env.FALKORDB_GRAPH = process.env.FALKORDB_GRAPH ?? 'outreach_test';

import assert from 'node:assert/strict';
import nodeTest, { after, before } from 'node:test';
import {
  closeDriver,
  getSession,
  runWithGraphOrganization,
} from '@content-automation/platform/data/graph';
import { DEFAULT_DIMENSIONS } from '../data/default-dimensions';
import {
  createDimensionDefinition,
  deleteDimensionDefinition,
  getDimensionDefinitions,
  updateDimensionDefinition,
} from '../data/dimension-repository';

const ORGANIZATION_ID = `outreach-dimension-test-organization-${process.pid}`;
const SCOPED_SEED_ORGANIZATION_ID = `outreach-dimension-scoped-seed-${process.pid}`;

function inOrganization<T>(callback: () => T): T {
  return runWithGraphOrganization(ORGANIZATION_ID, callback);
}

function test(name: string, body: () => void | Promise<void>) {
  return nodeTest(name, () => inOrganization(body));
}

async function clearGraph() {
  const session = await getSession();
  try { await session.run('MATCH (n) DETACH DELETE n'); }
  finally { await session.close(); }
}

before(() => inOrganization(clearGraph));
after(() => inOrganization(async () => {
  await clearGraph();
  await runWithGraphOrganization(SCOPED_SEED_ORGANIZATION_ID, clearGraph);
  await closeDriver();
}));

test('workspace defaults seed even when a Catalog-scoped dimension already exists', async () => {
  await runWithGraphOrganization(SCOPED_SEED_ORGANIZATION_ID, async () => {
    await clearGraph();
    const catalogItemId = '77777777-7777-4777-8777-777777777777';
    await createDimensionDefinition({
      ...DEFAULT_DIMENSIONS[0],
      catalogItemId,
    });

    const effective = await getDimensionDefinitions({ catalogItemId, seedIfEmpty: true });
    assert.equal(effective.length, DEFAULT_DIMENSIONS.length + 1);
    assert.equal(effective.filter((dimension) => !dimension.catalogItemId).length, DEFAULT_DIMENSIONS.length);

    const workspace = await getDimensionDefinitions();
    assert.equal(workspace.length, DEFAULT_DIMENSIONS.length);
  });
});

test('seedIfEmpty seeds the spec defaults exactly once', async () => {
  const seeded = await getDimensionDefinitions({ seedIfEmpty: true });
  assert.equal(seeded.length, DEFAULT_DIMENSIONS.length);

  const again = await getDimensionDefinitions({ seedIfEmpty: true });
  assert.equal(again.length, DEFAULT_DIMENSIONS.length, 'seeding is idempotent');

  const icp = seeded.filter((d) => d.appliesTo === 'account' && d.dimensionType === 'fit');
  const persona = seeded.filter((d) => d.appliesTo === 'prospect' && d.dimensionType === 'fit');
  const timing = seeded.filter((d) => d.appliesTo === 'account' && d.dimensionType === 'timing');
  assert.equal(icp.length, 5);
  assert.equal(persona.length, 7);
  assert.equal(timing.length, 4);

  const hiring = seeded.find((d) => d.key === 'hiring_activity');
  assert.equal(hiring?.halfLifeDays, 45);
  assert.equal(hiring?.freshnessWindowDays, 14);
  assert.ok(Math.abs((hiring?.weight ?? 0) - 0.35) < 1e-9);

  const ai = seeded.find((d) => d.key === 'internal_ai_capability');
  assert.ok(ai?.hardExclusionRule, 'internal_ai_capability carries a hard exclusion rule');
  assert.equal(ai?.freshnessWindowDays, 120);
});

test('dimension CRUD round-trip', async () => {
  const created = await createDimensionDefinition({
    key: 'custom_dim',
    name: 'Custom Dim',
    dimensionType: 'timing',
    appliesTo: 'account',
    researchInstruction: 'look for things',
    weight: 0.5,
    halfLifeDays: 30,
    freshnessWindowDays: 10,
    isActive: true,
  });
  assert.match(created.id, /.+/);
  assert.equal(created.halfLifeDays, 30);
  assert.equal(created.idealValue, undefined);

  const updated = await updateDimensionDefinition(created.id, { weight: 0.9, isActive: false });
  assert.ok(Math.abs((updated?.weight ?? 0) - 0.9) < 1e-9);
  assert.equal(updated?.isActive, false);
  assert.equal(updated?.key, 'custom_dim', 'untouched fields survive');

  const activeOnly = await getDimensionDefinitions({ activeOnly: true });
  assert.ok(!activeOnly.some((d) => d.key === 'custom_dim'), 'inactive filtered out');

  assert.equal(await deleteDimensionDefinition(created.id), true);
  assert.equal(await deleteDimensionDefinition(created.id), false);
});
