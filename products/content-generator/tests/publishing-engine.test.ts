process.env.PUBLISHING_SCHEMA = "publishing";

import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after } from "node:test";
import type { Pool } from "pg";
import { runWithExecutionContext } from "@content-automation/observability";
import {
  drainProductEvents,
  setProductEventSinkForTests,
} from "@content-automation/platform/events/emit";
import type { ProductEventInsert } from "@content-automation/platform/events/repository";
import { cmsAdapter } from "../publishing/adapters/cms";
import { webhookAdapter } from "../publishing/adapters/webhook";
import {
  disconnectChannel,
  getChannel,
  listChannels,
  upsertChannel,
} from "../publishing/channel-repository";
import { runPublishPass, type PublishOutcome } from "../publishing/engine/publish";
import { getPublishingPool, publishingSchemaName } from "../publishing/pool";
import {
  BACKOFF_SECONDS,
  MAX_ATTEMPTS,
  ORPHAN_AFTER_SECONDS,
  claimDuePost,
  recordFailure,
  recoverOrphaned,
  retryPost,
  schedulePost,
} from "../publishing/post-repository";
import { registerAdapter } from "../publishing/registry";
import { ensurePublishingSchema } from "../publishing/schema";
import {
  PublishError,
  type ChannelRecord,
  type PostRecord,
  type PublishInput,
} from "../publishing/types";

/** Reset migrated publishing data. Table structure is owned by Drizzle. */
async function freshSchema(): Promise<Pool> {
  const pool = getPublishingPool();
  await pool.query(`TRUNCATE TABLE ${publishingSchemaName()}.posts, ${publishingSchemaName()}.channels CASCADE`);
  return pool;
}

