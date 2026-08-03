import {
  databaseFor,
  emailsInCascade,
  enrollmentsInCascade,
  funnel_routesInCascade as funnelRoutesInCascade,
  funnel_stepsInCascade as funnelStepsInCascade,
  funnelsInCascade,
  sendsInCascade,
  variantsInCascade,
} from "@content-automation/database";
import { and, asc, count, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import type { Pool } from "pg";
import type {
  Funnel,
  FunnelStep,
  RouteOutcome,
  StepInput,
  StepType,
} from "../domain/types";

export interface FunnelBuilderPosition {
  x: number;
  y: number;
}

export interface FunnelWorkflowStepInput {
  clientId: string;
  id?: string;
  type: StepType;
  config: StepInput["config"];
  position: FunnelBuilderPosition;
}

export interface FunnelWorkflowRouteInput {
  outcome: RouteOutcome;
  toFunnelId: string;
  position: FunnelBuilderPosition;
}

export interface SaveFunnelWorkflowInput {
  expectedVersion: number;
  steps: FunnelWorkflowStepInput[];
  routes: FunnelWorkflowRouteInput[];
}

export interface SaveFunnelWorkflowResult {
  version: number;
  stepIds: Record<string, string>;
}

function emailIdFromConfig(config: StepInput["config"]): string | null {
  return "emailId" in config ? config.emailId : null;
}

/**
 * Atomically persist the complete visual Funnel workflow.
 *
 * Array order is execution order. Existing step IDs are retained so sends,
 * variants, and active enrollment cursors keep their audit identity. New nodes
 * receive database IDs; omitted nodes are removed only when history permits it.
 */
export async function saveFunnelWorkflow(
  pool: Pool,
  funnelId: string,
  input: SaveFunnelWorkflowInput,
): Promise<SaveFunnelWorkflowResult> {
  return databaseFor(pool).transaction(async (tx) => {
    const [funnel] = await tx
      .select({ version: funnelsInCascade.version, openEnded: funnelsInCascade.open_ended })
      .from(funnelsInCascade)
      .where(eq(funnelsInCascade.id, funnelId))
      .for("update")
      .limit(1);
    if (!funnel) throw new Error("funnel not found");
    if (funnel.version !== input.expectedVersion) {
      throw new Error(
        `funnel changed since it was opened (expected version ${input.expectedVersion}, current version ${funnel.version})`,
      );
    }

    const clientIds = new Set<string>();
    const requestedIds = new Set<string>();
    for (const step of input.steps) {
      if (clientIds.has(step.clientId)) {
        throw new Error(`duplicate workflow node ${step.clientId}`);
      }
      clientIds.add(step.clientId);
      if (step.id) {
        if (requestedIds.has(step.id)) {
          throw new Error(`duplicate funnel step ${step.id}`);
        }
        requestedIds.add(step.id);
      }
    }
    const routeOutcomes = new Set<RouteOutcome>();
    for (const route of input.routes) {
      if (routeOutcomes.has(route.outcome)) {
        throw new Error(`duplicate ${route.outcome} route`);
      }
      if (route.toFunnelId === funnelId) {
        throw new Error("a funnel cannot route to itself");
      }
      routeOutcomes.add(route.outcome);
    }

    const existing = await tx
      .select({
        id: funnelStepsInCascade.id,
        position: funnelStepsInCascade.position,
        type: funnelStepsInCascade.type,
      })
      .from(funnelStepsInCascade)
      .where(eq(funnelStepsInCascade.funnel_id, funnelId))
      .orderBy(asc(funnelStepsInCascade.position))
      .for("update");
    const existingById = new Map(existing.map((step) => [step.id, step]));
    for (const step of input.steps) {
      if (!step.id) continue;
      const stored = existingById.get(step.id);
      if (!stored) throw new Error(`step ${step.id} is not part of this funnel`);
      if (stored.type !== step.type) {
        throw new Error("an existing funnel step cannot change type");
      }
    }

    const removed = existing.filter((step) => !requestedIds.has(step.id));
    if (removed.length > 0) {
      const removedIds = removed.map((step) => step.id);
      const [sendHistory] = await tx
        .select({ n: count() })
        .from(sendsInCascade)
        .where(inArray(sendsInCascade.step_id, removedIds));
      if (sendHistory.n > 0) {
        throw new Error(
          "step has send history and cannot be deleted; edit its content instead",
        );
      }
      const [attachedVariants] = await tx
        .select({ n: count() })
        .from(variantsInCascade)
        .where(inArray(variantsInCascade.step_id, removedIds));
      if (attachedVariants.n > 0) {
        throw new Error(
          "step has variants attached; retire and detach them first",
        );
      }
    }

    const emailIds = [
      ...new Set(
        input.steps
          .map((step) => emailIdFromConfig(step.config))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (emailIds.length > 0) {
      const emails = await tx
        .select({ id: emailsInCascade.id })
        .from(emailsInCascade)
        .where(inArray(emailsInCascade.id, emailIds));
      if (emails.length !== emailIds.length) {
        throw new Error("library message not found");
      }
    }
    const targetIds = [...new Set(input.routes.map((route) => route.toFunnelId))];
    if (targetIds.length > 0) {
      const targets = await tx
        .select({ id: funnelsInCascade.id })
        .from(funnelsInCascade)
        .where(inArray(funnelsInCascade.id, targetIds));
      if (targets.length !== targetIds.length) {
        throw new Error("route target funnel not found");
      }
    }

    // Move stored positions out of the way before applying the new contiguous
    // order. IDs and foreign-key references remain stable throughout.
    if (existing.length > 0) {
      const offset = existing.length + input.steps.length + 1000;
      await tx
        .update(funnelStepsInCascade)
        .set({ position: sql`${funnelStepsInCascade.position} + ${offset}` })
        .where(eq(funnelStepsInCascade.funnel_id, funnelId));
    }

    const stepIds = Object.create(null) as Record<string, string>;
    for (const [index, step] of input.steps.entries()) {
      const position = index + 1;
      if (step.id) {
        await tx
          .update(funnelStepsInCascade)
          .set({ position, config: step.config })
          .where(and(eq(funnelStepsInCascade.funnel_id, funnelId), eq(funnelStepsInCascade.id, step.id)));
        stepIds[step.clientId] = step.id;
      } else {
        const [inserted] = await tx
          .insert(funnelStepsInCascade)
          .values({ funnel_id: funnelId, position, type: step.type, config: step.config })
          .returning({ id: funnelStepsInCascade.id });
        stepIds[step.clientId] = inserted.id;
      }
    }

    // An enrollment parked on a removed node advances to the node occupying the
    // same ordinal slot in the new workflow, or completes/frontier-parks when
    // there is no successor.
    for (const removedStep of removed) {
      const successor = input.steps[removedStep.position - 1];
      const successorId = successor ? stepIds[successor.clientId] : null;
      if (successorId) {
        await tx
          .update(enrollmentsInCascade)
          .set({ current_step_id: successorId, updated_at: sql`now()` })
          .where(eq(enrollmentsInCascade.current_step_id, removedStep.id));
      } else if (funnel.openEnded) {
        await tx
          .update(enrollmentsInCascade)
          .set({ current_step_id: null, next_run_at: sql`'infinity'::timestamptz`, updated_at: sql`now()` })
          .where(eq(enrollmentsInCascade.current_step_id, removedStep.id));
      } else {
        await tx
          .update(enrollmentsInCascade)
          .set({ current_step_id: null, state: "completed", updated_at: sql`now()` })
          .where(eq(enrollmentsInCascade.current_step_id, removedStep.id));
      }
    }
    if (removed.length > 0) {
      await tx.delete(funnelStepsInCascade).where(inArray(funnelStepsInCascade.id, removed.map((step) => step.id)));
    }

    await tx.delete(funnelRoutesInCascade).where(eq(funnelRoutesInCascade.from_funnel_id, funnelId));
    if (input.routes.length > 0) {
      await tx.insert(funnelRoutesInCascade).values(
        input.routes.map((route) => ({
          from_funnel_id: funnelId,
          outcome: route.outcome,
          to_funnel_id: route.toFunnelId,
        })),
      );
    }

    const layout = {
      version: 1,
      positions: Object.fromEntries([
        ...input.steps.map((step) => [
          stepIds[step.clientId],
          step.position,
        ]),
        ...input.routes.map((route) => [
          `route:${route.outcome}`,
          route.position,
        ]),
      ]),
    };
    const [updated] = await tx
      .update(funnelsInCascade)
      .set({ version: sql`${funnelsInCascade.version} + 1`, builder_layout: layout })
      .where(eq(funnelsInCascade.id, funnelId))
      .returning({ version: funnelsInCascade.version });
    return { version: updated.version, stepIds };
  });
}

export async function createFunnel(
  pool: Pool,
  input: { name: string; steps: StepInput[]; openEnded?: boolean },
): Promise<{ funnel: Funnel; steps: FunnelStep[] }> {
  return databaseFor(pool).transaction(async (tx) => {
    const [row] = await tx
      .insert(funnelsInCascade)
      .values({ name: input.name, open_ended: input.openEnded ?? false })
      .returning({
        id: funnelsInCascade.id,
        name: funnelsInCascade.name,
        version: funnelsInCascade.version,
        openEnded: funnelsInCascade.open_ended,
      });
    const funnel: Funnel = row;
    const created = input.steps.length
      ? await tx
          .insert(funnelStepsInCascade)
          .values(
            input.steps.map((step, index) => ({
              funnel_id: funnel.id,
              position: index + 1,
              type: step.type,
              config: step.config,
            })),
          )
          .returning({
            id: funnelStepsInCascade.id,
            position: funnelStepsInCascade.position,
            type: funnelStepsInCascade.type,
            config: funnelStepsInCascade.config,
          })
      : [];
    return {
      funnel,
      steps: created.map((step) => ({
        id: step.id,
        funnelId: funnel.id,
        position: step.position,
        type: step.type as StepType,
        config: step.config as FunnelStep["config"],
      })),
    };
  });
}

/**
 * Append a step at the end of a funnel and wake enrollments waiting at the
 * frontier (open-ended queues: the newsletter pattern).
 */
export async function appendFunnelStep(pool: Pool, funnelId: string, step: StepInput): Promise<FunnelStep> {
  return databaseFor(pool).transaction(async (tx) => {
    const [funnel] = await tx
      .select({ id: funnelsInCascade.id })
      .from(funnelsInCascade)
      .where(eq(funnelsInCascade.id, funnelId))
      .for("update")
      .limit(1);
    if (!funnel) throw new Error("funnel not found");
    if ("emailId" in step.config) {
      const [email] = await tx
        .select({ id: emailsInCascade.id })
        .from(emailsInCascade)
        .where(eq(emailsInCascade.id, step.config.emailId))
        .limit(1);
      if (!email) throw new Error("library message not found");
    }
    const [positionRow] = await tx
      .select({ position: sql<number>`coalesce(max(${funnelStepsInCascade.position}), 0) + 1` })
      .from(funnelStepsInCascade)
      .where(eq(funnelStepsInCascade.funnel_id, funnelId));
    const [row] = await tx
      .insert(funnelStepsInCascade)
      .values({ funnel_id: funnelId, position: positionRow.position, type: step.type, config: step.config })
      .returning({
        id: funnelStepsInCascade.id,
        position: funnelStepsInCascade.position,
        type: funnelStepsInCascade.type,
        config: funnelStepsInCascade.config,
      });
    await tx
      .update(enrollmentsInCascade)
      .set({ current_step_id: row.id, next_run_at: sql`now()`, updated_at: sql`now()` })
      .where(
        and(
          eq(enrollmentsInCascade.funnel_id, funnelId),
          eq(enrollmentsInCascade.state, "active"),
          sql`${enrollmentsInCascade.current_step_id} is null`,
        ),
      );
    return {
      id: row.id,
      funnelId,
      position: row.position,
      type: row.type as StepType,
      config: row.config as FunnelStep["config"],
    };
  });
}

/** Update an existing step's config. The step keeps its type and position. */
export async function updateFunnelStep(
  pool: Pool,
  stepId: string,
  config: StepInput["config"],
): Promise<void> {
  const db = databaseFor(pool);
  if ("emailId" in config) {
    const [email] = await db
      .select({ id: emailsInCascade.id })
      .from(emailsInCascade)
      .where(eq(emailsInCascade.id, config.emailId))
      .limit(1);
    if (!email) throw new Error("library message not found");
  }
  const updated = await db
    .update(funnelStepsInCascade)
    .set({ config })
    .where(eq(funnelStepsInCascade.id, stepId))
    .returning({ id: funnelStepsInCascade.id });
  if (updated.length === 0) throw new Error("step not found");
}

/**
 * Delete a step, safely for the running engine:
 * - refuses when the step has send history or attached variants (audit trail);
 * - enrollments currently at the step move to the following step (or complete /
 *   park at the frontier when it was the last one);
 * - later positions renumber to stay contiguous.
 * Returns a warning when the funnel contains branch steps, whose position
 * references are not rewritten automatically.
 */
export async function deleteFunnelStep(pool: Pool, stepId: string): Promise<{ warning: string | null }> {
  return databaseFor(pool).transaction(async (tx) => {
    const [step] = await tx
      .select({
        funnelId: funnelStepsInCascade.funnel_id,
        position: funnelStepsInCascade.position,
        openEnded: funnelsInCascade.open_ended,
      })
      .from(funnelStepsInCascade)
      .innerJoin(funnelsInCascade, eq(funnelsInCascade.id, funnelStepsInCascade.funnel_id))
      .where(eq(funnelStepsInCascade.id, stepId))
      .for("update")
      .limit(1);
    if (!step) throw new Error("step not found");

    const [sends] = await tx
      .select({ n: count() })
      .from(sendsInCascade)
      .where(eq(sendsInCascade.step_id, stepId));
    if (sends.n > 0) {
      throw new Error("step has send history and cannot be deleted; edit its content instead");
    }
    const [variants] = await tx
      .select({ n: count() })
      .from(variantsInCascade)
      .where(eq(variantsInCascade.step_id, stepId));
    if (variants.n > 0) {
      throw new Error("step has variants attached; retire and detach them first");
    }

    // Move enrollments sitting on this step to the next one, or finish them.
    const [next] = await tx
      .select({ id: funnelStepsInCascade.id })
      .from(funnelStepsInCascade)
      .where(
        and(
          eq(funnelStepsInCascade.funnel_id, step.funnelId),
          eq(funnelStepsInCascade.position, step.position + 1),
        ),
      )
      .limit(1);
    if (next) {
      await tx
        .update(enrollmentsInCascade)
        .set({ current_step_id: next.id, updated_at: sql`now()` })
        .where(eq(enrollmentsInCascade.current_step_id, stepId));
    } else if (step.openEnded) {
      await tx
        .update(enrollmentsInCascade)
        .set({ current_step_id: null, next_run_at: sql`'infinity'::timestamptz`, updated_at: sql`now()` })
        .where(eq(enrollmentsInCascade.current_step_id, stepId));
    } else {
      await tx
        .update(enrollmentsInCascade)
        .set({ current_step_id: null, state: "completed", updated_at: sql`now()` })
        .where(eq(enrollmentsInCascade.current_step_id, stepId));
    }

    await tx.delete(funnelStepsInCascade).where(eq(funnelStepsInCascade.id, stepId));
    // Two-phase renumber to avoid transient unique(funnel_id, position)
    // clashes while respecting the position > 0 check constraint.
    const [upper] = await tx
      .select({ maxPosition: sql<number>`coalesce(max(${funnelStepsInCascade.position}), 0)::int` })
      .from(funnelStepsInCascade)
      .where(eq(funnelStepsInCascade.funnel_id, step.funnelId));
    const offset = upper.maxPosition + 1;
    await tx
      .update(funnelStepsInCascade)
      .set({ position: sql`${funnelStepsInCascade.position} + ${offset}` })
      .where(
        and(
          eq(funnelStepsInCascade.funnel_id, step.funnelId),
          gt(funnelStepsInCascade.position, step.position),
        ),
      );
    await tx
      .update(funnelStepsInCascade)
      .set({ position: sql`${funnelStepsInCascade.position} - ${offset} - 1` })
      .where(
        and(
          eq(funnelStepsInCascade.funnel_id, step.funnelId),
          gt(funnelStepsInCascade.position, offset),
        ),
      );

    const [branches] = await tx
      .select({ n: count() })
      .from(funnelStepsInCascade)
      .where(and(eq(funnelStepsInCascade.funnel_id, step.funnelId), eq(funnelStepsInCascade.type, "branch")));
    return {
      warning:
        branches.n > 0
          ? "This funnel has branch steps; review their then/else step numbers after the renumbering."
          : null,
    };
  });
}

export async function deleteFunnelRoute(pool: Pool, fromFunnelId: string, outcome: RouteOutcome): Promise<void> {
  await databaseFor(pool)
    .delete(funnelRoutesInCascade)
    .where(and(eq(funnelRoutesInCascade.from_funnel_id, fromFunnelId), eq(funnelRoutesInCascade.outcome, outcome)));
}

/** Delete a funnel that has never been used (no enrollments, no variants). */
export async function deleteFunnel(pool: Pool, funnelId: string): Promise<void> {
  await databaseFor(pool).transaction(async (tx) => {
    const [enrollments] = await tx
      .select({ n: count() })
      .from(enrollmentsInCascade)
      .where(eq(enrollmentsInCascade.funnel_id, funnelId));
    if (enrollments.n > 0) {
      throw new Error("funnel has enrollment history and cannot be deleted");
    }
    const [variants] = await tx
      .select({ n: count() })
      .from(variantsInCascade)
      .innerJoin(funnelStepsInCascade, eq(funnelStepsInCascade.id, variantsInCascade.step_id))
      .where(eq(funnelStepsInCascade.funnel_id, funnelId));
    if (variants.n > 0) {
      throw new Error("funnel steps have variants attached; detach them first");
    }
    await tx
      .delete(funnelRoutesInCascade)
      .where(or(eq(funnelRoutesInCascade.from_funnel_id, funnelId), eq(funnelRoutesInCascade.to_funnel_id, funnelId)));
    const deleted = await tx
      .delete(funnelsInCascade)
      .where(eq(funnelsInCascade.id, funnelId))
      .returning({ id: funnelsInCascade.id });
    if (deleted.length === 0) throw new Error("funnel not found");
  });
}

export interface FunnelSummary {
  id: string;
  name: string;
  openEnded: boolean;
  active: number;
  atFrontier: number;
  completed: number;
  stopped: number;
}

export async function listFunnels(pool: Pool): Promise<FunnelSummary[]> {
  const rows = await databaseFor(pool)
    .select({
      id: funnelsInCascade.id,
      name: funnelsInCascade.name,
      openEnded: funnelsInCascade.open_ended,
      active: sql<number>`count(*) filter (where ${enrollmentsInCascade.state} = 'active')::int`,
      atFrontier: sql<number>`count(*) filter (where ${enrollmentsInCascade.state} = 'active' and ${enrollmentsInCascade.current_step_id} is null)::int`,
      completed: sql<number>`count(*) filter (where ${enrollmentsInCascade.state} = 'completed')::int`,
      stopped: sql<number>`count(*) filter (where ${enrollmentsInCascade.state} = 'stopped')::int`,
    })
    .from(funnelsInCascade)
    .leftJoin(enrollmentsInCascade, eq(enrollmentsInCascade.funnel_id, funnelsInCascade.id))
    .groupBy(funnelsInCascade.id)
    .orderBy(desc(funnelsInCascade.created_at));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    openEnded: r.openEnded,
    active: r.active,
    atFrontier: r.atFrontier,
    completed: r.completed,
    stopped: r.stopped,
  }));
}

