process.env.PUBLISHING_SCHEMA = "publishing";

import assert from "node:assert/strict";
import test, { after } from "node:test";
import type { Pool } from "pg";
import type { ContentDraft } from "../domain/content";
import { upsertChannel } from "../publishing/channel-repository";
import { getPublishingPool, publishingSchemaName } from "../publishing/pool";
import { getPost } from "../publishing/post-repository";
import {
  ScheduleDraftError,
  buildDraftCopy,
  resolvePublishAt,
  scheduleDraftPost,
} from "../publishing/schedule-draft";

/** Reset migrated publishing data; table structure is owned by Drizzle. */
async function freshSchema(): Promise<Pool> {
  const pool = getPublishingPool();
  await pool.query(`TRUNCATE TABLE ${publishingSchemaName()}.posts, ${publishingSchemaName()}.channels CASCADE`);
  return pool;
}

const draft = (over: Partial<ContentDraft> = {}): ContentDraft => ({
  id: "draft-1",
  ideaId: "idea-1",
  title: "Durable queues",
  type: "blog_post",
  content: "Body of the post",
  status: "ready",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...over,
});

async function cmsChannel(pool: Pool, id = "chan-cms"): Promise<string> {
  await upsertChannel(pool, {
    id,
    destination: "cms",
    name: `CMS ${id}`,
    credentialKind: "api_key",
    credentials: { apiKey: "k" },
    extra: {},
  });
  return id;
}

test("buildDraftCopy shapes copy per destination exactly like the publish route did", () => {
  const d = draft({ content: "x".repeat(400) });
  const x = buildDraftCopy("x", d) as { text: string };
  assert.equal(x.text.length, 280);
  assert.ok(x.text.endsWith("…"));
  assert.deepEqual(buildDraftCopy("linkedin", d), { body: d.content });
  assert.deepEqual(buildDraftCopy("cms", d), { title: d.title, body: d.content, tags: [] });
  assert.deepEqual(buildDraftCopy("youtube", d), { title: d.title, description: d.content });
  assert.deepEqual(buildDraftCopy("instagram", d), { title: d.title, caption: d.content });
  assert.deepEqual(buildDraftCopy("webhook", d), { ...d });
  assert.deepEqual(buildDraftCopy("anything-else", d), { title: d.title, body: d.content });
});

test("resolvePublishAt mirrors the route's `when` semantics", () => {
  const before = Date.now();
  const immediate = resolvePublishAt(undefined).getTime();
  assert.ok(immediate >= before && immediate <= Date.now() + 1000);
  assert.equal(
    resolvePublishAt("2030-08-01T12:00:00.000Z").toISOString(),
    "2030-08-01T12:00:00.000Z",
  );
  assert.throws(
    () => resolvePublishAt("not-a-date"),
    (error: unknown) => error instanceof ScheduleDraftError && error.code === "INVALID_WHEN",
  );
  assert.throws(
    () => resolvePublishAt(new Date(Date.now() - 60_000).toISOString()),
    (error: unknown) => error instanceof ScheduleDraftError
      && error.code === "INVALID_WHEN"
      && error.message === "Schedule time must be in the future.",
  );
  // Empty string → immediate, exactly like the route treated "".
  assert.ok(resolvePublishAt("").getTime() >= before);
});

test("scheduleDraftPost validates destination, channel, and draft", async () => {
  const pool = await freshSchema();
  await assert.rejects(
    () => scheduleDraftPost(pool, { draftId: "d", destination: "fax", draft: draft() }),
    (e: unknown) => e instanceof ScheduleDraftError && e.code === "UNKNOWN_DESTINATION",
  );
  await assert.rejects(
    () =>
      scheduleDraftPost(pool, {
        draftId: "d",
        destination: "cms",
        channelId: "missing",
        draft: draft(),
      }),
    (e: unknown) => e instanceof ScheduleDraftError && e.code === "CHANNEL_NOT_FOUND",
  );
  const channelId = await cmsChannel(pool);
  await assert.rejects(
    () =>
      scheduleDraftPost(pool, {
        draftId: "d",
        destination: "webhook",
        channelId,
        draft: draft(),
      }),
    (e: unknown) => e instanceof ScheduleDraftError && e.code === "CHANNEL_MISMATCH",
  );
});

test("scheduleDraftPost resolves the only enabled channel when channelId is omitted", async () => {
  const pool = await freshSchema();
  const channelId = await cmsChannel(pool);
  const post = await scheduleDraftPost(pool, {
    draftId: "draft-1",
    destination: "cms",
    when: "2030-08-01T12:00:00.000Z",
    draft: draft(),
  });
  assert.equal(post.channelId, channelId);
  assert.equal(post.destination, "cms");
  assert.equal(post.publishAt.toISOString(), "2030-08-01T12:00:00.000Z");
  assert.deepEqual(post.copy, { title: "Durable queues", body: "Body of the post", tags: [] });
  assert.equal(post.idempotencyKey, `draft-1:cms:${channelId}`);
  assert.equal((await getPost(pool, post.id))?.status, "scheduled");
});

test("scheduleDraftPost is ambiguous with two channels and idempotent per draft/destination/channel", async () => {
  const pool = await freshSchema();
  await cmsChannel(pool, "chan-a");
  await cmsChannel(pool, "chan-b");
  await assert.rejects(
    () => scheduleDraftPost(pool, { draftId: "draft-1", destination: "cms", draft: draft() }),
    (e: unknown) => e instanceof ScheduleDraftError && e.code === "CHANNEL_AMBIGUOUS",
  );
  const first = await scheduleDraftPost(pool, {
    draftId: "draft-1",
    destination: "cms",
    channelId: "chan-a",
    draft: draft(),
  });
  const second = await scheduleDraftPost(pool, {
    draftId: "draft-1",
    destination: "cms",
    channelId: "chan-a",
    draft: draft(),
  });
  assert.equal(second.id, first.id); // ON CONFLICT (organization_id, idempotency_key) — post-repository.ts
});

after(async () => {
  const pool = getPublishingPool();
  await pool.query(`TRUNCATE TABLE ${publishingSchemaName()}.posts, ${publishingSchemaName()}.channels CASCADE`);
  await pool.end();
});
