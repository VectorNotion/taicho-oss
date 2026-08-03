import {
  contactsInCascade,
  databaseFor,
  type Database,
  enrollmentsInCascade,
  eventsInCascade,
  funnel_stepsInCascade as funnelStepsInCascade,
  funnelsInCascade,
  sendsInCascade,
} from "@content-automation/database";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Pool, PoolClient } from "pg";
import {
  activeTraceIds,
  activeTraceCarrier,
  observeOperation,
  type ActorType,
} from "@content-automation/observability";
import type { BranchStepConfig, GoalStepConfig, StepType } from "../domain/types";
import { listActiveVariants } from "../data/variant-repository";
import { thompsonPick } from "./bandit";
import { routeEnrollment } from "./routing";

export interface ClaimedRow {
  enrollmentId: string;
  contactId: string;
  funnelId: string;
  openEnded: boolean;
  stepId: string;
  stepType: StepType;
  stepConfig: Record<string, unknown>;
  stepPosition: number;
  contactEmail: string;
  attributes: Record<string, unknown>;
  subscriptionStatus: string;
  organizationId?: string;
  createdBy?: string;
  actorType: ActorType;
  requestId?: string;
  parentExecutionId?: string;
  traceId?: string;
  traceparent?: string;
}

/**
 * Claim one due enrollment. Must run inside an open transaction; the row
 * stays locked (and invisible to other workers via SKIP LOCKED) until
 * commit/rollback.
 */
export async function claimDueEnrollment(client: PoolClient): Promise<ClaimedRow | null> {
  return claimDueEnrollmentFromDatabase(databaseFor(client));
}

async function claimDueEnrollmentFromDatabase(db: Database): Promise<ClaimedRow | null> {
  const enrollment = alias(enrollmentsInCascade, "enrollment");
  const [row] = await db
    .select({
      enrollmentId: enrollment.id,
      contactId: enrollment.contact_id,
      funnelId: enrollment.funnel_id,
      openEnded: funnelsInCascade.open_ended,
      organizationId: enrollment.organization_id,
      createdBy: enrollment.created_by,
      actorType: enrollment.actor_type,
      requestId: enrollment.request_id,
      parentExecutionId: enrollment.parent_execution_id,
      traceId: enrollment.trace_id,
      traceparent: enrollment.traceparent,
      stepId: funnelStepsInCascade.id,
      stepType: funnelStepsInCascade.type,
      stepConfig: funnelStepsInCascade.config,
      stepPosition: funnelStepsInCascade.position,
      contactEmail: contactsInCascade.email,
      attributes: contactsInCascade.attributes,
      subscriptionStatus: contactsInCascade.subscription_status,
    })
    .from(enrollment)
    .innerJoin(funnelStepsInCascade, eq(funnelStepsInCascade.id, enrollment.current_step_id))
    .innerJoin(contactsInCascade, eq(contactsInCascade.id, enrollment.contact_id))
    .innerJoin(funnelsInCascade, eq(funnelsInCascade.id, enrollment.funnel_id))
    .where(and(eq(enrollment.state, "active"), lte(enrollment.next_run_at, sql`now()`)))
    .orderBy(asc(enrollment.next_run_at))
    .for("update", { of: enrollment, skipLocked: true })
    .limit(1);
  if (!row) return null;
  await db
    .update(enrollmentsInCascade)
    .set({ request_id: sql`coalesce(${enrollmentsInCascade.request_id}, ${enrollmentsInCascade.id}::text)` })
    .where(eq(enrollmentsInCascade.id, row.enrollmentId));
  return {
    enrollmentId: row.enrollmentId,
    contactId: row.contactId,
    funnelId: row.funnelId,
    openEnded: row.openEnded,
    stepId: row.stepId,
    stepType: row.stepType as StepType,
    stepConfig: row.stepConfig as Record<string, unknown>,
    stepPosition: row.stepPosition,
    contactEmail: row.contactEmail,
    attributes: row.attributes as Record<string, unknown>,
    subscriptionStatus: row.subscriptionStatus,
    organizationId: row.organizationId ?? undefined,
    createdBy: row.createdBy ?? undefined,
    actorType: (row.actorType as ActorType | null) ?? "system",
    requestId: row.requestId ?? row.enrollmentId,
    parentExecutionId: row.parentExecutionId ?? undefined,
    traceId: row.traceId ?? undefined,
    traceparent: row.traceparent ?? undefined,
  };
}

