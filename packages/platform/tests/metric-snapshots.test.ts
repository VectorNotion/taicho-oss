import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { closeDriver } from "../data/graph";
import { closeJobPools, getJobAdminPool } from "../jobs/pool";
import {
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
    await getJobAdminPool().query(
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
  assert.deepEqual(await latestAggregates(TEST_ORG, `absent_${randomUUID()}`), {});
});

test("recordMetricSnapshot emits post.metrics.updated through the event spine", async () => {
  const postId = randomUUID();
  await recordMetricSnapshot({
    organizationId: TEST_ORG,
    postId,
    draftId: "draft-events",
    source: "plugin",
    metrics: { clicks: 1 },
  });
  // Emission is fire-and-forget; poll briefly for the ledger row.
  let row: unknown;
  for (let attempt = 0; attempt < 20 && !row; attempt += 1) {
    row = (
      await getJobAdminPool().query(
        `SELECT name FROM product_events
          WHERE organization_id = $1 AND name = 'post.metrics.updated' AND post_id = $2`,
        [TEST_ORG, postId],
      )
    ).rows[0];
    if (!row) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(row, "post.metrics.updated should land in product_events");
});
