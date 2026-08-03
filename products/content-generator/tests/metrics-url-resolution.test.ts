process.env.PUBLISHING_SCHEMA = "publishing";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { upsertChannel } from "../publishing/channel-repository";
import { closePublishingPools, getPublishingPool, publishingSchemaName } from "../publishing/pool";
import { getPostByResultUrl, recordPublished, schedulePost } from "../publishing/post-repository";

after(async () => {
  const pool = getPublishingPool();
  await pool.query(`TRUNCATE TABLE ${publishingSchemaName()}.posts, ${publishingSchemaName()}.channels CASCADE`);
  await closePublishingPools();
});

test("getPostByResultUrl resolves a published post by its live URL", async () => {
  const pool = getPublishingPool();
  await pool.query(`TRUNCATE TABLE ${publishingSchemaName()}.posts, ${publishingSchemaName()}.channels CASCADE`);
  await upsertChannel(pool, {
    id: "chan-metrics",
    destination: "cms",
    name: "Metrics test CMS",
    credentialKind: "api_key",
    credentials: { apiKey: "k", baseUrl: "https://example.com" },
  });
  const post = await schedulePost(pool, {
    draftId: `draft_${randomUUID()}`,
    destination: "cms",
    channelId: "chan-metrics",
    copy: { title: "T" },
  });
  const url = `https://example.com/posts/${post.id}`;
  await recordPublished(pool, post.id, url);

  const found = await getPostByResultUrl(pool, url);
  assert.equal(found?.id, post.id);
  assert.equal(found?.draftId, post.draftId);
  assert.equal(await getPostByResultUrl(pool, "https://example.com/absent"), null);
});
