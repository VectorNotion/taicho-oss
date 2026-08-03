import {
  databaseFor,
  enrollmentsInCascade as enrollmentsTable,
  eventsInCascade as eventsTable,
  funnel_stepsInCascade as stepsTable,
  sendsInCascade as sendsTable,
  stage_daily_statsInCascade as stageDailyStatsTable,
} from "@content-automation/database";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import type { Pool } from "pg";

/** Aggregate one day of events into stage_daily_stats. Re-runnable. */
export async function runDailyRollup(pool: Pool, day: string): Promise<void> {
  const db = databaseFor(pool);
  await db.insert(stageDailyStatsTable).select(
    db.select({
      day: sql<string>`${day}::date`.as("day"),
      funnel_id: enrollmentsTable.funnel_id,
      step_id: sendsTable.step_id,
      sends: sql<number>`count(*) filter (where ${eventsTable.type} = 'sent')::int`.as("sends"),
      opens: sql<number>`count(*) filter (where ${eventsTable.type} = 'open')::int`.as("opens"),
      clicks: sql<number>`count(*) filter (where ${eventsTable.type} = 'click')::int`.as("clicks"),
      interests: sql<number>`count(*) filter (where ${eventsTable.type} = 'interest')::int`.as("interests"),
      organization_id: eventsTable.organization_id,
    }).from(eventsTable)
      .innerJoin(sendsTable, eq(sendsTable.id, eventsTable.send_id))
      .innerJoin(enrollmentsTable, eq(enrollmentsTable.id, sendsTable.enrollment_id))
      .where(and(
        gte(eventsTable.occurred_at, sql`${day}::date`),
        lt(eventsTable.occurred_at, sql`${day}::date + 1`),
      ))
      .groupBy(eventsTable.organization_id, enrollmentsTable.funnel_id, sendsTable.step_id),
  ).onConflictDoUpdate({
    target: [stageDailyStatsTable.day, stageDailyStatsTable.funnel_id, stageDailyStatsTable.step_id],
    set: {
      sends: sql`excluded.sends`,
      opens: sql`excluded.opens`,
      clicks: sql`excluded.clicks`,
      interests: sql`excluded.interests`,
    },
  });
}

export interface StepMetrics {
  stepId: string;
  position: number;
  sends: number;
  opens: number;
  clicks: number;
  interests: number;
}

/** Live per-step counters for one funnel (dashboard source). */
export async function funnelMetrics(pool: Pool, funnelId: string): Promise<StepMetrics[]> {
  const rows = await databaseFor(pool).select({
    step_id: stepsTable.id,
    position: stepsTable.position,
    sends: sql<number>`count(*) filter (where ${eventsTable.type} = 'sent')::int`,
    opens: sql<number>`count(*) filter (where ${eventsTable.type} = 'open')::int`,
    clicks: sql<number>`count(*) filter (where ${eventsTable.type} = 'click')::int`,
    interests: sql<number>`count(*) filter (where ${eventsTable.type} = 'interest')::int`,
  }).from(stepsTable)
    .leftJoin(sendsTable, eq(sendsTable.step_id, stepsTable.id))
    .leftJoin(eventsTable, eq(eventsTable.send_id, sendsTable.id))
    .where(eq(stepsTable.funnel_id, funnelId))
    .groupBy(stepsTable.id, stepsTable.position)
    .orderBy(asc(stepsTable.position));
  return rows.map((r) => ({
    stepId: r.step_id,
    position: r.position,
    sends: r.sends,
    opens: r.opens,
    clicks: r.clicks,
    interests: r.interests,
  }));
}
