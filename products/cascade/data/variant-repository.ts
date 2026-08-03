import {
  cascade_settingsInCascade as cascadeSettingsInCascade,
  databaseFor,
  type Database,
  emailsInCascade,
  funnel_stepsInCascade as funnelStepsInCascade,
  funnelsInCascade,
  sendsInCascade,
  variant_statsInCascade as variantStatsInCascade,
  variantsInCascade,
} from "@content-automation/database";
import { and, asc, count, desc, eq } from "drizzle-orm";
import type { Pool, PoolClient } from "pg";

type Queryable = Pool | PoolClient | Database;

function variantDatabase(source: Queryable): Database {
  return "$count" in source ? source : databaseFor(source);
}

export const MAX_ACTIVE_ARMS = 4;

export async function createVariant(
  pool: Pool,
  input: { stepId: string; emailId: string; segment?: string; generation?: number; createdBy?: string },
): Promise<{ id: string }> {
  return databaseFor(pool).transaction(async (tx) => {
    const [step] = await tx
      .select({ type: funnelStepsInCascade.type })
      .from(funnelStepsInCascade)
      .where(eq(funnelStepsInCascade.id, input.stepId))
      .limit(1);
    if (!step) throw new Error(`step ${input.stepId} not found`);
    if (step.type !== "email") throw new Error("variants can only be attached to email steps");

    const [email] = await tx
      .select({ id: emailsInCascade.id })
      .from(emailsInCascade)
      .where(eq(emailsInCascade.id, input.emailId))
      .limit(1);
    if (!email) throw new Error(`email ${input.emailId} not found`);

    const [created] = await tx
      .insert(variantsInCascade)
      .values({
        step_id: input.stepId,
        email_id: input.emailId,
        segment: input.segment ?? "all",
        generation: input.generation ?? 1,
        created_by: input.createdBy ?? "human",
      })
      .returning({ id: variantsInCascade.id });
    await tx.insert(variantStatsInCascade).values({ variant_id: created.id });
    return created;
  });
}

export async function markValidated(pool: Pool, variantId: string): Promise<void> {
  await databaseFor(pool)
    .update(variantsInCascade)
    .set({ status: "validated", validation_error: null })
    .where(and(eq(variantsInCascade.id, variantId), eq(variantsInCascade.status, "draft")));
}

export async function markRejected(pool: Pool, variantId: string, error: string): Promise<void> {
  await databaseFor(pool)
    .update(variantsInCascade)
    .set({ validation_error: error })
    .where(and(eq(variantsInCascade.id, variantId), eq(variantsInCascade.status, "draft")));
}

/**
 * Activate a validated variant. Enforces the hard cap of MAX_ACTIVE_ARMS
 * active arms per (step, segment) — the bandit needs concentration, not
 * breadth, at current scale.
 */
export async function activateVariant(pool: Pool, variantId: string): Promise<void> {
  await databaseFor(pool).transaction(async (tx) => {
    const [variant] = await tx
      .select({
        stepId: variantsInCascade.step_id,
        segment: variantsInCascade.segment,
        status: variantsInCascade.status,
      })
      .from(variantsInCascade)
      .where(eq(variantsInCascade.id, variantId))
      .for("update")
      .limit(1);
    if (!variant) throw new Error(`variant ${variantId} not found`);
    if (variant.status !== "validated") {
      throw new Error(`variant ${variantId} is '${variant.status}', only validated variants can activate`);
    }
    const [active] = await tx
      .select({ n: count() })
      .from(variantsInCascade)
      .where(
        and(
          eq(variantsInCascade.step_id, variant.stepId),
          eq(variantsInCascade.segment, variant.segment),
          eq(variantsInCascade.status, "active"),
        ),
      );
    if (active.n >= MAX_ACTIVE_ARMS) {
      throw new Error(`arm cap exceeded: ${MAX_ACTIVE_ARMS} variants already active for this step/segment`);
    }
    await tx.update(variantsInCascade).set({ status: "active" }).where(eq(variantsInCascade.id, variantId));
  });
}

export async function retireVariant(pool: Pool, variantId: string): Promise<void> {
  const db = databaseFor(pool);
  const retired = await db
    .update(variantsInCascade)
    .set({ status: "retired" })
    .where(and(eq(variantsInCascade.id, variantId), eq(variantsInCascade.status, "active")))
    .returning({ id: variantsInCascade.id });
  if (retired.length > 0) return;
  const [existing] = await db
    .select({ status: variantsInCascade.status })
    .from(variantsInCascade)
    .where(eq(variantsInCascade.id, variantId))
    .limit(1);
  if (!existing) throw new Error(`variant ${variantId} not found`);
  throw new Error(`variant ${variantId} is '${existing.status}', only active variants can retire`);
}

