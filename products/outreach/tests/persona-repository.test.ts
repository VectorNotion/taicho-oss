process.env.FALKORDB_URL = process.env.FALKORDB_URL ?? 'redis://localhost:6380';
process.env.FALKORDB_GRAPH = process.env.FALKORDB_GRAPH ?? 'outreach_test';

import assert from 'node:assert/strict';
import nodeTest, { after, before } from 'node:test';
import {
  closeDriver,
  getSession,
  runWithGraphOrganization,
} from '@content-automation/platform/data/graph';
import {
  createPersona,
  deletePersona,
  getPersonaById,
  getPersonas,
  isPersonaReferenced,
  updatePersona,
} from '../data/persona-repository';

const ORGANIZATION_ID = `outreach-persona-test-organization-${process.pid}`;

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
  await closeDriver();
}));

test('persona CRUD round-trips all qualification fields', async () => {
  const created = await createPersona({
    name: 'Scaling Founder', description: 'Technical founder entering growth stage',
    targetTitles: ['Founder', 'CEO'], companySizeMin: 10, companySizeMax: 100,
    fundingStages: ['seed'], targetDomains: ['example.test'], signals: ['hiring'], isActive: true,
  });
  assert.ok(created);
  assert.match(created.id, /.+/);
  assert.equal(created.revision, 1);
  assert.deepEqual(created.targetTitles, ['Founder', 'CEO']);
  assert.equal((await getPersonaById(created.id))?.name, 'Scaling Founder');

  const updated = await updatePersona(created.id, { name: 'Growth Founder', isActive: false });
  assert.equal(updated?.name, 'Growth Founder');
  assert.equal(updated?.isActive, false);
  assert.equal(updated?.revision, 2);
  assert.deepEqual(updated?.targetTitles, ['Founder', 'CEO']);

  assert.equal(await deletePersona(created.id), true);
  assert.equal(await getPersonaById(created.id), null);
  assert.equal(await deletePersona(created.id), false);
});

test('active filtering excludes disabled personas and results are name-sorted', async () => {
  await createPersona({ name: 'Zulu', description: 'z', targetTitles: [], signals: [], isActive: true });
  await createPersona({ name: 'Alpha', description: 'a', targetTitles: [], signals: [], isActive: false });
  await createPersona({ name: 'Beta', description: 'b', targetTitles: [], signals: [], isActive: true });
  assert.deepEqual((await getPersonas()).map((persona) => persona.name), ['Alpha', 'Beta', 'Zulu']);
  assert.deepEqual((await getPersonas(true)).map((persona) => persona.name), ['Beta', 'Zulu']);
});

test('updating an unknown persona returns null', async () => {
  assert.equal(await updatePersona('missing', { name: 'No-op' }), null);
});

test('duplicate names are rejected case-insensitively', async () => {
  const first = await createPersona({ name: 'Durable Operator', description: 'first', targetTitles: ['COO'], signals: ['recovery'], isActive: true });
  assert.ok(first);
  assert.equal(await createPersona({ name: 'durable operator', description: 'duplicate', targetTitles: ['CRO'], signals: ['handoffs'], isActive: true }), null);
  assert.equal((await getPersonas()).filter((persona) => persona.name.toLowerCase() === 'durable operator').length, 1);
});

test('stale revisions cannot overwrite a newer persona', async () => {
  const created = await createPersona({ name: 'Concurrent Operator', description: 'initial', targetTitles: ['COO'], signals: ['recovery'], isActive: true });
  assert.ok(created);
  const firstUpdate = await updatePersona(created.id, { description: 'newer', expectedRevision: created.revision });
  assert.equal(firstUpdate?.revision, 2);
  assert.equal(await updatePersona(created.id, { description: 'stale overwrite', expectedRevision: created.revision }), null);
  assert.equal((await getPersonaById(created.id))?.description, 'newer');
});

test('saved qualification references are detectable before deletion', async () => {
  const created = await createPersona({ name: 'Referenced Operator', description: 'referenced', targetTitles: ['COO'], signals: ['recovery'], isActive: true });
  assert.ok(created);
  const session = await getSession();
  try {
    await session.run('CREATE (:LegacyQualification {id: randomUUID(), matchedPersonaId: $id})', { id: created.id });
  } finally {
    await session.close();
  }
  assert.equal(await isPersonaReferenced(created.id), true);
});
