/**
 * PostgreSQL job persistence layer.
 *
 * Stores job state in PostgreSQL for durability across container restarts.
 * Jobs are simple records that track status, timing, and results.
 *
 * Uses the shared platform PostgreSQL instance.
 */

import {
  activeTraceIds,
  activeTraceCarrier,
  currentExecutionContext,
  type ActorType,
} from '@content-automation/observability';
import { databaseFor, jobs as jobsTable } from '@content-automation/database';
import { and, asc, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import {
  getActionProduct,
  type BackgroundAction,
  type Product,
} from '../agents/contracts';
import {
  closeJobPools,
  createJobWorkerConnection,
  getJobAdminPool,
  getJobPool,
  validateJobOrganizationId,
} from './pool';

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type EntityType = 'project' | 'account' | 'prospect' | 'research' | 'topic' | 'outreach' | 'content' | 'content_idea';

export interface Job {
  id: string;
  type: BackgroundAction;
  product: Product;
  entityId: string;
  entityType: EntityType | null;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  organizationId: string | null;
  initiatingUserId: string | null;
  actorType: ActorType;
  walletUserId: string | null;
  creditReservationId: string | null;
  requestId: string | null;
  parentExecutionId: string | null;
  traceId: string | null;
  traceparent: string | null;
}

export type JobCommercialContext = {
  organizationId: string;
  initiatingUserId: string;
  walletUserId: string;
  creditReservationId: string;
};

/**
 * Initialize jobs table if it doesn't exist.
 */
export async function initJobsTable(): Promise<void> {
  return Promise.resolve();
}

/**
 * Create a new job record in PostgreSQL.
 */
export async function createJob(
  type: BackgroundAction,
  entityId: string,
  entityType?: EntityType,
  commercial?: JobCommercialContext,
): Promise<string> {
  // Ensure table exists
  await initJobsTable();

  const execution = currentExecutionContext();
  const organizationId = validateJobOrganizationId(
    commercial?.organizationId ?? execution?.organizationId ?? '',
  );
  const trace = activeTraceIds();
  const carrier = activeTraceCarrier();
  const [created] = await databaseFor(getJobPool(organizationId))
    .insert(jobsTable)
    .values({
      type,
      product: getActionProduct(type),
      entity_id: entityId,
      entity_type: entityType ?? null,
      status: 'queued',
      organization_id: organizationId,
      initiating_user_id: commercial?.initiatingUserId ?? execution?.actorId ?? null,
      actor_type: execution?.actorType ?? (commercial?.initiatingUserId ? 'user' : 'system'),
      wallet_user_id: commercial?.walletUserId ?? null,
      credit_reservation_id: commercial?.creditReservationId ?? null,
      request_id: execution?.requestId ?? null,
      parent_execution_id: execution?.executionId ?? null,
      trace_id: trace.traceId ?? null,
      traceparent: carrier.traceparent ?? null,
    })
    .returning({ id: jobsTable.id });

  return created.id;
}

/**
 * Update job status and optionally set result or error.
 */
export async function updateJobStatus(
  organizationId: string,
  jobId: string,
  status: JobStatus,
  options?: {
    result?: Record<string, unknown>;
    error?: string;
  }
): Promise<void> {
  const scopedOrganizationId = validateJobOrganizationId(organizationId);
  const changes: Partial<typeof jobsTable.$inferInsert> = { status };
  const now = new Date().toISOString();
  if (status === 'processing') changes.started_at = now;
  if (status === 'completed' || status === 'failed') changes.completed_at = now;
  if (options?.result) changes.result = options.result;
  if (options?.error) changes.error = options.error;

  await databaseFor(getJobPool(scopedOrganizationId))
    .update(jobsTable)
    .set(changes)
    .where(and(eq(jobsTable.organization_id, scopedOrganizationId), eq(jobsTable.id, jobId)));
}

/**
 * Replay-safe single-transition status update.
 *
 * Unlike `updateJobStatus` (unconditional write), this only applies the
 * transition when the row is currently in one of `from`'s statuses, and
 * reports whether it actually happened. Callers on at-least-once delivery
 * paths (e.g. a webhook that may be replayed) use the boolean to run
 * side effects (crediting, notifications) exactly once per job.
 */
export async function transitionJobStatus(
  organizationId: string,
  jobId: string,
  from: JobStatus[],
  to: JobStatus,
  options?: {
    result?: Record<string, unknown>;
    error?: string;
  },
): Promise<boolean> {
  if (from.length === 0) return false;
  const scoped = validateJobOrganizationId(organizationId);
  const changes: Partial<typeof jobsTable.$inferInsert> = { status: to };
  const now = new Date().toISOString();
  if (to === 'processing') changes.started_at = now;
  if (to === 'completed' || to === 'failed') changes.completed_at = now;
  if (options?.result) changes.result = options.result;
  if (options?.error) changes.error = options.error;
  const updated = await databaseFor(getJobPool(scoped))
    .update(jobsTable)
    .set(changes)
    .where(and(
      eq(jobsTable.organization_id, scoped),
      eq(jobsTable.id, jobId),
      inArray(jobsTable.status, from),
    ))
    .returning({ id: jobsTable.id });
  return updated.length > 0;
}

/**
 * Get job by ID.
 */
export async function getJobStatus(organizationId: string, jobId: string): Promise<Job | null> {
  const scoped = validateJobOrganizationId(organizationId);
  const [row] = await databaseFor(getJobPool(scoped))
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.organization_id, scoped), eq(jobsTable.id, jobId)))
    .limit(1);
  return row ? mapRowToJob(row) : null;
}