async function legacyPublishingSchema(): Promise<Pool> {
  const pool = getPublishingPool();
  const schema = publishingSchemaName();
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`
    CREATE TABLE ${schema}.channels (
      id TEXT PRIMARY KEY,
      destination TEXT NOT NULL,
      name TEXT NOT NULL,
      credential_kind TEXT NOT NULL,
      credentials JSONB NOT NULL DEFAULT '{}',
      token_expiry TIMESTAMPTZ,
      extra JSONB NOT NULL DEFAULT '{}',
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE ${schema}.posts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      draft_id TEXT,
      destination TEXT NOT NULL,
      channel_id TEXT NOT NULL REFERENCES ${schema}.channels(id),
      copy JSONB NOT NULL DEFAULT '{}',
      media_key TEXT,
      publish_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ,
      claimed_at TIMESTAMPTZ,
      idempotency_key TEXT UNIQUE,
      result_url TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(
    `INSERT INTO ${schema}.channels
       (id, destination, name, credential_kind)
     VALUES ('legacy-channel', 'stub-ok', 'Legacy channel', 'none')`,
  );
  await pool.query(
    `INSERT INTO ${schema}.posts
       (id, destination, channel_id, publish_at)
     VALUES ('11111111-1111-4111-8111-111111111111', 'stub-ok', 'legacy-channel', now())`,
  );
  return pool;
}

after(async () => {
  await getPublishingPool().end();
});

const PAST = () => new Date(Date.now() - 5000);
const FUTURE = () => new Date(Date.now() + 3600_000);

async function makeChannel(
  pool: Pool,
  overrides: Partial<Parameters<typeof upsertChannel>[1]> = {},
): Promise<ChannelRecord> {
  return upsertChannel(pool, {
    id: "ch-1",
    destination: "stub-ok",
    name: "Stub channel",
    credentialKind: "none",
    credentials: {},
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// In-process HTTP stub for adapter unit tests (no network beyond loopback).
// ---------------------------------------------------------------------------

interface CapturedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: http.IncomingHttpHeaders;
  rawBody: string;
}

function startStubServer(
  respond: (req: CapturedRequest, res: http.ServerResponse) => void,
): Promise<{ baseUrl: string; requests: CapturedRequest[]; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const requests: CapturedRequest[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const captured: CapturedRequest = {
          method: req.method,
          url: req.url,
          headers: req.headers,
          rawBody: Buffer.concat(chunks).toString("utf8"),
        };
        requests.push(captured);
        respond(captured, res);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function fakePost(overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    id: "post-1",
    draftId: "draft-1",
    destination: "webhook",
    channelId: "ch-1",
    copy: { title: "Hello", body: "World" },
    mediaKey: null,
    publishAt: new Date(),
    status: "publishing",
    attempts: 0,
    nextAttemptAt: null,
    idempotencyKey: null,
    resultUrl: null,
    error: null,
    organizationId: null,
    createdBy: null,
    actorType: "system",
    requestId: null,
    parentExecutionId: null,
    traceId: null,
    traceparent: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function fakeChannel(overrides: Partial<ChannelRecord> = {}): ChannelRecord {
  return {
    id: "ch-1",
    destination: "webhook",
    name: "Fake channel",
    credentialKind: "signing_secret",
    credentials: {},
    tokenExpiry: null,
    extra: {},
    orgId: null,
    disabled: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

test("publishing tables are owned by the canonical migration", async () => {
  const pool = await freshSchema();
  // Running the DDL again (twice) must not throw or clobber anything.
  await ensurePublishingSchema(pool);
  await ensurePublishingSchema(pool);

  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
    [publishingSchemaName()],
  );
  assert.deepEqual(
    tables.rows.map((r: { table_name: string }) => r.table_name),
    ["channels", "posts"],
  );

  // And the tables are usable after the re-run.
  const channel = await makeChannel(pool);
  const post = await schedulePost(pool, {
    destination: channel.destination,
    channelId: channel.id,
    copy: { title: "t" },
  });
  assert.equal(post.status, "scheduled");
});

test.skip("legacy ownership is backfilled before the tenant foreign key is installed", async () => {
  const pool = await legacyPublishingSchema();
  const schema = publishingSchemaName();

  await assert.rejects(
    ensurePublishingSchema(pool),
    /Publishing ownership migration is required.*explicit legacy organization ID/,
  );

  await ensurePublishingSchema(pool, { legacyOrganizationId: "launch-org" });
  await ensurePublishingSchema(pool, { legacyOrganizationId: "launch-org" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.organization_id = 'launch-org'");
    const channels = await client.query(
      `SELECT id, org_id FROM ${schema}.channels ORDER BY id`,
    );
    const posts = await client.query(
      `SELECT channel_id, organization_id FROM ${schema}.posts ORDER BY id`,
    );
    assert.deepEqual(channels.rows, [{ id: "legacy-channel", org_id: "launch-org" }]);
    assert.deepEqual(posts.rows, [{
      channel_id: "legacy-channel",
      organization_id: "launch-org",
    }]);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }

  const constraint = await pool.query<{
    convalidated: boolean;
    condeferrable: boolean;
  }>(
    `SELECT convalidated, condeferrable
     FROM pg_constraint
     WHERE conname = 'posts_channel_organization_fkey'
       AND conrelid = $1::regclass`,
    [`${schema}.posts`],
  );
  assert.deepEqual(constraint.rows, [{
    convalidated: true,
    condeferrable: true,
  }]);
});

test.skip("legacy assignment refuses to overwrite a non-legacy tenant mismatch", async () => {
  const pool = await legacyPublishingSchema();
  const schema = publishingSchemaName();
  await pool.query(`ALTER TABLE ${schema}.channels ADD COLUMN org_id TEXT`);
  await pool.query(`ALTER TABLE ${schema}.posts ADD COLUMN organization_id TEXT`);
  await pool.query(`UPDATE ${schema}.channels SET org_id = 'tenant-a'`);
  await pool.query(`UPDATE ${schema}.posts SET organization_id = 'tenant-b'`);

  await assert.rejects(
    ensurePublishingSchema(pool, { legacyOrganizationId: "launch-org" }),
    /1 post\/channel ownership pair\(s\) are inconsistent/,
  );

  const channels = await pool.query(`SELECT org_id FROM ${schema}.channels`);
  const posts = await pool.query(`SELECT organization_id FROM ${schema}.posts`);
  assert.deepEqual(channels.rows, [{ org_id: "tenant-a" }]);
  assert.deepEqual(posts.rows, [{ organization_id: "tenant-b" }]);
});

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

test("channel upsert, list, and disconnect", async () => {
  const pool = await freshSchema();
  const created = await makeChannel(pool, {
    id: "cms-main",
    destination: "cms",
    name: "My CMS",
    credentialKind: "api_key",
    credentials: { base_url: "https://cms.example", api_key: "k1" },
    extra: { path: "/api/posts" },
  });
  assert.equal(created.id, "cms-main");
  assert.equal(created.disabled, false);

  // Upsert on the same id updates in place (no second row).
  const updated = await makeChannel(pool, {
    id: "cms-main",
    destination: "cms",
    name: "My CMS renamed",
    credentialKind: "api_key",
    credentials: { base_url: "https://cms.example", api_key: "k2" },
  });
  assert.equal(updated.name, "My CMS renamed");
  assert.equal(updated.credentials.api_key, "k2");
  const listed = await listChannels(pool);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, "My CMS renamed");

  // Disconnect hides the channel from the active list but keeps the row.
  assert.equal(await disconnectChannel(pool, "cms-main"), true);
  assert.deepEqual(await listChannels(pool), []);
  const stillThere = await getChannel(pool, "cms-main");
  assert.equal(stillThere?.disabled, true);

  // Re-upserting reconnects (disabled flips back to false).
  const reconnected = await makeChannel(pool, {
    id: "cms-main",
    destination: "cms",
    credentialKind: "api_key",
    credentials: { base_url: "https://cms.example", api_key: "k3" },
  });
  assert.equal(reconnected.disabled, false);
  assert.equal((await listChannels(pool)).length, 1);

  // Disconnecting an unknown channel reports false.
  assert.equal(await disconnectChannel(pool, "nope"), false);
});

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

test("schedulePost dedupes on idempotency key", async () => {
  const pool = await freshSchema();
  const channel = await makeChannel(pool);

  const first = await schedulePost(pool, {
    destination: channel.destination,
    channelId: channel.id,
    copy: { title: "one" },
    idempotencyKey: "draft-1:cms-main",
  });
  const second = await schedulePost(pool, {
    destination: channel.destination,
    channelId: channel.id,
    copy: { title: "two" },
    idempotencyKey: "draft-1:cms-main",
  });
  assert.equal(second.id, first.id);
  // The original row wins: the duplicate schedule does not overwrite the copy.
  assert.deepEqual(second.copy, { title: "one" });
  const count = await pool.query(`SELECT count(*)::int AS n FROM posts`);
  assert.equal(count.rows[0].n, 1);

  // Posts without a key never dedupe against each other.
  const a = await schedulePost(pool, { destination: channel.destination, channelId: channel.id, copy: {} });
  const b = await schedulePost(pool, { destination: channel.destination, channelId: channel.id, copy: {} });
  assert.notEqual(a.id, b.id);
});

// ---------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------

test("claimDuePost claims only due posts and parks them as publishing", async () => {
  const pool = await freshSchema();
  const channel = await makeChannel(pool);
  const due = await runWithExecutionContext({
    executionId: "publishing-parent-execution",
    requestId: "publishing-request",
    organizationId: "legacy",
    actorId: "publishing-user",
    actorType: "user",
  }, () => schedulePost(pool, {
      destination: channel.destination,
      channelId: channel.id,
      copy: { title: "due" },
      publishAt: PAST(),
    }));
  assert.equal(due.createdBy, "publishing-user");
  assert.equal(due.actorType, "user");
  assert.equal(due.requestId, "publishing-request");
  assert.equal(due.parentExecutionId, "publishing-parent-execution");
  await schedulePost(pool, {
    destination: channel.destination,
    channelId: channel.id,
    copy: { title: "later" },
    publishAt: FUTURE(),
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const first = await claimDuePost(client);
    assert.equal(first?.id, due.id);
    assert.equal(first?.requestId, "publishing-request");
    assert.equal(first?.createdBy, "publishing-user");
    // The claim itself parks the row (status -> 'publishing'), so this same
    // transaction cannot claim it again; the other post is an hour out.
    const second = await claimDuePost(client);
    assert.equal(second, null);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }

  // The rolled-back claim leaves the post schedulable again.
  const res = await pool.query(`SELECT status FROM posts WHERE id = $1`, [due.id]);
  assert.equal(res.rows[0].status, "scheduled");
});

test("two concurrent transactions never claim the same post", async () => {
  const pool = await freshSchema();
  const channel = await makeChannel(pool);
  for (let i = 0; i < 6; i++) {
    await schedulePost(pool, {
      destination: channel.destination,
      channelId: channel.id,
      copy: { n: i },
      publishAt: PAST(),
    });
  }

  const a = await pool.connect();
  const b = await pool.connect();
  try {
    await a.query("BEGIN");
    await b.query("BEGIN");
    const taken: string[] = [];
    for (let i = 0; i < 3; i++) {
      const ra = await claimDuePost(a);
      if (ra) taken.push(ra.id);
      const rb = await claimDuePost(b);
      if (rb) taken.push(rb.id);
    }
    // Without SKIP LOCKED, b's first claim would block on a's row lock instead
    // of taking the next row. Disjointness + no blocking is the proof.
    assert.equal(taken.length, 6);
    assert.equal(new Set(taken).size, 6);
    await a.query("ROLLBACK");
    await b.query("ROLLBACK");
  } finally {
    a.release();
    b.release();
  }
});

// ---------------------------------------------------------------------------
// Failure bookkeeping
// ---------------------------------------------------------------------------

test("recordFailure backs off through the ladder and fails at MAX_ATTEMPTS", async () => {
  const pool = await freshSchema();
  const channel = await makeChannel(pool);
  const post = await schedulePost(pool, {
    destination: channel.destination,
    channelId: channel.id,
    copy: {},
    publishAt: PAST(),
  });

  for (let attempts = 0; attempts < MAX_ATTEMPTS - 1; attempts++) {
    const status = await recordFailure(pool, post.id, attempts, `boom ${attempts}`);
    assert.equal(status, "scheduled");
    const row = (
      await pool.query(
        `SELECT status, attempts, error,
                EXTRACT(EPOCH FROM (next_attempt_at - now())) AS wait_seconds
         FROM posts WHERE id = $1`,
        [post.id],
      )
    ).rows[0];
    assert.equal(row.status, "scheduled");
    assert.equal(Number(row.attempts), attempts + 1);
    assert.equal(row.error, `boom ${attempts}`);
    const expected = BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length - 1)];
    const wait = Number(row.wait_seconds);
    assert.ok(
      Math.abs(wait - expected) < 10,
      `attempt ${attempts + 1}: expected ~${expected}s backoff, got ${wait}s`,
    );
  }

  const finalStatus = await recordFailure(pool, post.id, MAX_ATTEMPTS - 1, "last straw");
  assert.equal(finalStatus, "failed");
  const row = (
    await pool.query(`SELECT status, attempts, error, claimed_at FROM posts WHERE id = $1`, [post.id])
  ).rows[0];
  assert.equal(row.status, "failed");
  assert.equal(Number(row.attempts), MAX_ATTEMPTS);
  assert.equal(row.error, "last straw");
  assert.equal(row.claimed_at, null);
});

test("recoverOrphaned requeues only stale publishing rows", async () => {
  const pool = await freshSchema();
  const channel = await makeChannel(pool);
  const stale = await schedulePost(pool, {
    destination: channel.destination,
    channelId: channel.id,
    copy: {},
  });
  const fresh = await schedulePost(pool, {
    destination: channel.destination,
    channelId: channel.id,
    copy: {},
  });
  await pool.query(
    `UPDATE posts SET status = 'publishing', claimed_at = now() - ($2 || ' seconds')::interval WHERE id = $1`,
    [stale.id, String(ORPHAN_AFTER_SECONDS + 60)],
  );
  await pool.query(`UPDATE posts SET status = 'publishing', claimed_at = now() WHERE id = $1`, [fresh.id]);

  assert.equal(await recoverOrphaned(pool), 1);

  const staleRow = (await pool.query(`SELECT status, claimed_at FROM posts WHERE id = $1`, [stale.id])).rows[0];
  assert.equal(staleRow.status, "scheduled");
  assert.equal(staleRow.claimed_at, null);
  const freshRow = (await pool.query(`SELECT status FROM posts WHERE id = $1`, [fresh.id])).rows[0];
  assert.equal(freshRow.status, "publishing");

  // Nothing left to recover on a second pass.
  assert.equal(await recoverOrphaned(pool), 0);
});

test("retryPost resets failed and cancelled posts, refuses others", async () => {
  const pool = await freshSchema();
  const channel = await makeChannel(pool);
  const post = await schedulePost(pool, {
    destination: channel.destination,
    channelId: channel.id,
    copy: {},
  });
  await pool.query(
    `UPDATE posts SET status = 'failed', attempts = $2, error = 'dead', next_attempt_at = now() + interval '1 hour' WHERE id = $1`,
    [post.id, MAX_ATTEMPTS],
  );

  assert.equal(await retryPost(pool, post.id), true);
  const row = (
    await pool.query(
      `SELECT status, attempts, error, next_attempt_at, publish_at <= now() AS due FROM posts WHERE id = $1`,
      [post.id],
    )
  ).rows[0];
  assert.equal(row.status, "scheduled");
  assert.equal(Number(row.attempts), 0);
  assert.equal(row.error, null);
  assert.equal(row.next_attempt_at, null);
  assert.equal(row.due, true);

  // A scheduled post is not retryable...
  assert.equal(await retryPost(pool, post.id), false);
  // ...but a cancelled one is.
  await pool.query(`UPDATE posts SET status = 'cancelled' WHERE id = $1`, [post.id]);
  assert.equal(await retryPost(pool, post.id), true);
});

// ---------------------------------------------------------------------------
// Full pass through the engine (stub adapter, no network)
// ---------------------------------------------------------------------------

test("runPublishPass publishes due posts through the registered adapter", async () => {
  const pool = await freshSchema();
  const seen: PublishInput[] = [];
  registerAdapter({
    destination: "stub-ok",
    credentialKind: "none",
    refreshable: false,
    async publish(input) {
      seen.push(input);
      return { url: `https://stub.example/${input.post.id}` };
    },
  });

  const channel = await makeChannel(pool, { id: "stub-ch", destination: "stub-ok" });
  const p1 = await schedulePost(pool, {
    draftId: "draft-a",
    destination: "stub-ok",
    channelId: channel.id,
    copy: { title: "first" },
    publishAt: PAST(),
  });
  const p2 = await schedulePost(pool, {
    destination: "stub-ok",
    channelId: channel.id,
    copy: { title: "second" },
    publishAt: PAST(),
  });
  const future = await schedulePost(pool, {
    destination: "stub-ok",
    channelId: channel.id,
    copy: { title: "not yet" },
    publishAt: FUTURE(),
  });

  const outcomes: PublishOutcome[] = [];
  const result = await runPublishPass(pool, { onResult: async (o) => void outcomes.push(o) });
  assert.deepEqual(result, { published: 2, failed: 0, requeued: 0, recovered: 0 });

  assert.equal(seen.length, 2);
  assert.equal(seen[0].channel.id, "stub-ch");

  for (const id of [p1.id, p2.id]) {
    const row = (await pool.query(`SELECT status, result_url, claimed_at FROM posts WHERE id = $1`, [id])).rows[0];
    assert.equal(row.status, "published");
    assert.equal(row.result_url, `https://stub.example/${id}`);
    assert.equal(row.claimed_at, null);
  }
  const untouched = (await pool.query(`SELECT status FROM posts WHERE id = $1`, [future.id])).rows[0];
  assert.equal(untouched.status, "scheduled");

  assert.equal(outcomes.length, 2);
  assert.ok(outcomes.every((o) => o.status === "published"));
  assert.equal(outcomes.find((o) => o.post.id === p1.id)?.resultUrl, `https://stub.example/${p1.id}`);
});