/**
 * Detach a variant from a funnel step without erasing delivery history.
 *
 * Only variants which have never been sent can be detached. Active variants
 * must first be retired so callers cannot accidentally remove a live bandit
 * arm from rotation.
 */
export async function deleteVariant(pool: Pool, variantId: string): Promise<void> {
  await databaseFor(pool).transaction(async (tx) => {
    const [variant] = await tx
      .select({ status: variantsInCascade.status })
      .from(variantsInCascade)
      .where(eq(variantsInCascade.id, variantId))
      .for("update")
      .limit(1);
    if (!variant) throw new Error(`variant ${variantId} not found`);
    if (variant.status === "active") {
      throw new Error("active variants must be retired before they can be detached");
    }

    const [sent] = await tx
      .select({ id: sendsInCascade.id })
      .from(sendsInCascade)
      .where(eq(sendsInCascade.variant_id, variantId))
      .limit(1);
    if (sent) {
      throw new Error("variants with send history cannot be detached");
    }

    await tx.delete(variantStatsInCascade).where(eq(variantStatsInCascade.variant_id, variantId));
    await tx.delete(variantsInCascade).where(eq(variantsInCascade.id, variantId));
  });
}

export interface ActiveArm {
  id: string;
  emailId: string;
  generation: number;
  sends: number;
  interests: number;
}

export async function listActiveVariants(
  db: Queryable,
  stepId: string,
  segment = "all",
): Promise<ActiveArm[]> {
  const rows = await variantDatabase(db)
    .select({
      id: variantsInCascade.id,
      emailId: variantsInCascade.email_id,
      generation: variantsInCascade.generation,
      sends: variantStatsInCascade.sends,
      interests: variantStatsInCascade.interests,
    })
    .from(variantsInCascade)
    .innerJoin(variantStatsInCascade, eq(variantStatsInCascade.variant_id, variantsInCascade.id))
    .where(
      and(
        eq(variantsInCascade.step_id, stepId),
        eq(variantsInCascade.segment, segment),
        eq(variantsInCascade.status, "active"),
      ),
    )
    .orderBy(asc(variantsInCascade.created_at));
  return rows.map((r) => ({
    id: r.id,
    emailId: r.emailId,
    generation: r.generation,
    sends: r.sends,
    interests: r.interests,
  }));
}

export interface VariantDetail {
  id: string;
  funnelName: string;
  position: number;
  status: string;
  generation: number;
  createdBy: string;
  emailName: string;
  validationError: string | null;
  sends: number;
  opens: number;
  clicks: number;
  interests: number;
}

export async function listVariantsDetailed(pool: Pool): Promise<VariantDetail[]> {
  const rows = await databaseFor(pool)
    .select({
      id: variantsInCascade.id,
      funnelName: funnelsInCascade.name,
      position: funnelStepsInCascade.position,
      status: variantsInCascade.status,
      generation: variantsInCascade.generation,
      createdBy: variantsInCascade.created_by,
      emailName: emailsInCascade.name,
      validationError: variantsInCascade.validation_error,
      sends: variantStatsInCascade.sends,
      opens: variantStatsInCascade.opens,
      clicks: variantStatsInCascade.clicks,
      interests: variantStatsInCascade.interests,
    })
    .from(variantsInCascade)
    .innerJoin(variantStatsInCascade, eq(variantStatsInCascade.variant_id, variantsInCascade.id))
    .innerJoin(funnelStepsInCascade, eq(funnelStepsInCascade.id, variantsInCascade.step_id))
    .innerJoin(funnelsInCascade, eq(funnelsInCascade.id, funnelStepsInCascade.funnel_id))
    .innerJoin(emailsInCascade, eq(emailsInCascade.id, variantsInCascade.email_id))
    .orderBy(desc(variantsInCascade.created_at));
  return rows.map((r) => ({
    id: r.id,
    funnelName: r.funnelName,
    position: r.position,
    status: r.status,
    generation: r.generation,
    createdBy: r.createdBy,
    emailName: r.emailName,
    validationError: r.validationError,
    sends: r.sends,
    opens: r.opens,
    clicks: r.clicks,
    interests: r.interests,
  }));
}

export async function getSetting<T>(pool: Pool, key: string, fallback: T): Promise<T> {
  const [setting] = await databaseFor(pool)
    .select({ value: cascadeSettingsInCascade.value })
    .from(cascadeSettingsInCascade)
    .where(eq(cascadeSettingsInCascade.key, key))
    .limit(1);
  return setting ? (setting.value as T) : fallback;
}

export async function setSetting(pool: Pool, key: string, value: unknown): Promise<void> {
  await databaseFor(pool)
    .insert(cascadeSettingsInCascade)
    .values({ key, value })
    .onConflictDoUpdate({
      target: [cascadeSettingsInCascade.organization_id, cascadeSettingsInCascade.key],
      set: { value },
    });
}
