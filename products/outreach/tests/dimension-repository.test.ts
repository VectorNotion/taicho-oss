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
const ATOMIC_INVARIANT_ORGANIZATION_ID = `outreach-dimension-atomic-${process.pid}`;

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
  await runWithGraphOrganization(ATOMIC_INVARIANT_ORGANIZATION_ID, clearGraph);
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
  assert.equal(created.revision, 1);
  assert.equal(created.halfLifeDays, 30);
  assert.equal(created.idealValue, undefined);

  const updated = await updateDimensionDefinition(created.id, {
    expectedRevision: created.revision,
    weight: 0.9,
    isActive: false,
  });
  assert.ok(Math.abs((updated?.weight ?? 0) - 0.9) < 1e-9);
  assert.equal(updated?.isActive, false);
  assert.equal(updated?.key, 'custom_dim', 'untouched fields survive');
  assert.equal(updated?.revision, 2);

  const stale = await updateDimensionDefinition(created.id, {
    expectedRevision: created.revision,
    weight: 0.1,
  });
  assert.equal(stale, null, 'stale edits do not overwrite a newer revision');

  const activeOnly = await getDimensionDefinitions({ activeOnly: true });
  assert.ok(!activeOnly.some((d) => d.key === 'custom_dim'), 'inactive filtered out');

  assert.equal(await deleteDimensionDefinition(created.id), true);
  assert.equal(await deleteDimensionDefinition(created.id), false);
});

nodeTest('simultaneous final-active updates preserve one enabled dimension atomically', async () => {
  await runWithGraphOrganization(ATOMIC_INVARIANT_ORGANIZATION_ID, async () => {
    await clearGraph();
    const first = await createDimensionDefinition({
      key: 'first_timing',
      name: 'First timing',
      dimensionType: 'timing',
      appliesTo: 'account',
      researchInstruction: 'first',
      weight: 0.5,
      halfLifeDays: 30,
      freshnessWindowDays: 10,
      isActive: true,
    });
    const second = await createDimensionDefinition({
      key: 'second_timing',
      name: 'Second timing',
      dimensionType: 'timing',
      appliesTo: 'account',
      researchInstruction: 'second',
      weight: 0.5,
      halfLifeDays: 30,
      freshnessWindowDays: 10,
      isActive: true,
    });

    const updates = await Promise.all([first, second].map((dimension) =>
      updateDimensionDefinition(
        dimension.id,
        { expectedRevision: dimension.revision, isActive: false },
        { requireAnotherActiveInCurrentGroup: true },
      )
    ));
    assert.equal(updates.filter(Boolean).length, 1, 'only one deactivation commits');
    assert.equal(updates.filter((result) => result === null).length, 1, 'the final deactivation is rejected');

    const all = await getDimensionDefinitions();
    assert.equal(all.filter((dimension) => dimension.isActive).length, 1);
    const active = all.find((dimension) => dimension.isActive)!;
    const inactive = all.find((dimension) => !dimension.isActive)!;
    assert.equal(await deleteDimensionDefinition(active.id, {
      expectedRevision: active.revision,
      requireAnotherActiveInCurrentGroup: true,
    }), false, 'the final active definition cannot be deleted');
    assert.equal(await deleteDimensionDefinition(inactive.id, {
      expectedRevision: inactive.revision,
      requireAnotherActiveInCurrentGroup: true,
    }), true, 'an inactive peer remains safely deletable');
  });
});