test("runPublishPass failure path: requeue with backoff, then terminal failure", async () => {
  const pool = await freshSchema();
  registerAdapter({
    destination: "stub-fail",
    credentialKind: "none",
    refreshable: false,
    async publish() {
      throw new PublishError("platform says no");
    },
  });

  const channel = await makeChannel(pool, { id: "fail-ch", destination: "stub-fail" });
  const post = await schedulePost(pool, {
    destination: "stub-fail",
    channelId: channel.id,
    copy: {},
    publishAt: PAST(),
  });

  const outcomes: PublishOutcome[] = [];
  const first = await runPublishPass(pool, { onResult: async (o) => void outcomes.push(o) });
  assert.deepEqual(first, { published: 0, failed: 0, requeued: 1, recovered: 0 });
  // Requeued outcomes do not hit the result sink (the post is not terminal).
  assert.equal(outcomes.length, 0);
  let row = (
    await pool.query(
      `SELECT status, attempts, error, next_attempt_at > now() AS parked FROM posts WHERE id = $1`,
      [post.id],
    )
  ).rows[0];
  assert.equal(row.status, "scheduled");
  assert.equal(Number(row.attempts), 1);
  assert.equal(row.error, "platform says no");
  assert.equal(row.parked, true);

  // A second pass right away claims nothing: the post is backing off.
  const idle = await runPublishPass(pool);
  assert.deepEqual(idle, { published: 0, failed: 0, requeued: 0, recovered: 0 });

  // Exhaust the attempts budget and run again: terminal failure, sink notified.
  await pool.query(`UPDATE posts SET attempts = $2, next_attempt_at = NULL WHERE id = $1`, [
    post.id,
    MAX_ATTEMPTS - 1,
  ]);
  const second = await runPublishPass(pool, { onResult: async (o) => void outcomes.push(o) });
  assert.deepEqual(second, { published: 0, failed: 1, requeued: 0, recovered: 0 });
  row = (await pool.query(`SELECT status, attempts, error FROM posts WHERE id = $1`, [post.id])).rows[0];
  assert.equal(row.status, "failed");
  assert.equal(Number(row.attempts), MAX_ATTEMPTS);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].status, "failed");
  assert.equal(outcomes[0].error, "platform says no");
});

