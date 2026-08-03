import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { closeDriver, getSession, runWithGraphOrganization } from "../data/graph";
import { closeJobPools, getJobAdminPool } from "../jobs/pool";
import { recordMetricSnapshot } from "../metrics/snapshots";

const suffix = randomUUID().replaceAll("-", "");
const TEST_ORG = `metrics_rollup_${suffix}`;
const gated = { skip: process.env.PLATFORM_DB_TESTS !== "1" } as const;

after(async () => {
  if (process.env.PLATFORM_DB_TESTS === "1") {
    await runWithGraphOrganization(TEST_ORG, async () => {
      const session = await getSession();
      try {
        await session.run(`MATCH (d:ContentDraft {id: $id}) DETACH DELETE d`, {
          id: `draft_${suffix}`,
        });
      } finally {
        await session.close();
      }
    }).catch(() => undefined);
    await closeDriver().catch(() => undefined);
  }
  await getJobAdminPool()
    .query(`DELETE FROM post_metric_snapshots WHERE organization_id = $1`, [TEST_ORG])
    .catch(() => undefined);
  await closeJobPools();
});

test("recordMetricSnapshot rolls aggregates up onto the ContentDraft node", gated, async () => {
  const draftId = `draft_${suffix}`;
  await runWithGraphOrganization(TEST_ORG, async () => {
    const session = await getSession();
    try {
      await session.run(
        `CREATE (:ContentDraft {id: $id, title: "Rollup probe", status: "published"})`,
        { id: draftId },
      );
    } finally {
      await session.close();
    }
  });

  await recordMetricSnapshot({
    organizationId: TEST_ORG,
    postId: randomUUID(),
    draftId,
    source: "human",
    metrics: { impressions: 2100, clicks: 34 },
  });

  const record = await runWithGraphOrganization(TEST_ORG, async () => {
    const session = await getSession();
    try {
      const result = await session.run(
        `MATCH (d:ContentDraft {id: $id})
         RETURN d.metricsImpressions AS impressions,
                d.metricsClicks AS clicks,
                d.metricsEngagements AS engagements,
                d.metricsLastMeasuredAt AS lastMeasuredAt`,
        { id: draftId },
      );
      return result.records[0];
    } finally {
      await session.close();
    }
  });

  assert.equal(Number(record.get("impressions")), 2100);
  assert.equal(Number(record.get("clicks")), 34);
  // engagements was never reported: v1 writes only measured keys, no fake zeros.
  assert.equal(record.get("engagements"), null);
  assert.ok(record.get("lastMeasuredAt"));
});
