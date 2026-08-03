import { createLogger } from "@content-automation/observability";
import {
  channelsInPublishing as channelsTable,
  databaseFor,
  postsInPublishing as postsTable,
} from "@content-automation/database";
import {
  initializeObservability,
  shutdownObservability,
} from "@content-automation/observability/node";
import { updateContentDraft } from "../data/content-repository";
import { and, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import "./adapters"; // registers all destination adapters
import {
  closePublishingPools,
  getPublishingAdminPool,
  getPublishingPool,
  publishingSchemaName,
} from "./pool";
import { runPublishPass, type PublishOutcome } from "./engine/publish";
import { runRefreshPass } from "./engine/refresh";
import { R2Media } from "./r2";
import { runWithGraphOrganization } from "@content-automation/platform/data/graph";

const intervalMs = Number(process.env.PUBLISHING_INTERVAL_MS ?? 30_000);
const batchSize = Number(process.env.PUBLISHING_BATCH_SIZE ?? 10);
const adminPool = getPublishingAdminPool();
const media = R2Media.fromEnv();
const log = createLogger("publishing.worker");

/**
 * Joined at the hip with the dashboard: when a draft-linked post finishes,
 * the engine writes the outcome straight onto the ContentDraft (Neo4j) —
 * no polling, no webhook layer, one truth.
 */
async function sinkToDraft(outcome: PublishOutcome): Promise<void> {
  if (!outcome.post.draftId) return;
  if (!outcome.post.organizationId) {
    throw new Error("A publishing result cannot update a draft without an organization.");
  }
  if (outcome.status === "published" && outcome.resultUrl) {
    await runWithGraphOrganization(outcome.post.organizationId, () =>
      updateContentDraft(outcome.post.draftId!, {
        status: "published",
        publishedUrl: outcome.resultUrl!,
      }),
    );
  }
  // Failures stay visible on the posts record and surface in the drafts UI;
  // the draft itself remains 'ready' so it can be retried.
}

let running = true;
function shutdown(signal: string) {
  log.info("worker.shutdown.requested", { signal });
  running = false;
}

async function main() {
  await initializeObservability({ serviceName: "taicho-publishing-worker" });
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  log.info("worker.started", {
    interval_ms: intervalMs,
    batch_size: batchSize,
    database_schema: publishingSchemaName(),
    media_storage_enabled: Boolean(media),
  });

  while (running) {
    try {
      const adminDb = databaseFor(adminPool);
      const [postOrganizations, channelOrganizations] = await Promise.all([
        adminDb.selectDistinct({ organizationId: postsTable.organization_id })
          .from(postsTable)
          .where(and(
            isNotNull(postsTable.organization_id),
            or(
              and(
                eq(postsTable.status, "scheduled"),
                lte(postsTable.publish_at, sql`now()`),
                or(isNull(postsTable.next_attempt_at), lte(postsTable.next_attempt_at, sql`now()`)),
              ),
              and(
                eq(postsTable.status, "publishing"),
                lte(postsTable.claimed_at, sql`now() - interval '10 minutes'`),
              ),
            ),
          )),
        adminDb.selectDistinct({ organizationId: channelsTable.org_id })
          .from(channelsTable)
          .where(and(
            isNotNull(channelsTable.org_id),
            eq(channelsTable.disabled, false),
            isNotNull(channelsTable.token_expiry),
            lte(channelsTable.token_expiry, sql`now() + interval '10 minutes'`),
          )),
      ]);
      const organizations = new Set([
        ...postOrganizations.map(({ organizationId }) => organizationId),
        ...channelOrganizations.map(({ organizationId }) => organizationId),
      ]);
      for (const organizationId of organizations) {
        const pool = getPublishingPool(organizationId);
        const refreshed = await runRefreshPass(pool);
        if (refreshed.refreshed + refreshed.failed > 0) {
          log.info("worker.tokens.processed", { ...refreshed });
        }
        const result = await runPublishPass(pool, { batchSize, media, onResult: sinkToDraft });
        if (result.published + result.failed + result.requeued > 0) {
          log.info("worker.posts.processed", { ...result });
        }
      }
    } catch (err) {
      log.error("worker.pass.failed", err);
    }
    if (running) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  await closePublishingPools();
  await shutdownObservability();
}

main().catch((err) => {
  log.error("worker.fatal", err);
  process.exit(1);
});
