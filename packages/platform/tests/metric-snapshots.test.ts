import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { closeDriver } from "../data/graph";
import { closeJobPools, getJobAdminPool, getJobPool } from "../jobs/pool";
import { drainProductEvents, setProductEventSinkForTests } from "../events/emit";
import {
  latestAggregateDetail,
  latestAggregates,
  mergeLatestSnapshots,
  recordMetricSnapshot,
} from "../metrics/snapshots";

// Mirrors the fixture pattern in resonance-jobs.test.ts: a random suffix
// keeps each run's rows isolated under RLS without a shared constant.
const suffix = randomUUID().replaceAll("-", "");
const TEST_ORG = `metrics_test_${suffix}`;

after(async () => {
  await getJobAdminPool()
    .query(`DELETE FROM post_metric_snapshots WHERE organization_id = $1`, [TEST_ORG])
    .catch(() => undefined);
  await getJobAdminPool()
    .query(`DELETE FROM product_events WHERE organization_id = $1`, [TEST_ORG])
    .catch(() => undefined);
  await closeJobPools();
  // recordMetricSnapshot's best-effort rollup opens a graph session; without
  // closing the driver the test process never exits.
  await closeDriver().catch(() => undefined);
});

test("recordMetricSnapshot persists an org-scoped, source-tagged snapshot row", async () => {
  const postId = randomUUID();
  const { id } = await recordMetricSnapshot({
    organizationId: TEST_ORG,
    postId,
    draftId: "draft-1",
    source: "human",
    metrics: { impressions: 2100, clicks: 34 },
  });
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

  const row = (
    await getJobPool(TEST_ORG).query(
      `SELECT organization_id, post_id, draft_id, source, metrics, captured_at
         FROM post_metric_snapshots WHERE id = $1`,
      [id],
    )
  ).rows[0];
  assert.equal(row.organization_id, TEST_ORG);
  assert.equal(row.post_id, postId);
  assert.equal(row.draft_id, "draft-1");
  assert.equal(row.source, "human");
  assert.deepEqual(row.metrics, { impressions: 2100, clicks: 34 });
  assert.ok(row.captured_at instanceof Date);
});

test("recordMetricSnapshot rejects invalid input before touching the database", async () => {
  const base = { organizationId: TEST_ORG, postId: "post-1", source: "human" as const };
  await assert.rejects(recordMetricSnapshot({ ...base, metrics: {} }), /at least one metric/i);
  await assert.rejects(recordMetricSnapshot({ ...base, metrics: { impressions: -1 } }), /non-negative/i);
  await assert.rejects(recordMetricSnapshot({ ...base, metrics: { impressions: Number.NaN } }), /non-negative/i);
  await assert.rejects(recordMetricSnapshot({ ...base, metrics: { "BAD KEY": 1 } }), /metric key/i);
  await assert.rejects(
    recordMetricSnapshot({ ...base, postId: "  ", metrics: { clicks: 1 } }),
    /post id/i,
  );
  await assert.rejects(
    recordMetricSnapshot({ ...base, source: "scraper" as never, metrics: { clicks: 1 } }),
    /metric source/i,
  );
});

test("merge rule: source priority per key, per post; totals summed across posts", () => {
  const t = (iso: string) => new Date(iso);
  const { totals, lastMeasuredAt } = mergeLatestSnapshots([
    // Post a: platform_api beats human on impressions; human alone knows saves.
    { postId: "a", source: "human", capturedAt: t("2026-07-01T10:00:00Z"), metrics: { impressions: 900, saves: 12 } },
    { postId: "a", source: "platform_api", capturedAt: t("2026-07-02T10:00:00Z"), metrics: { impressions: 1200, clicks: 40 } },
    // Post b: only human measured it.
    { postId: "b", source: "human", capturedAt: t("2026-07-03T10:00:00Z"), metrics: { impressions: 100, clicks: 5 } },
  ]);
  assert.deepEqual(totals, { impressions: 1300, clicks: 45, saves: 12 });
  assert.equal(lastMeasuredAt?.toISOString(), "2026-07-03T10:00:00.000Z");
});

test("merge rule: full priority chain and empty input", () => {
  const now = new Date();
  const row = (source: Parameters<typeof mergeLatestSnapshots>[0][number]["source"], clicks: number) =>
    ({ postId: "p", source, capturedAt: now, metrics: { clicks } });
  assert.deepEqual(
    mergeLatestSnapshots([row("human", 1), row("plugin", 2), row("link_redirect", 3), row("provider_webhook", 4)]).totals,
    { clicks: 4 },
  );
  assert.deepEqual(
    mergeLatestSnapshots([row("provider_webhook", 4), row("platform_api", 5)]).totals,
    { clicks: 5 },
  );
  assert.deepEqual(mergeLatestSnapshots([]), { totals: {}, lastMeasuredAt: null });
});

test("latestAggregates reads only the newest snapshot per (post, source)", async () => {
  const draftId = `draft_${randomUUID()}`;
  const postId = randomUUID();
  // Older platform_api snapshot must not contribute — cumulative totals, not deltas.
  await recordMetricSnapshot({ organizationId: TEST_ORG, postId, draftId, source: "platform_api", metrics: { impressions: 500 } });
  await recordMetricSnapshot({ organizationId: TEST_ORG, postId, draftId, source: "platform_api", metrics: { impressions: 800, clicks: 20 } });
  await recordMetricSnapshot({ organizationId: TEST_ORG, postId, draftId, source: "human", metrics: { impressions: 999, saves: 3 } });
  // A second post on the same draft sums in.
  await recordMetricSnapshot({ organizationId: TEST_ORG, postId: randomUUID(), draftId, source: "human", metrics: { impressions: 50 } });

  assert.deepEqual(await latestAggregates(TEST_ORG, draftId), {
    impressions: 850,
    clicks: 20,
    saves: 3,
  });
  const detail = await latestAggregateDetail(TEST_ORG, draftId);
  assert.deepEqual(detail.totals, { impressions: 850, clicks: 20, saves: 3 });
  assert.deepEqual(detail.sources, ["platform_api", "human"]);
  assert.ok(detail.lastMeasuredAt instanceof Date);
  assert.deepEqual(await latestAggregates(TEST_ORG, `absent_${randomUUID()}`), {});
  assert.deepEqual(await latestAggregateDetail(TEST_ORG, `absent_${randomUUID()}`), {
    totals: {},
    lastMeasuredAt: null,
    sources: [],
  });
});

test("recordMetricSnapshot emits public feedback and its internal knowledge projection", async () => {
  const postId = randomUUID();
  const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
  setProductEventSinkForTests(async (event) => {
    events.push({ name: event.name, payload: event.payload });
    return { id: randomUUID() };
  });
  try {
    await recordMetricSnapshot({
      organizationId: TEST_ORG,
      postId,
      draftId: "draft-events",
      source: "plugin",
      metrics: { clicks: 1 },
    });
    await drainProductEvents();
    assert.deepEqual(events.map(({ name }) => name).sort(), [
      "knowledge.publishing.metrics.recorded",
      "post.metrics.updated",
    ]);
    const knowledge = events.find(({ name }) => name === "knowledge.publishing.metrics.recorded");
    assert.deepEqual(knowledge?.payload.metrics, { clicks: 1 });
  } finally {
    setProductEventSinkForTests(null);
  }
});
