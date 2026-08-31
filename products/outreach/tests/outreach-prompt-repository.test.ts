process.env.FALKORDB_URL = process.env.FALKORDB_URL ?? 'redis://localhost:6380';
process.env.FALKORDB_GRAPH = process.env.FALKORDB_GRAPH ?? 'outreach_test';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import {
  closeDriver,
  getSession,
  runWithGraphOrganization,
} from '@content-automation/platform/data/graph';
import {
  getOutreachPromptWorkspace,
  publishOutreachPromptDraft,
  saveOutreachPromptDraft,
} from '../data/outreach-prompt-repository';
import { DEFAULT_OUTREACH_PROMPT_CONTENT } from '../domain/outreach-prompts';

const suffix = randomUUID().replaceAll('-', '');
const organizationA = `outreach-prompts-a-${suffix}`;
const organizationB = `outreach-prompts-b-${suffix}`;

function inOrganization<T>(organizationId: string, callback: () => T): T {
  return runWithGraphOrganization(organizationId, callback);
}

async function clearOrganization(organizationId: string): Promise<void> {
  await inOrganization(organizationId, async () => {
    const session = await getSession();
    try {
      await session.run('MATCH (n) DETACH DELETE n');
    } finally {
      await session.close();
    }
  });
}

after(async () => {
  await Promise.all([
    clearOrganization(organizationA),
    clearOrganization(organizationB),
  ]);
  await closeDriver();
});

test('published outreach prompts are versioned and isolated by tenant graph', async () => {
  const initialA = await inOrganization(organizationA, getOutreachPromptWorkspace);
  assert.equal(initialA.active.version, 1);
  assert.equal(initialA.draft, null);

  const changed = structuredClone(DEFAULT_OUTREACH_PROMPT_CONTENT);
  changed.systemInstructions = 'Use the workspace-specific north-star narrative.';
  const drafted = await inOrganization(
    organizationA,
    () => saveOutreachPromptDraft(changed, 'member-a', {
      activeVersion: initialA.active.version,
      draftContentHash: null,
    }),
  );
  assert.ok(drafted);
  assert.equal(drafted.active.version, 1);
  assert.equal(drafted.draft?.content.systemInstructions, changed.systemInstructions);

  const published = await inOrganization(
    organizationA,
    () => publishOutreachPromptDraft('member-a', {
      activeVersion: drafted.active.version,
      draftContentHash: drafted.draft!.contentHash,
    }),
  );
  assert.ok(published);
  assert.equal(published.active.version, 2);
  assert.equal(published.active.content.systemInstructions, changed.systemInstructions);
  assert.equal(published.draft, null);
  assert.deepEqual(published.versions.map(({ version }) => version), [2, 1]);

  const initialB = await inOrganization(organizationB, getOutreachPromptWorkspace);
  assert.equal(initialB.active.version, 1);
  assert.equal(
    initialB.active.content.systemInstructions,
    DEFAULT_OUTREACH_PROMPT_CONTENT.systemInstructions,
  );

  await inOrganization(organizationA, async () => {
    const session = await getSession();
    try {
      const result = await session.run(
        `MATCH (:OutreachPrompt {key: $key})-[:HAS_VERSION]->(v:OutreachPromptVersion)
         RETURN v.version AS version, v.contentJson AS contentJson
         ORDER BY v.version`,
        { key: initialA.key },
      );
      assert.equal(result.records.length, 2);
      assert.equal(
        JSON.parse(result.records[0].get('contentJson')).systemInstructions,
        DEFAULT_OUTREACH_PROMPT_CONTENT.systemInstructions,
      );
      assert.equal(
        JSON.parse(result.records[1].get('contentJson')).systemInstructions,
        changed.systemInstructions,
      );
    } finally {
      await session.close();
    }
  });
});

test('concurrent publishing reports one durable winner and stale draft saves cannot silently rebase', async () => {
  const workspace = await inOrganization(organizationB, getOutreachPromptWorkspace);
  const changed = structuredClone(DEFAULT_OUTREACH_PROMPT_CONTENT);
  changed.mediumTemplates.email += '\n\nDurable prompt publication.';
  const drafted = await inOrganization(
    organizationB,
    () => saveOutreachPromptDraft(changed, 'member-b', {
      activeVersion: workspace.active.version,
      draftContentHash: null,
    }),
  );
  assert.ok(drafted?.draft);

  const expected = {
    activeVersion: drafted.active.version,
    draftContentHash: drafted.draft.contentHash,
  };
  const results = await Promise.all([
    inOrganization(organizationB, () => publishOutreachPromptDraft('member-b-1', expected)),
    inOrganization(organizationB, () => publishOutreachPromptDraft('member-b-2', expected)),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  const current = await inOrganization(organizationB, getOutreachPromptWorkspace);
  assert.equal(current.active.version, 2);
  assert.equal(current.versions.length, 2);
  assert.equal(current.draft, null);

  assert.equal(await inOrganization(
    organizationB,
    () => saveOutreachPromptDraft(DEFAULT_OUTREACH_PROMPT_CONTENT, 'stale-member', {
      activeVersion: workspace.active.version,
      draftContentHash: null,
    }),
  ), null);
  const unchanged = await inOrganization(organizationB, getOutreachPromptWorkspace);
  assert.equal(unchanged.active.version, 2);
  assert.equal(unchanged.draft, null);
});