export interface TickResult {
  processed: number;
  queued: number;
  completed: number;
}

interface StepOutcome {
  queued: boolean;
  completed: boolean;
}

/** Complete the enrollment and follow the funnel's 'completed' route, if any. */
async function completeAndRoute(db: Database, row: ClaimedRow, outcome: "completed" | "interest") {
  await db
    .update(enrollmentsInCascade)
    .set({ state: "completed", current_step_id: null, updated_at: sql`now()` })
    .where(eq(enrollmentsInCascade.id, row.enrollmentId));
  await routeEnrollment(
    db,
    {
      contactId: row.contactId,
      funnelId: row.funnelId,
      createdBy: row.createdBy,
      actorType: row.actorType,
      requestId: row.requestId,
    },
    outcome,
  );
}

/** Park an open-ended enrollment at the frontier until a new step is appended. */
async function parkAtFrontier(db: Database, row: ClaimedRow): Promise<void> {
  await db
    .update(enrollmentsInCascade)
    .set({ current_step_id: null, next_run_at: sql`'infinity'::timestamptz`, updated_at: sql`now()` })
    .where(eq(enrollmentsInCascade.id, row.enrollmentId));
}

/** Advance the cursor to the next step; complete (or frontier-park) if none. */
async function advance(db: Database, row: ClaimedRow, delaySeconds: number): Promise<boolean> {
  const [next] = await db
    .select({ id: funnelStepsInCascade.id })
    .from(funnelStepsInCascade)
    .where(
      and(
        eq(funnelStepsInCascade.funnel_id, row.funnelId),
        eq(funnelStepsInCascade.position, row.stepPosition + 1),
      ),
    )
    .limit(1);
  if (!next) {
    if (row.openEnded) {
      await parkAtFrontier(db, row);
      return false;
    }
    await completeAndRoute(db, row, "completed");
    return true;
  }
  await db
    .update(enrollmentsInCascade)
    .set({
      current_step_id: next.id,
      next_run_at: sql`now() + make_interval(secs => ${delaySeconds})`,
      updated_at: sql`now()`,
    })
    .where(eq(enrollmentsInCascade.id, row.enrollmentId));
  return false;
}

/** Move the cursor to an absolute position (branch jump); complete if missing. */
async function jumpToPosition(db: Database, row: ClaimedRow, position: number): Promise<boolean> {
  const [step] = await db
    .select({ id: funnelStepsInCascade.id })
    .from(funnelStepsInCascade)
    .where(and(eq(funnelStepsInCascade.funnel_id, row.funnelId), eq(funnelStepsInCascade.position, position)))
    .limit(1);
  if (!step) {
    if (row.openEnded) {
      await parkAtFrontier(db, row);
      return false;
    }
    await completeAndRoute(db, row, "completed");
    return true;
  }
  await db
    .update(enrollmentsInCascade)
    .set({ current_step_id: step.id, next_run_at: sql`now()`, updated_at: sql`now()` })
    .where(eq(enrollmentsInCascade.id, row.enrollmentId));
  return false;
}

