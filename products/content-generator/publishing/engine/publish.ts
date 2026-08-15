import type { Pool } from "pg";
import { databaseFor, type Database } from "@content-automation/database";
import {
  createLogger,
  currentExecutionContext,
  observeOperation,
} from "@content-automation/observability";
import { emitProductEvent } from "@content-automation/platform/events/emit";
import { getChannel, updateChannelTokens } from "../channel-repository";
import { claimDuePost, recordFailure, recordPublished, recoverOrphaned } from "../post-repository";
import { getAdapter } from "../registry";
import { isR2Key, R2Media } from "../r2";
import { publishingRequest } from "../safe-network";
import { PublishError, type PostRecord } from "../types";

const log = createLogger("publishing.engine");

export interface PublishOutcome {
  post: PostRecord;
  status: "published" | "failed" | "requeued";
  resultUrl?: string;
  error?: string;
}

/**
 * Called after a post reaches a terminal-ish state so the owning record (the
 * content draft in Neo4j) reflects reality. Injected by the worker to keep the
 * engine store-agnostic and testable.
 */
export type ResultSink = (outcome: PublishOutcome) => Promise<void>;

class PublishAttemptFailure extends Error {
  constructor(
    readonly outcome: PublishOutcome,
    options: { cause: unknown },
  ) {
    super("Publishing attempt failed.", options);
    this.name = "PublishAttemptFailure";
  }
}

/**
 * One publish pass, ported from Relay's publish loop onto Cascade's claim
 * pattern: claim each due post with SKIP LOCKED, JIT-refresh the channel's
 * token, publish through the destination adapter, record the real result URL
 * or back off with the real error.
 */
export async function runPublishPass(
  pool: Pool,
  { batchSize = 10, media = null, onResult }: { batchSize?: number; media?: R2Media | null; onResult?: ResultSink } = {},
): Promise<{ published: number; failed: number; requeued: number; recovered: number }> {
  const recovered = await recoverOrphaned(pool);
  if (recovered > 0) {
    log.warn("publishing.orphaned_posts.recovered", { recovered_count: recovered });
  }

  let published = 0;
  let failed = 0;
  let requeued = 0;

  for (let i = 0; i < batchSize; i += 1) {
    const post = await databaseFor(pool).transaction((tx) => claimDuePost(tx as Database));
    if (!post) break;

    const outcome = await publishOne(pool, post, media);
    if (outcome.status === "published") published += 1;
    else if (outcome.status === "failed") failed += 1;
    else requeued += 1;

    if (outcome.status !== "requeued") {
      // Single emitter for post.published / post.failed (spec §7): the engine
      // sees every terminal outcome; the worker's sinkToDraft only sees
      // draft-linked successes.
      const organizationId = post.organizationId
        ?? currentExecutionContext()?.organizationId
        ?? null;
      if (organizationId) {
        emitProductEvent({
          organizationId,
          name: outcome.status === "published" ? "post.published" : "post.failed",
          refs: { postId: post.id, ...(post.draftId ? { draftId: post.draftId } : {}) },
          payload: {
            destination: post.destination,
            ...(outcome.resultUrl ? { resultUrl: outcome.resultUrl } : {}),
            ...(outcome.error ? { error: outcome.error } : {}),
          },
        });
      }
    }

    if (onResult && outcome.status !== "requeued") {
      await observeOperation(
        "publishing.result_sink",
        {
          requestId: post.requestId ?? post.id,
          parentExecutionId: post.parentExecutionId ?? undefined,
          organizationId: post.organizationId ?? undefined,
          actorId: post.createdBy ?? undefined,
          actorType: post.actorType,
          attributes: {
            "publishing.post.id": post.id,
            "publishing.destination": post.destination,
            "publishing.status": outcome.status,
          },
          workflow: {
            name: "publishing.result.persist",
            input: {
              postId: post.id,
              destination: post.destination,
              status: outcome.status,
              resultUrl: outcome.resultUrl ?? null,
            },
            processOutput: () => ({ persisted: true }),
          },
        },
        () => onResult(outcome),
      ).catch((error) => log.error("publishing.result_sink.failed", error, {
        post_id: post.id,
        destination: post.destination,
      }));
    }
  }

  return { published, failed, requeued, recovered };
}

