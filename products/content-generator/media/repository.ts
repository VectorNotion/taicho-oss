import {
  contentAssetsInPublishing as assetsTable,
  contentGenerationRunsInPublishing as runsTable,
  databaseFor,
} from "@content-automation/database";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import type { Pool } from "pg";
import type { CreativeMediaKind } from "./templates";

export type CreativeRunStatus =
  | "queued"
  | "submitted"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface CreativeGenerationRun {
  id: string;
  organizationId: string;
  draftId: string;
  templateKey: string;
  templateVersion: number;
  mediaKind: CreativeMediaKind;
  assetRole: string;
  modelKey: string;
  deploymentId: string;
  provider: "fal";
  providerRequestId: string | null;
  status: CreativeRunStatus;
  progress: number;
  input: Record<string, unknown>;
  providerResult: unknown;
  error: string | null;
  creditReservationId: string | null;
  estimatedCredits: number;
  actualCredits: number | null;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface ContentAsset {
  id: string;
  organizationId: string;
  generationRunId: string;
  outputIndex: number;
  draftId: string;
  assetRole: string;
  mediaKind: CreativeMediaKind;
  fileName: string;
  mimeType: string;
  r2Key: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  byteSize: number;
  isSelected: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function mapRun(row: typeof runsTable.$inferSelect): CreativeGenerationRun {
  return {
    id: row.id,
    organizationId: row.organization_id,
    draftId: row.draft_id,
    templateKey: row.template_key,
    templateVersion: row.template_version,
    mediaKind: row.media_kind as CreativeMediaKind,
    assetRole: row.asset_role,
    modelKey: row.model_key,
    deploymentId: row.deployment_id,
    provider: row.provider as "fal",
    providerRequestId: row.provider_request_id,
    status: row.status as CreativeRunStatus,
    progress: row.progress,
    input: row.input as Record<string, unknown>,
    providerResult: row.provider_result,
    error: row.error,
    creditReservationId: row.credit_reservation_id,
    estimatedCredits: row.estimated_credits,
    actualCredits: row.actual_credits,
    createdBy: row.created_by,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function mapAsset(row: typeof assetsTable.$inferSelect): ContentAsset {
  return {
    id: row.id,
    organizationId: row.organization_id,
    generationRunId: row.generation_run_id,
    outputIndex: row.output_index,
    draftId: row.draft_id,
    assetRole: row.asset_role,
    mediaKind: row.media_kind as CreativeMediaKind,
    fileName: row.file_name,
    mimeType: row.mime_type,
    r2Key: row.r2_key,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    byteSize: row.byte_size,
    isSelected: row.is_selected,
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createCreativeGenerationRun(pool: Pool, input: {
  organizationId: string;
  draftId: string;
  templateKey: string;
  templateVersion: number;
  mediaKind: CreativeMediaKind;
  assetRole: string;
  modelKey: string;
  deploymentId: string;
  providerInput: Record<string, unknown>;
  creditReservationId: string;
  estimatedCredits: number;
  createdBy: string;
}): Promise<CreativeGenerationRun> {
  const [row] = await databaseFor(pool)
    .insert(runsTable)
    .values({
      organization_id: input.organizationId,
      draft_id: input.draftId,
      template_key: input.templateKey,
      template_version: input.templateVersion,
      media_kind: input.mediaKind,
      asset_role: input.assetRole,
      model_key: input.modelKey,
      deployment_id: input.deploymentId,
      input: input.providerInput,
      credit_reservation_id: input.creditReservationId,
      estimated_credits: input.estimatedCredits,
      created_by: input.createdBy,
    })
    .returning();
  return mapRun(row);
}

export async function markCreativeRunSubmitted(
  pool: Pool,
  id: string,
  providerRequestId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const rows = await databaseFor(pool)
    .update(runsTable)
    .set({
      status: "submitted",
      provider_request_id: providerRequestId,
      progress: 5,
      started_at: now,
      updated_at: now,
    })
    .where(and(eq(runsTable.id, id), eq(runsTable.status, "queued")))
    .returning({ id: runsTable.id });
  return rows.length > 0;
}

export async function updateCreativeRunProgress(
  pool: Pool,
  id: string,
  status: Extract<CreativeRunStatus, "submitted" | "processing">,
  progress: number,
): Promise<void> {
  await databaseFor(pool)
    .update(runsTable)
    .set({ status, progress: Math.max(0, Math.min(99, progress)), updated_at: new Date().toISOString() })
    .where(and(eq(runsTable.id, id), inArray(runsTable.status, ["submitted", "processing"])));
}

export async function storeCreativeRunResult(pool: Pool, id: string, result: unknown): Promise<void> {
  await databaseFor(pool)
    .update(runsTable)
    .set({ provider_result: result, progress: 90, updated_at: new Date().toISOString() })
    .where(and(eq(runsTable.id, id), inArray(runsTable.status, ["submitted", "processing"])));
}

export async function transitionCreativeRunTerminal(pool: Pool, input: {
  id: string;
  from?: CreativeRunStatus[];
  status: Extract<CreativeRunStatus, "succeeded" | "failed" | "cancelled">;
  error?: string | null;
  actualCredits?: number | null;
}): Promise<boolean> {
  const now = new Date().toISOString();
  const rows = await databaseFor(pool)
    .update(runsTable)
    .set({
      status: input.status,
      progress: input.status === "succeeded" ? 100 : 0,
      error: input.error ?? null,
      actual_credits: input.actualCredits ?? null,
      completed_at: now,
      updated_at: now,
    })
    .where(and(
      eq(runsTable.id, input.id),
      inArray(runsTable.status, input.from ?? ["queued", "submitted", "processing"]),
    ))
    .returning({ id: runsTable.id });
  return rows.length > 0;
}

export async function getCreativeGenerationRun(pool: Pool, id: string): Promise<CreativeGenerationRun | null> {
  const [row] = await databaseFor(pool)
    .select()
    .from(runsTable)
    .where(eq(runsTable.id, id))
    .limit(1);
  return row ? mapRun(row) : null;
}

export async function listCreativeRunsForDraft(pool: Pool, draftId: string, limit = 20): Promise<CreativeGenerationRun[]> {
  const rows = await databaseFor(pool)
    .select()
    .from(runsTable)
    .where(eq(runsTable.draft_id, draftId))
    .orderBy(desc(runsTable.created_at))
    .limit(limit);
  return rows.map(mapRun);
}

export async function findCreativeRunControlPlane(
  adminPool: Pool,
  providerRequestId: string,
): Promise<{ id: string; organizationId: string } | null> {
  const [row] = await databaseFor(adminPool)
    .select({ id: runsTable.id, organizationId: runsTable.organization_id })
    .from(runsTable)
    .where(and(eq(runsTable.provider, "fal"), eq(runsTable.provider_request_id, providerRequestId)))
    .limit(1);
  return row ?? null;
}

export async function listCreativeRunsToReconcile(
  adminPool: Pool,
  limit = 25,
): Promise<Array<{ id: string; organizationId: string }>> {
  return databaseFor(adminPool)
    .select({ id: runsTable.id, organizationId: runsTable.organization_id })
    .from(runsTable)
    .where(and(
      inArray(runsTable.status, ["submitted", "processing"]),
      lt(runsTable.updated_at, new Date(Date.now() - 15_000).toISOString()),
    ))
    .orderBy(asc(runsTable.updated_at))
    .limit(Math.max(1, Math.min(limit, 100)));
}

export async function createContentAsset(pool: Pool, input: {
  organizationId: string;
  generationRunId: string;
  outputIndex: number;
  draftId: string;
  assetRole: string;
  mediaKind: CreativeMediaKind;
  fileName: string;
  mimeType: string;
  r2Key: string;
  width?: number;
  height?: number;
  durationMs?: number;
  byteSize: number;
  metadata?: Record<string, unknown>;
}): Promise<ContentAsset> {
  const [row] = await databaseFor(pool)
    .insert(assetsTable)
    .values({
      organization_id: input.organizationId,
      generation_run_id: input.generationRunId,
      output_index: input.outputIndex,
      draft_id: input.draftId,
      asset_role: input.assetRole,
      media_kind: input.mediaKind,
      file_name: input.fileName,
      mime_type: input.mimeType,
      r2_key: input.r2Key,
      width: input.width,
      height: input.height,
      duration_ms: input.durationMs,
      byte_size: input.byteSize,
      metadata: input.metadata ?? {},
    })
    .onConflictDoUpdate({
      target: [assetsTable.organization_id, assetsTable.generation_run_id, assetsTable.output_index],
      set: {
        file_name: input.fileName,
        mime_type: input.mimeType,
        r2_key: input.r2Key,
        width: input.width,
        height: input.height,
        duration_ms: input.durationMs,
        byte_size: input.byteSize,
        metadata: input.metadata ?? {},
        updated_at: new Date().toISOString(),
      },
    })
    .returning();
  return mapAsset(row);
}

export async function listContentAssetsForDraft(pool: Pool, draftId: string): Promise<ContentAsset[]> {
  const rows = await databaseFor(pool)
    .select()
    .from(assetsTable)
    .where(eq(assetsTable.draft_id, draftId))
    .orderBy(desc(assetsTable.created_at));
  return rows.map(mapAsset);
}

export async function getContentAsset(pool: Pool, id: string): Promise<ContentAsset | null> {
  const [row] = await databaseFor(pool)
    .select()
    .from(assetsTable)
    .where(eq(assetsTable.id, id))
    .limit(1);
  return row ? mapAsset(row) : null;
}

export async function getSelectedContentAssetForDraft(
  pool: Pool,
  draftId: string,
  roles?: readonly string[],
  mediaKinds?: readonly CreativeMediaKind[],
): Promise<ContentAsset | null> {
  const filters = [eq(assetsTable.draft_id, draftId), eq(assetsTable.is_selected, true)];
  if (roles?.length) filters.push(inArray(assetsTable.asset_role, [...roles]));
  if (mediaKinds?.length) filters.push(inArray(assetsTable.media_kind, [...mediaKinds]));
  const [row] = await databaseFor(pool)
    .select()
    .from(assetsTable)
    .where(and(...filters))
    .orderBy(desc(assetsTable.created_at))
    .limit(1);
  return row ? mapAsset(row) : null;
}

export async function selectContentAsset(pool: Pool, assetId: string): Promise<ContentAsset | null> {
  return databaseFor(pool).transaction(async (tx) => {
    const [asset] = await tx.select().from(assetsTable).where(eq(assetsTable.id, assetId)).limit(1);
    if (!asset) return null;
    await tx
      .update(assetsTable)
      .set({ is_selected: false, updated_at: new Date().toISOString() })
      .where(and(
        eq(assetsTable.draft_id, asset.draft_id),
        eq(assetsTable.asset_role, asset.asset_role),
        eq(assetsTable.is_selected, true),
      ));
    const [selected] = await tx
      .update(assetsTable)
      .set({ is_selected: true, updated_at: new Date().toISOString() })
      .where(eq(assetsTable.id, assetId))
      .returning();
    return mapAsset(selected);
  });
}