// ---------------------------------------------------------------------------
// Webhook adapter (in-process HTTP receiver)
// ---------------------------------------------------------------------------

test("webhook adapter binds timestamp, delivery ID, and raw body in its signature", async () => {
  assert.equal(webhookAdapter.destination, "webhook");
  assert.equal(webhookAdapter.credentialKind, "signing_secret");
  assert.equal(webhookAdapter.refreshable, false);
  assert.ok(!webhookAdapter.requiresMedia);

  const server = await startStubServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ url: "https://received.example/entries/42" }));
  });
  try {
    const secret = "s3cret";
    const channel = fakeChannel({ credentials: { url: `${server.baseUrl}/hook`, secret } });
    const post = fakePost({ copy: { title: "Hello", body: "World", tags: ["a", "b"] } });

    const { url } = await webhookAdapter.publish({
      post,
      channel,
      mediaUrl: "https://media.example/m.png",
    });
    assert.equal(url, "https://received.example/entries/42");

    assert.equal(server.requests.length, 1);
    const req = server.requests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/hook");
    assert.equal(req.headers["content-type"], "application/json");

    const timestamp = String(req.headers["x-publishing-timestamp"]);
    const deliveryId = String(req.headers["x-publishing-delivery-id"]);
    assert.equal(deliveryId, post.id);
    assert.ok(Math.abs(Math.floor(Date.now() / 1_000) - Number(timestamp)) < 5);
    const expected = `v1=${createHmac("sha256", secret)
      .update(`${timestamp}.${deliveryId}.${req.rawBody}`)
      .digest("hex")}`;
    assert.equal(req.headers["x-publishing-signature"], expected);

    const payload = JSON.parse(req.rawBody);
    assert.deepEqual(payload.post, {
      id: post.id,
      draftId: post.draftId,
      destination: "webhook",
      copy: { title: "Hello", body: "World", tags: ["a", "b"] },
      mediaUrl: "https://media.example/m.png",
    });
    assert.ok(!Number.isNaN(Date.parse(payload.sentAt)), "sentAt must be a parseable timestamp");
  } finally {
    await server.close();
  }
});

