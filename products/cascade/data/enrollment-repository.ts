import {
  contactsInCascade as contactsTable,
  databaseFor,
  enrollmentsInCascade as enrollmentsTable,
  funnel_stepsInCascade as stepsTable,
  funnelsInCascade as funnelsTable,
  sendsInCascade as sendsTable,
} from "@content-automation/database";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import {
  activeTraceIds,
  activeTraceCarrier,
  currentExecutionContext,
  type ActorType,
} from "@content-automation/observability";
import type { Enrollment } from "../domain/types";

export interface EnrollmentListItem {
  id: string;
  email: string;
  state: string;
  currentPosition: number | null;
  atFrontier: boolean;
  nextRunAt: string | null;
  enrolledAt: string;
  sends: number;
  lastSubject: string | null;
}

function enrollmentDate(value: string): Date {
  return value === "infinity" ? new Date(8_640_000_000_000_000) : new Date(value);
}

/** The people in a funnel: who they are, where they sit, what they last got. */
export async function listEnrollments(pool: Pool, funnelId: string): Promise<EnrollmentListItem[]> {
  const rows = await databaseFor(pool).select({
    id: enrollmentsTable.id,
    email: contactsTable.email,
    state: enrollmentsTable.state,
    next_run_at: enrollmentsTable.next_run_at,
    created_at: enrollmentsTable.created_at,
    current_position: stepsTable.position,
    at_frontier: sql<boolean>`${enrollmentsTable.state} = 'active' and ${enrollmentsTable.current_step_id} is null`,
    sends: sql<number>`count(${sendsTable.id}) filter (where ${sendsTable.status} = 'sent')::int`,
    last_subject: sql<string | null>`(
      select coalesce(em.name, ls.config->>'subject')
      from cascade.sends lsnd
      join cascade.funnel_steps ls on ls.id = lsnd.step_id
      left join cascade.variants lv on lv.id = lsnd.variant_id
      left join cascade.emails em on em.id = coalesce(lv.email_id, (ls.config->>'emailId')::uuid)
      where lsnd.enrollment_id = ${enrollmentsTable.id} and lsnd.status = 'sent'
      order by lsnd.created_at desc limit 1
    )`,
  }).from(enrollmentsTable)
    .innerJoin(contactsTable, eq(contactsTable.id, enrollmentsTable.contact_id))
    .leftJoin(stepsTable, eq(stepsTable.id, enrollmentsTable.current_step_id))
    .leftJoin(sendsTable, eq(sendsTable.enrollment_id, enrollmentsTable.id))
    .where(eq(enrollmentsTable.funnel_id, funnelId))
    .groupBy(enrollmentsTable.id, contactsTable.email, stepsTable.position)
    .orderBy(desc(enrollmentsTable.created_at));
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    state: r.state,
    currentPosition: r.current_position,
    atFrontier: r.at_frontier,
    // Frontier enrollments park at timestamp 'infinity' — surface as null.
    nextRunAt:
      r.next_run_at && String(r.next_run_at) !== "infinity" && !Number.isNaN(new Date(r.next_run_at).getTime())
        ? new Date(r.next_run_at).toISOString()
        : null,
    enrolledAt: new Date(r.created_at).toISOString(),
    sends: r.sends,
    lastSubject: r.last_subject,
  }));
}

export async function enrollContact(pool: Pool, funnelId: string, contactId: string): Promise<Enrollment> {
  const execution = currentExecutionContext();
  const trace = activeTraceIds();
  const carrier = activeTraceCarrier();
  const attribution = [
    execution?.actorId ?? null,
    (execution?.actorType ?? "system") satisfies ActorType,
    execution?.requestId ?? null,
    execution?.executionId ?? null,
    trace.traceId ?? null,
    carrier.traceparent ?? null,
  ];
  const db = databaseFor(pool);
  const enrollmentSelection = {
    id: enrollmentsTable.id,
    funnel_id: enrollmentsTable.funnel_id,
    contact_id: enrollmentsTable.contact_id,
    current_step_id: enrollmentsTable.current_step_id,
    state: enrollmentsTable.state,
    next_run_at: enrollmentsTable.next_run_at,
  };
  const [existing] = await db.select(enrollmentSelection).from(enrollmentsTable).where(and(
    eq(enrollmentsTable.funnel_id, funnelId),
    eq(enrollmentsTable.contact_id, contactId),
    eq(enrollmentsTable.state, "active"),
  )).orderBy(desc(enrollmentsTable.created_at)).limit(1);
  if (existing) {
    const row = existing;
    return {
      id: row.id,
      funnelId: row.funnel_id,
      contactId: row.contact_id,
      currentStepId: row.current_step_id,
      state: row.state as Enrollment["state"],
      nextRunAt: enrollmentDate(row.next_run_at),
    };
  }
  const [firstStep] = await db.select({ id: stepsTable.id }).from(stepsTable).where(and(
    eq(stepsTable.funnel_id, funnelId), eq(stepsTable.position, 1),
  )).limit(1);
  if (!firstStep) {
    const [funnel] = await db.select({ openEnded: funnelsTable.open_ended }).from(funnelsTable)
      .where(eq(funnelsTable.id, funnelId)).limit(1);
    if (!funnel?.openEnded) {
      throw new Error(`funnel ${funnelId} has no steps`);
    }
    // Empty open-ended funnel: wait at the frontier until a step is appended.
    const [frow] = await db.insert(enrollmentsTable).values({
      funnel_id: funnelId,
      contact_id: contactId,
      current_step_id: null,
      next_run_at: sql`'infinity'::timestamptz`,
      created_by: attribution[0] as string | null,
      actor_type: attribution[1] as ActorType,
      request_id: attribution[2] as string | null,
      parent_execution_id: attribution[3] as string | null,
      trace_id: attribution[4] as string | null,
      traceparent: attribution[5] as string | null,
    }).returning(enrollmentSelection);
    return {
      id: frow.id,
      funnelId: frow.funnel_id,
      contactId: frow.contact_id,
      currentStepId: frow.current_step_id,
      state: frow.state as Enrollment["state"],
      nextRunAt: enrollmentDate(frow.next_run_at),
    };
  }
  const [row] = await db.insert(enrollmentsTable).values({
    funnel_id: funnelId,
    contact_id: contactId,
    current_step_id: firstStep.id,
    created_by: attribution[0] as string | null,
    actor_type: attribution[1] as ActorType,
    request_id: attribution[2] as string | null,
    parent_execution_id: attribution[3] as string | null,
    trace_id: attribution[4] as string | null,
    traceparent: attribution[5] as string | null,
  }).returning(enrollmentSelection);
  return {
    id: row.id,
    funnelId: row.funnel_id,
    contactId: row.contact_id,
    currentStepId: row.current_step_id,
    state: row.state as Enrollment["state"],
    nextRunAt: enrollmentDate(row.next_run_at),
  };
}
