/**
 * Per-post metric snapshots — the feedback spine's raw storage.
 *
 * The post is the unit of measurement; the content node is the unit of
 * learning (spec 2026-07-31 §6). Raw snapshots are append-only time series
 * in Postgres; the graph receives only distilled per-draft aggregates
 * (rollup.ts). Rides the platform's tenant-scoped Postgres seam
 * (jobs/pool.ts) exactly like the jobs table.
 */

import { createLogger } from '@content-automation/observability';
import {
  databaseFor,
  post_metric_snapshots as metricSnapshotsTable,
} from '@content-automation/database';
import { and, desc, eq } from 'drizzle-orm';
import { emitProductEvent, recordProductEvent } from '../events/emit';
import {
  getJobPool,
  validateJobOrganizationId,
} from '../jobs/pool';

const log = createLogger('platform.metrics.snapshots');

export type MetricSource =
  | 'human'
  | 'platform_api'
  | 'plugin'
  | 'provider_webhook'
  | 'link_redirect';

export const METRIC_SOURCES: readonly MetricSource[] = [
  'human',
  'platform_api',
  'plugin',
  'provider_webhook',
  'link_redirect',
];

/**
 * Higher wins per metric key when several sources report the same key for
 * the same post. Only the platform_api > human ordering is contractual; the
 * rest orders automated first-party measurement above semi-automated and
 * hand-typed reporting.
 */
export const SOURCE_PRIORITY: Record<MetricSource, number> = {
  platform_api: 100,
  provider_webhook: 80,
  link_redirect: 60,
  plugin: 40,
  human: 20,
};

const METRIC_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_METRIC_KEYS = 32;

/** Metrics tables are provisioned exclusively by the root Drizzle migrations. */
export async function initMetricsTables(): Promise<void> {
  return Promise.resolve();
}

// Memoized like apps/content-generator's publishingDb helper: DDL runs once
// per process; a failed run resets so the next call retries.
let metricsSchemaReady: Promise<void> | null = null;

export async function ensureMetricsTables(): Promise<void> {
  if (!metricsSchemaReady) {
    metricsSchemaReady = initMetricsTables().catch((error) => {
      metricsSchemaReady = null;
      throw error;
    });
  }
  await metricsSchemaReady;
}

export function validateMetrics(metrics: Record<string, number>): void {
  const entries = Object.entries(metrics);
  if (entries.length === 0) {
    throw new Error('At least one metric value is required.');
  }
  if (entries.length > MAX_METRIC_KEYS) {
    throw new Error(`A snapshot may carry at most ${MAX_METRIC_KEYS} metric keys.`);
  }
  for (const [key, value] of entries) {
    if (!METRIC_KEY.test(key)) {
      throw new Error(
        `Invalid metric key "${key}": lower-case snake_case, max 64 characters.`,
      );
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`Metric "${key}" must be a non-negative finite number.`);
    }
  }
}

export interface RecordMetricSnapshotInput {
  organizationId: string;
  postId: string;
  draftId?: string;
  source: MetricSource;
  metrics: Record<string, number>;
}

export async function recordMetricSnapshot(
  input: RecordMetricSnapshotInput,
): Promise<{ id: string }> {
  const organizationId = validateJobOrganizationId(input.organizationId);
  const postId = input.postId?.trim();
  if (!postId) throw new Error('A post id is required.');
  if (!METRIC_SOURCES.includes(input.source)) {
    throw new Error(`Unknown metric source "${input.source}".`);
  }
  validateMetrics(input.metrics);
  const draftId = input.draftId?.trim() || null;

  await ensureMetricsTables();
  const [created] = await databaseFor(getJobPool(organizationId))
    .insert(metricSnapshotsTable)
    .values({
      organization_id: organizationId,
      post_id: postId,
      draft_id: draftId,
      source: input.source,
      metrics: input.metrics,
    })
    .returning({ id: metricSnapshotsTable.id });
  const id = created.id;

  if (draftId) {
    // Graph gets aggregates only, and never on the hot path: a rollup
    // failure is logged and absorbed — the next snapshot recomputes the
    // aggregate from Postgres. Dynamic import keeps snapshots.ts free of a
    // static cycle with rollup.ts (which imports latestAggregateDetail).
    try {
      const { rollupDraftMetrics } = await import('./rollup');
      await rollupDraftMetrics(organizationId, draftId);
    } catch (error) {
      log.error('metrics.rollup.failed', error, {
        organization_id: organizationId,
        draft_id: draftId,
      });
    }
  }

  // Order matters: insert → rollup → emit, so an automation triggered by the
  // event reads fresh aggregates. emitProductEvent is itself fire-and-forget
  // and never throws (packages/platform/events/emit.ts).
  emitProductEvent({
    organizationId,
    name: 'post.metrics.updated',
    payload: {
      postId,
      draftId,
      source: input.source,
    },
    refs: {
      postId,
      ...(draftId ? { draftId } : {}),
    },
  });
  await recordProductEvent({
    organizationId,
    name: 'knowledge.publishing.metrics.recorded',
    origin: 'internal',
    idempotencyKey: id,
    payload: {
      snapshotId: id,
      postId,
      draftId,
      source: input.source,
      metrics: input.metrics,
      occurredAt: new Date().toISOString(),
    },
    refs: { postId, ...(draftId ? { draftId } : {}) },
  });

  return { id };
}