test("webhook adapter falls back to the webhook URL and surfaces non-2xx errors", async () => {
  const server = await startStubServer((req, res) => {
    if (req.url === "/empty") {
      res.writeHead(204);
      res.end();
    } else {
      res.writeHead(500);
      res.end("kaboom");
    }
  });
  try {
    const emptyChannel = fakeChannel({ credentials: { url: `${server.baseUrl}/empty`, secret: "s" } });
    const { url } = await webhookAdapter.publish({ post: fakePost(), channel: emptyChannel });
    assert.equal(url, `${server.baseUrl}/empty`);
    // No mediaUrl was passed, so the payload must omit the key entirely.
    assert.ok(!("mediaUrl" in JSON.parse(server.requests[0].rawBody).post));

    const failChannel = fakeChannel({ credentials: { url: `${server.baseUrl}/fail`, secret: "s" } });
    await assert.rejects(
      webhookAdapter.publish({ post: fakePost(), channel: failChannel }),
      (err: unknown) => {
        assert.ok(err instanceof PublishError);
        assert.match(err.message, /500/);
        assert.doesNotMatch(err.message, /kaboom/);
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// CMS adapter (in-process HTTP stub)
// ---------------------------------------------------------------------------

test("cms adapter posts the draft with bearer auth and accepts url|link|permalink", async () => {
  assert.equal(cmsAdapter.destination, "cms");
  assert.equal(cmsAdapter.credentialKind, "api_key");
  assert.equal(cmsAdapter.refreshable, false);
  assert.ok(!cmsAdapter.requiresMedia);

  const server = await startStubServer((req, res) => {
    res.writeHead(201, { "Content-Type": "application/json" });
    if (req.url === "/posts") {
      res.end(JSON.stringify({ link: "https://blog.example/hello-world" }));
    } else {
      res.end(JSON.stringify({ url: "https://blog.example/custom-path" }));
    }
  });
  try {
    const channel = fakeChannel({
      destination: "cms",
      credentialKind: "api_key",
      // Trailing slash on base_url must not produce a double slash.
      credentials: { base_url: `${server.baseUrl}/`, api_key: "key-123" },
    });
    const post = fakePost({
      destination: "cms",
      draftId: "draft-9",
      copy: { title: "Hello", body: "<p>World</p>", tags: ["x"] },
    });

    const { url } = await cmsAdapter.publish({ post, channel });
    assert.equal(url, "https://blog.example/hello-world");

    const req = server.requests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/posts");
    assert.equal(req.headers.authorization, "Bearer key-123");
    assert.equal(req.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(req.rawBody), {
      title: "Hello",
      body: "<p>World</p>",
      draftId: "draft-9",
      tags: ["x"],
    });

    // extra.path overrides the endpoint; tags are omitted when the copy has none.
    const customChannel = fakeChannel({
      destination: "cms",
      credentialKind: "api_key",
      credentials: { base_url: server.baseUrl, api_key: "key-123" },
      extra: { path: "/api/v2/entries" },
    });
    const bare = fakePost({ destination: "cms", draftId: null, copy: { title: "t", body: "b" } });
    const custom = await cmsAdapter.publish({ post: bare, channel: customChannel });
    assert.equal(custom.url, "https://blog.example/custom-path");
    const customReq = server.requests[1];
    assert.equal(customReq.url, "/api/v2/entries");
    assert.deepEqual(JSON.parse(customReq.rawBody), { title: "t", body: "b", draftId: null });
  } finally {
    await server.close();
  }
});

test("cms adapter rejects malformed responses without exposing response bodies", async () => {
  const server = await startStubServer((req, res) => {
    if (req.url === "/no-url") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: 123 }));
    } else if (req.url === "/not-json") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    } else {
      res.writeHead(401);
      res.end("unauthorized: bad key");
    }
  });
  try {
    const channelFor = (path: string) =>
      fakeChannel({
        destination: "cms",
        credentialKind: "api_key",
        credentials: { base_url: server.baseUrl, api_key: "k" },
        extra: { path },
      });
    const post = fakePost({ destination: "cms" });

    await assert.rejects(cmsAdapter.publish({ post, channel: channelFor("/no-url") }), (err: unknown) => {
      assert.ok(err instanceof PublishError);
      assert.match(err.message, /no valid URL/);
      assert.doesNotMatch(err.message, /\{"id":123\}/);
      return true;
    });

    await assert.rejects(cmsAdapter.publish({ post, channel: channelFor("/not-json") }), (err: unknown) => {
      assert.ok(err instanceof PublishError);
      assert.match(err.message, /not valid JSON/);
      assert.doesNotMatch(err.message, /OK/);
      return true;
    });

    await assert.rejects(cmsAdapter.publish({ post, channel: channelFor("/denied") }), (err: unknown) => {
      assert.ok(err instanceof PublishError);
      assert.match(err.message, /401/);
      assert.doesNotMatch(err.message, /unauthorized|bad key/);
      return true;
    });
  } finally {
    await server.close();
  }
});