async function executeStep(db: Database, row: ClaimedRow, rng: () => number): Promise<StepOutcome> {
  const trace = activeTraceIds();
  const carrier = activeTraceCarrier();
  const sendAttribution = {
    created_by: row.createdBy ?? null,
    actor_type: row.actorType,
    request_id: row.requestId ?? null,
    parent_execution_id: row.enrollmentId,
    trace_id: trace.traceId ?? row.traceId ?? null,
    traceparent: carrier.traceparent ?? row.traceparent ?? null,
  };
  if (row.stepType === "branch") {
    const cfg = row.stepConfig as unknown as BranchStepConfig;
    let matched: boolean;
    if (cfg.condition.kind === "event") {
      const [event] = await db
        .select({ id: eventsInCascade.id })
        .from(eventsInCascade)
        .innerJoin(sendsInCascade, eq(sendsInCascade.id, eventsInCascade.send_id))
        .where(and(eq(sendsInCascade.enrollment_id, row.enrollmentId), eq(eventsInCascade.type, cfg.condition.type)))
        .limit(1);
      matched = Boolean(event);
    } else {
      matched = String(row.attributes?.[cfg.condition.key]) === cfg.condition.equals;
    }
    const completed = await jumpToPosition(db, row, matched ? cfg.thenPosition : cfg.elsePosition);
    return { queued: false, completed };
  }

  if (row.stepType === "goal") {
    const cfg = row.stepConfig as unknown as GoalStepConfig;
    await completeAndRoute(db, row, cfg.outcome ?? "completed");
    return { queued: false, completed: true };
  }

  // Delay semantics: the wait gates the NEXT step (cursor advances past the
  // delay immediately, next_run_at pushed out). A trailing delay therefore
  // completes the funnel instantly — end funnels with goal or email steps.
  if (row.stepType === "delay") {
    const seconds = Number(row.stepConfig.seconds);
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error(`enrollment ${row.enrollmentId}: invalid delay config ${JSON.stringify(row.stepConfig)}`);
    }
    const completed = await advance(db, row, seconds);
    return { queued: false, completed };
  }

  // email step — enqueue only; the send loop owns composition and transport.

  // Suppression gate — mandatory before every send, no exceptions.
  if (row.subscriptionStatus !== "subscribed") {
    await db
      .insert(sendsInCascade)
      .values({ enrollment_id: row.enrollmentId, step_id: row.stepId, status: "skipped", ...sendAttribution })
      .onConflictDoNothing({ target: [sendsInCascade.enrollment_id, sendsInCascade.step_id] });
    const completed = await advance(db, row, 0);
    return { queued: false, completed };
  }

  // Bandit allocation: when the step has active variants, Thompson sampling
  // picks the arm; the choice is stamped on the send for attribution.
  const arms = await listActiveVariants(db, row.stepId);
  const variantId = arms.length > 0 ? thompsonPick(arms, rng).id : null;

  const reserved = await db
    .insert(sendsInCascade)
    .values({
      enrollment_id: row.enrollmentId,
      step_id: row.stepId,
      status: "queued",
      variant_id: variantId,
      ...sendAttribution,
    })
    .onConflictDoNothing({ target: [sendsInCascade.enrollment_id, sendsInCascade.step_id] })
    .returning({ id: sendsInCascade.id });
  const completed = await advance(db, row, 0);
  // rowCount 0 = a send row already exists (retry path): never enqueue twice.
  return { queued: reserved.length > 0, completed };
}

/** One engine tick: claim and execute up to batchSize due enrollments, one transaction each. */
export async function runTick(
  pool: Pool,
  opts: { batchSize?: number; rng?: () => number } = {},
): Promise<TickResult> {
  const batchSize = opts.batchSize ?? 10;
  const rng = opts.rng ?? Math.random;
  const result: TickResult = { processed: 0, queued: 0, completed: 0 };
  for (let i = 0; i < batchSize; i++) {
    const outcome = await databaseFor(pool).transaction(async (tx) => {
      const row = await claimDueEnrollmentFromDatabase(tx as Database);
      if (!row) return null;
      return observeOperation(
          "cascade.enrollment.step",
          {
            requestId: row.requestId ?? row.enrollmentId,
            traceCarrier: { traceparent: row.traceparent },
            parentExecutionId: row.parentExecutionId,
            organizationId: row.organizationId,
            actorId: row.createdBy,
            actorType: row.actorType,
            runId: row.enrollmentId,
            attributes: {
              "cascade.funnel.id": row.funnelId,
              "cascade.step.id": row.stepId,
              "cascade.step.type": row.stepType,
            },
          },
          () => executeStep(tx as Database, row, rng),
        );
    });
    if (!outcome) break;
    result.processed += 1;
    if (outcome.queued) result.queued += 1;
    if (outcome.completed) result.completed += 1;
  }
  return result;
}
