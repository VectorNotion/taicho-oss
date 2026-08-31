import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  databaseFor,
  execution_eventInObservability as executionEventTable,
  runtimePoolConfig,
} from "@content-automation/database";
import { lt, sql } from "drizzle-orm";
import {
  activeTraceIds,
  currentExecutionContext,
  type ExecutionContext,
} from "./context";
import { safeAttributes, safeError } from "./privacy";
import { supportCodeFor } from "./support";

export type ExecutionLedgerStatus = "started" | "succeeded" | "failed";

export type ExecutionLedgerEntry = {
  eventId: string;
  execution: ExecutionContext;
  operation: string;
  status: ExecutionLedgerStatus;
  attributes?: Record<string, unknown>;
  durationMs?: number;
  error?: unknown;
};

let pool: Pool | undefined;
let schemaReady: Promise<void> | undefined;

export function executionLedgerEnabled(): boolean {
  return process.env.OBSERVABILITY_LEDGER_ENABLED === "true";
}

function databasePool(): Pool {
  if (!pool) {
    pool = new Pool({
      ...runtimePoolConfig(),
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
    });
  }
  return pool;
}

export async function ensureExecutionLedger(): Promise<void> {
  if (!executionLedgerEnabled()) return;
  schemaReady ??= Promise.resolve();
  await schemaReady;
}

function serviceName(): string {
  return process.env.OTEL_SERVICE_NAME
    ?? process.env.DD_SERVICE
    ?? process.env.npm_package_name
    ?? "content-automation";
}

export function newExecutionEventId(): string {
  return randomUUID();
}

export async function writeExecutionLedger(entry: ExecutionLedgerEntry): Promise<void> {
  if (!executionLedgerEnabled()) return;
  await ensureExecutionLedger();
  const traces = activeTraceIds();
  const normalizedError = entry.error === undefined ? undefined : safeError(entry.error);
  const configuredRetention = Number(process.env.OBSERVABILITY_LEDGER_RETENTION_DAYS ?? 180);
  const retentionDays = Number.isFinite(configuredRetention)
    ? Math.max(1, Math.min(3650, Math.floor(configuredRetention)))
    : 180;
  const completedAt = entry.status === "started" ? null : new Date().toISOString();
  const retainedUntil = new Date(Date.now() + retentionDays * 86_400_000).toISOString();
  await databaseFor(databasePool())
    .insert(executionEventTable)
    .values({
      event_id: entry.eventId,
      support_code: supportCodeFor(entry.execution.requestId),
      execution_id: entry.execution.executionId,
      request_id: entry.execution.requestId,
      parent_execution_id: entry.execution.parentExecutionId ?? null,
      organization_id: entry.execution.organizationId ?? null,
      actor_id: entry.execution.actorId ?? null,
      actor_type: entry.execution.actorType,
      session_id: entry.execution.sessionId ?? null,
      run_id: entry.execution.runId ?? null,
      job_id: entry.execution.jobId ?? null,
      trace_id: traces.traceId ?? null,
      span_id: traces.spanId ?? null,
      service_name: serviceName(),
      operation: entry.operation,
      status: entry.status,
      safe_attributes: safeAttributes(entry.attributes),
      error_type: normalizedError?.type ?? null,
      error_code: normalizedError?.code ?? null,
      error_fingerprint: normalizedError?.fingerprint ?? null,
      completed_at: completedAt,
      duration_ms: entry.durationMs ?? null,
      retained_until: retainedUntil,
    })
    .onConflictDoUpdate({
      target: executionEventTable.event_id,
      set: {
        status: entry.status,
        safe_attributes: safeAttributes(entry.attributes),
        parent_execution_id: sql`coalesce(excluded.parent_execution_id, ${executionEventTable.parent_execution_id})`,
        organization_id: sql`coalesce(excluded.organization_id, ${executionEventTable.organization_id})`,
        actor_id: sql`coalesce(excluded.actor_id, ${executionEventTable.actor_id})`,
        actor_type: entry.execution.actorType,
        session_id: sql`coalesce(excluded.session_id, ${executionEventTable.session_id})`,
        run_id: sql`coalesce(excluded.run_id, ${executionEventTable.run_id})`,
        job_id: sql`coalesce(excluded.job_id, ${executionEventTable.job_id})`,
        trace_id: sql`coalesce(excluded.trace_id, ${executionEventTable.trace_id})`,
        span_id: sql`coalesce(excluded.span_id, ${executionEventTable.span_id})`,
        error_type: normalizedError?.type ?? null,
        error_code: normalizedError?.code ?? null,
        error_fingerprint: normalizedError?.fingerprint ?? null,
        completed_at: completedAt,
        duration_ms: entry.durationMs ?? null,
      },
    });
}

export async function cleanupExpiredExecutionLedger(): Promise<number> {
  if (!executionLedgerEnabled()) return 0;
  await ensureExecutionLedger();
  const deleted = await databaseFor(databasePool())
    .delete(executionEventTable)
    .where(lt(executionEventTable.retained_until, new Date().toISOString()))
    .returning({ id: executionEventTable.event_id });
  return deleted.length;
}

export async function closeExecutionLedger(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = undefined;
  schemaReady = undefined;
}

export function currentSupportCode(): string | undefined {
  const execution = currentExecutionContext();
  return execution ? supportCodeFor(execution.requestId) : undefined;
}