test("schedulePost emits post.scheduled with post refs when an organization is resolvable", async () => {
  await freshSchema();
  // Org-scoped pool: the post row carries org-pub-events, which is the
  // organization the emitter reads first (the ambient context is the fallback).
  const pool = getPublishingPool("org-pub-events");
  const recorded: ProductEventInsert[] = [];
  setProductEventSinkForTests(async (event) => {
    recorded.push(event);
    return { id: randomUUID() };
  });
  try {
    const channel = await makeChannel(pool, { id: "sched-ch", destination: "events-sched" });
    const post = await runWithExecutionContext(
      { organizationId: "org-pub-events", actorId: "t", actorType: "service" },
      () => schedulePost(pool, {
        draftId: "draft-s",
        destination: "events-sched",
        channelId: channel.id,
        copy: { title: "hi" },
        publishAt: FUTURE(),
      }),
    );
    await drainProductEvents();
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].name, "post.scheduled");
    assert.equal(recorded[0].organizationId, "org-pub-events");
    assert.equal(recorded[0].postId, post.id);
    assert.equal(recorded[0].payload.draftId, "draft-s");
    assert.equal(recorded[0].payload.destination, "events-sched");
    assert.equal(recorded[0].payload.channelId, "sched-ch");
  } finally {
    setProductEventSinkForTests(null);
  }
});