export interface SnapshotSelectionRow {
  postId: string;
  source: MetricSource;
  capturedAt: Date;
  metrics: Record<string, number>;
}

/**
 * The merge rule (plan 2026-07-31-metrics-groundwork, Architecture):
 * input rows are the already-selected newest snapshot per (post, source).
 * Per post and per metric key, the highest-priority source that reports the
 * key wins (SOURCE_PRIORITY); per-post resolved values are summed across the
 * draft's posts. lastMeasuredAt is the max capturedAt over the input.
 */
export function mergeLatestSnapshots(rows: SnapshotSelectionRow[]): {
  totals: Record<string, number>;
  lastMeasuredAt: Date | null;
} {
  const byPost = new Map<string, SnapshotSelectionRow[]>();
  let lastMeasuredAt: Date | null = null;
  for (const row of rows) {
    const group = byPost.get(row.postId) ?? [];
    group.push(row);
    byPost.set(row.postId, group);
    if (!lastMeasuredAt || row.capturedAt > lastMeasuredAt) {
      lastMeasuredAt = row.capturedAt;
    }
  }

  const totals: Record<string, number> = {};
  for (const group of byPost.values()) {
    const resolved = new Map<string, { value: number; priority: number }>();
    for (const row of group) {
      const priority = SOURCE_PRIORITY[row.source];
      for (const [key, value] of Object.entries(row.metrics)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        const current = resolved.get(key);
        if (!current || priority > current.priority) {
          resolved.set(key, { value, priority });
        }
      }
    }
    for (const [key, { value }] of resolved) {
      totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return { totals, lastMeasuredAt };
}

export async function latestAggregateDetail(
  organizationId: string,
  draftId: string,
): Promise<{
  totals: Record<string, number>;
  lastMeasuredAt: Date | null;
  sources: MetricSource[];
}> {
  const scoped = validateJobOrganizationId(organizationId);
  await ensureMetricsTables();
  const rows = await databaseFor(getJobPool(scoped))
    .selectDistinctOn(
      [metricSnapshotsTable.post_id, metricSnapshotsTable.source],
      {
        postId: metricSnapshotsTable.post_id,
        source: metricSnapshotsTable.source,
        capturedAt: metricSnapshotsTable.captured_at,
        metrics: metricSnapshotsTable.metrics,
      },
    )
    .from(metricSnapshotsTable)
    .where(and(
      eq(metricSnapshotsTable.organization_id, scoped),
      eq(metricSnapshotsTable.draft_id, draftId),
    ))
    .orderBy(
      metricSnapshotsTable.post_id,
      metricSnapshotsTable.source,
      desc(metricSnapshotsTable.captured_at),
      desc(metricSnapshotsTable.id),
    );
  const snapshots = rows.map((row) => ({
    postId: row.postId,
    source: row.source as MetricSource,
    capturedAt: new Date(row.capturedAt),
    metrics: (row.metrics ?? {}) as Record<string, number>,
  }));
  return {
    ...mergeLatestSnapshots(snapshots),
    sources: [...new Set(snapshots.map(({ source }) => source))]
      .sort((left, right) => SOURCE_PRIORITY[right] - SOURCE_PRIORITY[left]),
  };
}

/** Pinned contract: per-draft aggregate totals under the merge rule above. */
export async function latestAggregates(
  organizationId: string,
  draftId: string,
): Promise<Record<string, number>> {
  return (await latestAggregateDetail(organizationId, draftId)).totals;
}