async function publishOne(pool: Pool, post: PostRecord, media: R2Media | null): Promise<PublishOutcome> {
  try {
    return await observeOperation(
      "publishing.post.publish",
      {
        requestId: post.requestId ?? post.id,
        traceCarrier: { traceparent: post.traceparent ?? undefined },
        parentExecutionId: post.parentExecutionId ?? undefined,
        organizationId: post.organizationId ?? undefined,
        actorId: post.createdBy ?? undefined,
        actorType: post.actorType,
        jobId: post.id,
        attributes: {
          "publishing.post.id": post.id,
          "publishing.destination": post.destination,
          "publishing.attempt": post.attempts + 1,
          "publishing.has_media": Boolean(post.mediaKey),
        },
        workflow: {
          name: "publishing.post.publish",
          input: {
            postId: post.id,
            draftId: post.draftId,
            destination: post.destination,
            attempt: post.attempts + 1,
            hasMedia: Boolean(post.mediaKey),
          },
          processOutput: (output) => ({
            status: output.status,
            resultUrl: output.resultUrl ?? null,
            error: output.error ?? null,
          }),
        },
      },
      async () => {
        try {
          const adapter = getAdapter(post.destination);
          const channel = await getChannel(pool, post.channelId);
          if (!channel || channel.disabled) throw new PublishError(`Channel ${post.channelId} is missing or disabled`);
          if (adapter.requiresMedia && !post.mediaKey) {
            throw new PublishError(`${post.destination} requires media and this post has none`);
          }

          // Just-in-time token refresh, even if the heartbeat already ran.
          if (adapter.refreshable && adapter.refresh && channel.tokenExpiry && channel.tokenExpiry <= new Date(Date.now() + 60_000)) {
            const refreshed = await adapter.refresh(channel);
            await updateChannelTokens(pool, channel.id, {
              accessToken: refreshed.accessToken,
              refreshToken: refreshed.refreshToken,
              expiresAt: refreshed.expiresAt,
            });
            channel.credentials.access_token = refreshed.accessToken;
            if (refreshed.refreshToken) channel.credentials.refresh_token = refreshed.refreshToken;
          }

          let mediaUrl: string | undefined;
          let mediaBytes: (() => Promise<Buffer>) | undefined;
          if (post.mediaKey) {
            if (isR2Key(post.mediaKey)) {
              if (!media) throw new PublishError("Post references staged media but R2 is not configured");
              const key = post.mediaKey;
              if (adapter.mediaMode === "url") mediaUrl = media.publicUrlFor(key);
              else mediaBytes = () => media.get(key);
            } else {
              // Absolute URL media reference.
              mediaUrl = post.mediaKey;
              mediaBytes = async () => {
                const res = await publishingRequest(post.mediaKey as string, {}, {
                  maxResponseBytes: 25 * 1024 * 1024,
                  timeoutMs: 30_000,
                });
                if (!res.ok) throw new PublishError(`Fetching media failed: HTTP ${res.status}`);
                return Buffer.from(res.bytes);
              };
            }
          }

          const { url } = await adapter.publish({ post, channel, mediaUrl, mediaBytes });
          await recordPublished(pool, post.id, url);
          return { post, status: "published", resultUrl: url };
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          const status = await recordFailure(pool, post.id, post.attempts, message);
          const outcome: PublishOutcome = status === "failed"
            ? { post, status: "failed", error: message }
            : { post, status: "requeued", error: message };
          throw new PublishAttemptFailure(outcome, { cause });
        }
      },
    );
  } catch (error) {
    if (error instanceof PublishAttemptFailure) {
      log.warn("publishing.post.attempt_failed", {
        post_id: post.id,
        destination: post.destination,
        attempt: post.attempts + 1,
        terminal: error.outcome.status === "failed",
      });
      return error.outcome;
    }
    throw error;
  }
}
