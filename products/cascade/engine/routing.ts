import {
  databaseFor,
  type Database,
  enrollmentsInCascade,
  funnel_routesInCascade as funnelRoutesInCascade,
  funnel_stepsInCascade as funnelStepsInCascade,
  funnelsInCascade,
  sendsInCascade,
} from "@content-automation/database";
import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Pool, PoolClient } from "pg";
import {
  activeTraceIds,
  activeTraceCarrier,
  currentExecutionContext,
  type ActorType,
} from "@content-automation/observability";
import type { RouteOutcome } from "../domain/types";

type Queryable = Pool | PoolClient;

function routingDatabase(source: Queryable | Database): Database {
  return "$count" in source ? source : databaseFor(source);
}

/**
 * Enroll the contact into the funnel routed to from (funnelId, outcome), if
 * such a route exists. Skips when the contact already has an active
 * enrollment in the target funnel. Frontier-enrolls into empty open-ended
 * funnels.
 */
export async function routeEnrollment(
  source: Queryable | Database,
  args: {
    contactId: string;
    funnelId: string;
    createdBy?: string | null;
    actorType?: ActorType | null;
    requestId?: string | null;
  },
  outcome: RouteOutcome,
): Promise<{ routed: boolean; toFunnelId?: string }> {
  const db = routingDatabase(source);
  const [route] = await db
    .select({ toFunnelId: funnelRoutesInCascade.to_funnel_id })
    .from(funnelRoutesInCascade)
    .where(and(eq(funnelRoutesInCascade.from_funnel_id, args.funnelId), eq(funnelRoutesInCascade.outcome, outcome)))
    .limit(1);
  if (!route) return { routed: false };
  const toFunnelId = route.toFunnelId;

  const [existing] = await db
    .select({ id: enrollmentsInCascade.id })
    .from(enrollmentsInCascade)
    .where(
      and(
        eq(enrollmentsInCascade.funnel_id, toFunnelId),
        eq(enrollmentsInCascade.contact_id, args.contactId),
        eq(enrollmentsInCascade.state, "active"),
      ),
    )
    .limit(1);
  if (existing) return { routed: false, toFunnelId };

  const [firstStep] = await db
    .select({ id: funnelStepsInCascade.id })
    .from(funnelStepsInCascade)
    .where(and(eq(funnelStepsInCascade.funnel_id, toFunnelId), eq(funnelStepsInCascade.position, 1)))
    .limit(1);
  const execution = currentExecutionContext();
  const trace = activeTraceIds();
  const carrier = activeTraceCarrier();
  const attribution = {
    created_by: execution?.actorId ?? args.createdBy ?? null,
    actor_type: execution?.actorType ?? args.actorType ?? "system",
    request_id: execution?.requestId ?? args.requestId ?? null,
    parent_execution_id: execution?.executionId ?? null,
    trace_id: trace.traceId ?? null,
    traceparent: carrier.traceparent ?? null,
  };
  if (firstStep) {
    await db.insert(enrollmentsInCascade).values({
      funnel_id: toFunnelId,
      contact_id: args.contactId,
      current_step_id: firstStep.id,
      ...attribution,
    });
    return { routed: true, toFunnelId };
  }

  const [funnel] = await db
    .select({ openEnded: funnelsInCascade.open_ended })
    .from(funnelsInCascade)
    .where(eq(funnelsInCascade.id, toFunnelId))
    .limit(1);
  if (funnel?.openEnded) {
    await db.insert(enrollmentsInCascade).values({
      funnel_id: toFunnelId,
      contact_id: args.contactId,
      current_step_id: null,
      next_run_at: sql`'infinity'::timestamptz`,
      ...attribution,
    });
    return { routed: true, toFunnelId };
  }
  return { routed: false, toFunnelId };
}

/**
 * Interest hand-raise on a send: stop the enrollment that sent it and move
 * the contact along the funnel's interest route, atomically.
 */
export async function routeOnInterest(pool: Pool, sendId: string): Promise<{ routed: boolean }> {
  return databaseFor(pool).transaction(async (tx) => {
    const enrollment = alias(enrollmentsInCascade, "enrollment");
    const [row] = await tx
      .select({
        enrollmentId: enrollment.id,
        contactId: enrollment.contact_id,
        funnelId: enrollment.funnel_id,
        createdBy: enrollment.created_by,
        actorType: enrollment.actor_type,
        requestId: enrollment.request_id,
      })
      .from(sendsInCascade)
      .innerJoin(enrollment, eq(enrollment.id, sendsInCascade.enrollment_id))
      .where(eq(sendsInCascade.id, sendId))
      .for("update", { of: enrollment })
      .limit(1);
    if (!row) return { routed: false };
    const [route] = await tx
      .select({ toFunnelId: funnelRoutesInCascade.to_funnel_id })
      .from(funnelRoutesInCascade)
      .where(
        and(eq(funnelRoutesInCascade.from_funnel_id, row.funnelId), eq(funnelRoutesInCascade.outcome, "interest")),
      )
      .limit(1);
    if (!route) return { routed: false };
    await tx
      .update(enrollmentsInCascade)
      .set({ state: "stopped", updated_at: sql`now()` })
      .where(and(eq(enrollmentsInCascade.id, row.enrollmentId), eq(enrollmentsInCascade.state, "active")));
    const result = await routeEnrollment(
      tx as Database,
      {
        contactId: row.contactId,
        funnelId: row.funnelId,
        createdBy: row.createdBy,
        actorType: row.actorType as ActorType | null,
        requestId: row.requestId,
      },
      "interest",
    );
    return { routed: result.routed };
  });
}