export interface FunnelDetail {
  funnel: Funnel;
  steps: FunnelStep[];
  routes: Array<{ outcome: RouteOutcome; toFunnelId: string; toFunnelName: string }>;
  builderLayout: {
    version?: number;
    positions?: Record<string, FunnelBuilderPosition>;
  };
}

export async function getFunnelDetail(pool: Pool, funnelId: string): Promise<FunnelDetail | null> {
  const db = databaseFor(pool);
  const [funnel] = await db
    .select({
      id: funnelsInCascade.id,
      name: funnelsInCascade.name,
      version: funnelsInCascade.version,
      openEnded: funnelsInCascade.open_ended,
      builderLayout: funnelsInCascade.builder_layout,
    })
    .from(funnelsInCascade)
    .where(eq(funnelsInCascade.id, funnelId))
    .limit(1);
  if (!funnel) return null;
  const steps = await db
    .select({
      id: funnelStepsInCascade.id,
      position: funnelStepsInCascade.position,
      type: funnelStepsInCascade.type,
      config: funnelStepsInCascade.config,
    })
    .from(funnelStepsInCascade)
    .where(eq(funnelStepsInCascade.funnel_id, funnelId))
    .orderBy(asc(funnelStepsInCascade.position));
  const targetFunnel = db.$with("target_funnel").as(
    db.select({ id: funnelsInCascade.id, name: funnelsInCascade.name }).from(funnelsInCascade),
  );
  const routes = await db
    .with(targetFunnel)
    .select({
      outcome: funnelRoutesInCascade.outcome,
      toFunnelId: funnelRoutesInCascade.to_funnel_id,
      toFunnelName: targetFunnel.name,
    })
    .from(funnelRoutesInCascade)
    .innerJoin(targetFunnel, eq(targetFunnel.id, funnelRoutesInCascade.to_funnel_id))
    .where(eq(funnelRoutesInCascade.from_funnel_id, funnelId))
    .orderBy(asc(funnelRoutesInCascade.outcome));
  return {
    funnel: {
      id: funnel.id,
      name: funnel.name,
      version: funnel.version,
      openEnded: funnel.openEnded,
    },
    steps: steps.map((s) => ({
      id: s.id,
      funnelId,
      position: s.position,
      type: s.type as StepType,
      config: s.config as FunnelStep["config"],
    })),
    routes: routes.map((r) => ({
      outcome: r.outcome as RouteOutcome,
      toFunnelId: r.toFunnelId,
      toFunnelName: r.toFunnelName,
    })),
    builderLayout: (funnel.builderLayout ?? {}) as FunnelDetail["builderLayout"],
  };
}