/**
 * Get the latest job for an entity (optionally filtered by type).
 */
export async function getLatestJobForEntity(
  organizationId: string,
  entityId: string,
  type?: BackgroundAction
): Promise<Job | null> {
  const scoped = validateJobOrganizationId(organizationId);
  const filters = [
    eq(jobsTable.organization_id, scoped),
    eq(jobsTable.entity_id, entityId),
  ];
  if (type) filters.push(eq(jobsTable.type, type));
  const [row] = await databaseFor(getJobPool(scoped))
    .select()
    .from(jobsTable)
    .where(and(...filters))
    .orderBy(desc(jobsTable.created_at))
    .limit(1);
  return row ? mapRowToJob(row) : null;
}

/**
 * Get all jobs for an entity.
 */
export async function getJobsForEntity(
  organizationId: string,
  entityId: string,
  limit: number = 10
): Promise<Job[]> {
  const scoped = validateJobOrganizationId(organizationId);
  const rows = await databaseFor(getJobPool(scoped))
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.organization_id, scoped), eq(jobsTable.entity_id, entityId)))
    .orderBy(desc(jobsTable.created_at))
    .limit(limit);
  return rows.map(mapRowToJob);
}

/**
 * Get jobs by status.
 */
export async function getJobsByStatus(
  organizationId: string,
  status: JobStatus,
  limit: number = 50
): Promise<Job[]> {
  const scoped = validateJobOrganizationId(organizationId);
  const rows = await databaseFor(getJobPool(scoped))
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.organization_id, scoped), eq(jobsTable.status, status)))
    .orderBy(desc(jobsTable.created_at))
    .limit(limit);
  return rows.map(mapRowToJob);
}

/**
 * Control-plane discovery of jobs an out-of-process executor may have finished
 * without anyone noticing: rows of `type` still `processing` whose `result`
 * JSONB carries an external handle (`result->'modalCallId'` for resonance).
 *
 * IDs only, on the admin pool — no payload, result, or error crosses this
 * boundary (same contract as `getJobOrganizationId`). Callers re-enter through
 * the tenant-scoped pool to read anything else. Oldest first, so a backlog
 * drains in the order it accumulated.
 */
export async function listReconcilableJobIds(
  type: BackgroundAction,
  resultHandleKey: string,
  limit: number = 50,
): Promise<string[]> {
  const rows = await databaseFor(getJobAdminPool())
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(
      eq(jobsTable.type, type),
      eq(jobsTable.status, 'processing'),
      isNotNull(jobsTable.result),
      sql<boolean>`jsonb_exists(${jobsTable.result}, ${resultHandleKey})`,
    ))
    .orderBy(asc(sql`coalesce(${jobsTable.started_at}, ${jobsTable.created_at})`))
    .limit(Math.max(1, Math.min(limit, 500)));
  return rows.map((row) => row.id);
}

/**
 * Clean up old completed jobs (older than days).
 */
export async function cleanupOldJobs(daysOld: number = 7): Promise<number> {
  const cutoff = new Date(Date.now() - daysOld * 86_400_000).toISOString();
  const deleted = await databaseFor(getJobAdminPool())
    .delete(jobsTable)
    .where(and(inArray(jobsTable.status, ['completed', 'failed']), lt(jobsTable.created_at, cutoff)))
    .returning({ id: jobsTable.id });
  return deleted.length;
}

/**
 * Close the connection pool (for graceful shutdown).
 */
export async function closePool(): Promise<void> {
  await closeJobPools();
}

// Helper to map database row to Job interface
function mapRowToJob(row: typeof jobsTable.$inferSelect): Job {
  return {
    id: row.id as string,
    type: row.type as BackgroundAction,
    product: row.product as Product,
    entityId: row.entity_id as string,
    entityType: row.entity_type as EntityType | null,
    status: row.status as JobStatus,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    result: row.result as Record<string, unknown> | null,
    error: row.error as string | null,
    organizationId: row.organization_id as string | null,
    initiatingUserId: row.initiating_user_id as string | null,
    actorType: (row.actor_type as ActorType | null) ?? 'system',
    walletUserId: row.wallet_user_id as string | null,
    creditReservationId: row.credit_reservation_id as string | null,
    requestId: row.request_id as string | null,
    parentExecutionId: row.parent_execution_id as string | null,
    traceId: row.trace_id as string | null,
    traceparent: row.traceparent as string | null,
  };
}

// For use in worker threads (raw pg without pool)
export function createWorkerConnection(organizationId: string) {
  return createJobWorkerConnection(organizationId);
}

/**
 * Control-plane lookup used only to re-enter through the tenant-scoped pool.
 * No job payload, subject, result, or error crosses this boundary.
 */
export async function getJobOrganizationId(jobId: string): Promise<string | null> {
  const [row] = await databaseFor(getJobAdminPool())
    .select({ organizationId: jobsTable.organization_id })
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .limit(1);
  return row?.organizationId
    ? validateJobOrganizationId(row.organizationId)
    : null;
}
