import type { Pool, PoolClient } from "pg";
import {
  databaseFor,
  type Database,
  postsInPublishing as postsTable,
} from "@content-automation/database";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  activeTraceIds,
  activeTraceCarrier,
  currentExecutionContext,
} from "@content-automation/observability";
import { emitProductEvent, recordProductEvent } from "@content-automation/platform/events/emit";
import { PUBLISHING_POST_KNOWLEDGE_EVENT } from "./knowledge-events";
import { recordPublishingCalendarChange } from "./calendar-events";
import type { PostRecord, PostStatus } from "./types";

/** Backoff after failed attempts (seconds): 1m, 5m, 30m, 2h. Ported from Relay. */
export const BACKOFF_SECONDS = [60, 300, 1800, 7200];
export const MAX_ATTEMPTS = 5;
/** A 'publishing' row claimed longer than this is considered orphaned (crashed worker). */
export const ORPHAN_AFTER_SECONDS = 600;

function rowToPost(row: Record<string, unknown>): PostRecord {
  return {
    id: row.id as string,
    draftId: (row.draft_id as string | null) ?? null,
    destination: row.destination as string,
    channelId: row.channel_id as string,
    copy: (row.copy ?? {}) as Record<string, unknown>,
    mediaKey: (row.media_key as string | null) ?? null,
    publishAt: new Date(row.publish_at as string | Date),
    status: row.status as PostStatus,
    attempts: Number(row.attempts ?? 0),
    nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at as string | Date) : null,
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    resultUrl: (row.result_url as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    createdAt: new Date(row.created_at as string | Date),
    organizationId: (row.organization_id as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    actorType: (row.actor_type as PostRecord["actorType"] | null) ?? "system",
    requestId: (row.request_id as string | null) ?? null,
    parentExecutionId: (row.parent_execution_id as string | null) ?? null,
    traceId: (row.trace_id as string | null) ?? null,
    traceparent: (row.traceparent as string | null) ?? null,
  };
}

export async function schedulePost(
  pool: Pool,
  input: {
    draftId?: string | null;
    destination: string;
    channelId: string;
    copy: Record<string, unknown>;
    mediaKey?: string | null;
    publishAt?: Date;
    idempotencyKey?: string | null;
  },
): Promise<PostRecord> {
  const execution = currentExecutionContext();
  const trace = activeTraceIds();
  const carrier = activeTraceCarrier();
  const [row] = await databaseFor(pool)
    .insert(postsTable)
    .values({
      draft_id: input.draftId ?? null,
      destination: input.destination,
      channel_id: input.channelId,
      copy: input.copy,
      media_key: input.mediaKey ?? null,
      publish_at: (input.publishAt ?? new Date()).toISOString(),
      idempotency_key: input.idempotencyKey ?? null,
      created_by: execution?.actorId ?? null,
      actor_type: execution?.actorType ?? "system",
      request_id: execution?.requestId ?? null,
      parent_execution_id: execution?.executionId ?? null,
      trace_id: trace.traceId ?? null,
      traceparent: carrier.traceparent ?? null,
    })
    .onConflictDoUpdate({
      target: [postsTable.organization_id, postsTable.idempotency_key],
      set: { idempotency_key: sql`excluded.idempotency_key` },
    })
    .returning({ ...getTableColumns(postsTable), inserted: sql<boolean>`xmax = 0` });
  const post = rowToPost(row);
  if (row.inserted) {
    // Organization comes off the row (RLS default on org-scoped pools) or the
    // ambient execution context; without either, skip — emitters never throw.
    const organizationId = post.organizationId ?? execution?.organizationId ?? null;
    if (organizationId) {
      emitProductEvent({
        organizationId,
        name: "post.scheduled",
        refs: { postId: post.id, ...(post.draftId ? { draftId: post.draftId } : {}) },
        payload: {
          destination: post.destination,
          channelId: post.channelId,
          publishAt: post.publishAt.toISOString(),
        },
      });
    }
  }
  const organizationId = post.organizationId ?? execution?.organizationId ?? null;
  if (organizationId) {
    // Awaited and replay-safe: if a response is retried after this append
    // fails, the upserted post is returned and the same event is attempted.
    await recordProductEvent({
      organizationId,
      name: PUBLISHING_POST_KNOWLEDGE_EVENT,
      origin: "internal",
      idempotencyKey: `${post.id}:scheduled`,
      refs: { postId: post.id, ...(post.draftId ? { draftId: post.draftId } : {}) },
      payload: {
        postId: post.id,
        draftId: post.draftId,
        destination: post.destination,
        channelId: post.channelId,
        status: "scheduled",
        copy: post.copy,
        publishAt: post.publishAt.toISOString(),
        occurredAt: new Date().toISOString(),
      },
    });
  }
  await recordPublishingCalendarChange(post);
  return post;
}

/** Atomically claim one due post (scheduled → publishing). Returns null when nothing is due. */
export async function claimDuePost(source: PoolClient | Database): Promise<PostRecord | null> {
  const db = "$count" in source ? source : databaseFor(source);
  const now = new Date().toISOString();
  const [row] = await db
    .select()
    .from(postsTable)
    .where(and(
      eq(postsTable.status, 'scheduled'),
      lte(postsTable.publish_at, now),
      or(isNull(postsTable.next_attempt_at), lte(postsTable.next_attempt_at, now)),
    ))
    .orderBy(asc(postsTable.publish_at))
    .limit(1)
    .for('update', { skipLocked: true });
  if (!row) return null;
  const [claimed] = await db
    .update(postsTable)
    .set({
      status: 'publishing',
      claimed_at: now,
      request_id: sql`coalesce(${postsTable.request_id}, ${postsTable.id}::text)`,
    })
    .where(eq(postsTable.id, row.id))
    .returning();
  if (!claimed) return null;
  return rowToPost(claimed);
}

export async function recordPublished(pool: Pool, id: string, resultUrl: string): Promise<void> {
  const [row] = await databaseFor(pool)
    .update(postsTable)
    .set({
      status: 'published',
      attempts: sql`${postsTable.attempts} + 1`,
      result_url: resultUrl,
      error: null,
      claimed_at: null,
    })
    .where(eq(postsTable.id, id))
    .returning();
  if (row) await recordPublishingCalendarChange(rowToPost(row));
}

/** Record a failed attempt: back off and requeue, or mark failed after MAX_ATTEMPTS. */
export async function recordFailure(pool: Pool, id: string, attempts: number, error: string): Promise<PostStatus> {
  const nextAttempts = attempts + 1;
  if (nextAttempts >= MAX_ATTEMPTS) {
    const [row] = await databaseFor(pool)
      .update(postsTable)
      .set({ status: 'failed', attempts: nextAttempts, error, claimed_at: null })
      .where(eq(postsTable.id, id))
      .returning();
    if (row) await recordPublishingCalendarChange(rowToPost(row));
    return "failed";
  }
  const backoff = BACKOFF_SECONDS[Math.min(nextAttempts - 1, BACKOFF_SECONDS.length - 1)];
  const [row] = await databaseFor(pool)
    .update(postsTable)
    .set({
      status: 'scheduled',
      attempts: nextAttempts,
      error,
      claimed_at: null,
      next_attempt_at: new Date(Date.now() + backoff * 1_000).toISOString(),
    })
    .where(eq(postsTable.id, id))
    .returning();
  if (row) await recordPublishingCalendarChange(rowToPost(row));
  return "scheduled";
}

/**
 * Requeue posts stuck in 'publishing' from a crashed worker. Logs loudly at the
 * call site: if the crash happened after the platform accepted the upload,
 * requeueing can double-post — the idempotency key exists to narrow that window.
 */
export async function recoverOrphaned(pool: Pool): Promise<number> {
  const recovered = await databaseFor(pool)
    .update(postsTable)
    .set({ status: 'scheduled', claimed_at: null })
    .where(and(
      eq(postsTable.status, 'publishing'),
      lt(postsTable.claimed_at, new Date(Date.now() - ORPHAN_AFTER_SECONDS * 1_000).toISOString()),
    ))
    .returning();
  await Promise.all(recovered.map((row) => recordPublishingCalendarChange(rowToPost(row))));
  return recovered.length;
}

export async function cancelPost(pool: Pool, id: string): Promise<boolean> {
  const rows = await databaseFor(pool)
    .update(postsTable)
    .set({ status: 'cancelled', claimed_at: null })
    .where(and(eq(postsTable.id, id), eq(postsTable.status, 'scheduled')))
    .returning();
  if (rows[0]) await recordPublishingCalendarChange(rowToPost(rows[0]));
  return rows.length > 0;
}

export async function retryPost(pool: Pool, id: string): Promise<boolean> {
  const rows = await databaseFor(pool)
    .update(postsTable)
    .set({
      status: 'scheduled',
      attempts: 0,
      next_attempt_at: null,
      error: null,
      publish_at: new Date().toISOString(),
    })
    .where(and(eq(postsTable.id, id), inArray(postsTable.status, ['failed', 'cancelled'])))
    .returning();
  if (rows[0]) await recordPublishingCalendarChange(rowToPost(rows[0]));
  return rows.length > 0;
}

export async function listQueue(pool: Pool): Promise<PostRecord[]> {
  const rows = await databaseFor(pool)
    .select()
    .from(postsTable)
    .where(eq(postsTable.status, 'scheduled'))
    .orderBy(asc(postsTable.publish_at));
  return rows.map(rowToPost);
}

export async function listHistory(pool: Pool, limit = 100): Promise<PostRecord[]> {
  const rows = await databaseFor(pool)
    .select()
    .from(postsTable)
    .where(inArray(postsTable.status, ['published', 'failed', 'cancelled', 'publishing']))
    .orderBy(desc(postsTable.publish_at))
    .limit(limit);
  return rows.map(rowToPost);
}

export async function listPostsForDraft(pool: Pool, draftId: string): Promise<PostRecord[]> {
  const rows = await databaseFor(pool)
    .select()
    .from(postsTable)
    .where(eq(postsTable.draft_id, draftId))
    .orderBy(desc(postsTable.created_at));
  return rows.map(rowToPost);
}

export async function getPost(pool: Pool, id: string): Promise<PostRecord | null> {
  const [row] = await databaseFor(pool)
    .select()
    .from(postsTable)
    .where(eq(postsTable.id, id))
    .limit(1);
  return row ? rowToPost(row) : null;
}

/**
 * publishedUrl → post resolution for the metrics ingest endpoint: result_url
 * is the live URL the destination adapter returned at publish time
 * (recordPublished). Newest wins if a URL was ever republished. RLS on the
 * org-scoped pool bounds the lookup to the caller's organization.
 */
export async function getPostByResultUrl(pool: Pool, resultUrl: string): Promise<PostRecord | null> {
  const [row] = await databaseFor(pool)
    .select()
    .from(postsTable)
    .where(eq(postsTable.result_url, resultUrl))
    .orderBy(desc(postsTable.created_at))
    .limit(1);
  return row ? rowToPost(row) : null;
}