export async function listEmailSteps(
  pool: Pool,
): Promise<Array<{ stepId: string; funnelName: string; position: number }>> {
  return databaseFor(pool)
    .select({
      stepId: funnelStepsInCascade.id,
      funnelName: funnelsInCascade.name,
      position: funnelStepsInCascade.position,
    })
    .from(funnelStepsInCascade)
    .innerJoin(funnelsInCascade, eq(funnelsInCascade.id, funnelStepsInCascade.funnel_id))
    .where(eq(funnelStepsInCascade.type, "email"))
    .orderBy(desc(funnelsInCascade.created_at), asc(funnelStepsInCascade.position));
}

export async function setFunnelRoute(
  pool: Pool,
  fromFunnelId: string,
  outcome: RouteOutcome,
  toFunnelId: string,
): Promise<void> {
  if (fromFunnelId === toFunnelId) {
    throw new Error("a funnel cannot route to itself");
  }
  await databaseFor(pool)
    .insert(funnelRoutesInCascade)
    .values({ from_funnel_id: fromFunnelId, outcome, to_funnel_id: toFunnelId })
    .onConflictDoUpdate({
      target: [funnelRoutesInCascade.from_funnel_id, funnelRoutesInCascade.outcome],
      set: { to_funnel_id: toFunnelId },
    });
}
