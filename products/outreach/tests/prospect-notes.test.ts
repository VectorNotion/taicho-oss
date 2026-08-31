process.env.FALKORDB_URL = process.env.FALKORDB_URL ?? 'redis://localhost:6380';
process.env.FALKORDB_GRAPH = process.env.FALKORDB_GRAPH ?? 'outreach_test';

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import {
  closeDriver,
  getSession,
  runWithGraphOrganization,
} from '@content-automation/platform/data/graph';
import {
  drainProductEvents,
  setProductEventSinkForTests,
} from '@content-automation/platform/events/emit';
import {
  createProspect,
  createProspectNote,
  deleteProspectNote,
  getProspectNoteById,
  getProspectNotes,
  updateProspectNote,
} from '../data/prospect-repository';

const ORGANIZATION_ID = `prospect-notes-${process.pid}`;

async function clearGraph() {
  const session = await getSession();
  try {
    await session.run('MATCH (node) DETACH DELETE node');
  } finally {
    await session.close();
  }
}

before(() => runWithGraphOrganization(ORGANIZATION_ID, async () => {
  setProductEventSinkForTests(async () => ({ id: 'prospect-notes-event' }));
  await clearGraph();
}));

after(async () => {
  await drainProductEvents();
  setProductEventSinkForTests(null);
  await runWithGraphOrganization(ORGANIZATION_ID, clearGraph);
  await closeDriver();
});

test('prospect notes preserve authorship and reject a stale revision without overwriting', async () => {
  await runWithGraphOrganization(ORGANIZATION_ID, async () => {
    const prospect = await createProspect({ name: 'Mira Vale', source: 'manual' });
    const created = await createProspectNote(prospect.id, '<p>Initial context</p>', {
      createdBy: 'owner-user',
    });

    assert.equal(created.revision, 1);
    assert.equal(created.createdBy, 'owner-user');
    assert.equal(created.updatedBy, 'owner-user');

    const updated = await updateProspectNote(created.id, {
      content: '<p>Current context</p>',
      expectedRevision: 1,
      updatedBy: 'editor-user',
    });
    assert.equal(updated?.note.revision, 2);
    assert.equal(updated?.note.content, '<p>Current context</p>');
    assert.equal(updated?.note.updatedBy, 'editor-user');
    assert.equal(updated?.prospectId, prospect.id);

    const stale = await updateProspectNote(created.id, {
      content: '<p>Stale overwrite</p>',
      expectedRevision: 1,
      updatedBy: 'stale-user',
    });
    assert.equal(stale, null);

    const stored = await getProspectNoteById(created.id);
    assert.equal(stored?.note.content, '<p>Current context</p>');
    assert.equal(stored?.note.revision, 2);
    assert.equal((await getProspectNotes(prospect.id)).length, 1);
    assert.equal(await deleteProspectNote(created.id), true);
    assert.equal(await getProspectNoteById(created.id), null);
  });
});