test("runPublishPass emits post.published and post.failed for terminal outcomes", async () => {
  await freshSchema();
  const pool = getPublishingPool("org-pub-events");
  const recorded: ProductEventInsert[] = [];
  try {
    registerAdapter({
      destination: "events-ok", credentialKind: "none", refreshable: false,
      async publish(input) { return { url: `https://stub.example/${input.post.id}` }; },
    });
    registerAdapter({
      destination: "events-dead", credentialKind: "none", refreshable: false,
      async publish() { throw new PublishError("permanently rejected"); },
    });
    const okChannel = await makeChannel(pool, { id: "events-ok-ch", destination: "events-ok" });
    const deadChannel = await makeChannel(pool, { id: "events-dead-ch", destination: "events-dead" });
    // Scheduled before the recording sink is installed, so no post.scheduled
    // events pollute this test's recording.
    const good = await schedulePost(pool, {
      draftId: "draft-g", destination: "events-ok", channelId: okChannel.id,
      copy: {}, publishAt: PAST(),
    });
    const bad = await schedulePost(pool, {
      destination: "events-dead", channelId: deadChannel.id, copy: {}, publishAt: PAST(),
    });
    await pool.query(`UPDATE posts SET attempts = $2 WHERE id = $1`, [bad.id, MAX_ATTEMPTS - 1]);

    setProductEventSinkForTests(async (event) => {
      recorded.push(event);
      return { id: randomUUID() };
    });
    await runWithExecutionContext(
      { organizationId: "org-pub-events", actorId: "t", actorType: "service" },
      () => runPublishPass(pool),
    );
    await drainProductEvents();

    const published = recorded.find((event) => event.name === "post.published");
    const failed = recorded.find((event) => event.name === "post.failed");
    assert.ok(published, "expected a post.published event");
    assert.ok(failed, "expected a post.failed event");
    assert.equal(published.organizationId, "org-pub-events");
    assert.equal(published.postId, good.id);
    assert.equal(published.payload.draftId, "draft-g");
    assert.equal(published.payload.resultUrl, `https://stub.example/${good.id}`);
    assert.equal(failed.postId, bad.id);
    assert.equal(failed.payload.error, "permanently rejected");
    assert.equal(recorded.length, 2);
  } finally {
    setProductEventSinkForTests(null);
  }
});

test("ensurePublishingSchema is safe to run concurrently", async () => {
  const pool = await freshSchema();
  await Promise.all(Array.from({ length: 8 }, () => ensurePublishingSchema(pool)));
  const res = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1`,
    [publishingSchemaName()],
  );
  assert.ok(res.rows[0].n >= 2, "channels and posts exist after concurrent ensure");
});
