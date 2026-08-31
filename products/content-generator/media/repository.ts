import {
  contentAssetsInPublishing as assetsTable,
  contentGenerationRunsInPublishing as runsTable,
  contentPostMediaInPublishing as linksTable,
  databaseFor,
} from "@content-automation/database";
import { and, asc, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { Pool } from "pg";
import { visualBriefSchema, type CreativeMediaKind, type VisualBrief, type VisualType } from "./templates";

export type CreativeRunStatus = "preparing" | "queued" | "submitted" | "processing" | "succeeded" | "failed" | "cancelled";
// Renderer/local values remain readable only for historical rows. New runs are
// constrained to the configured external generation provider below.
export type MediaProvider = "openrouter" | "fal" | "renderer" | "local";

export interface CreativeGenerationRun {
  id: string;
  organizationId: string;
  contentBaseId: string | null;
  originPostId: string | null;
  parentAssetId: string | null;
  legacyDraftId: string | null;
  templateKey: string;
  templateVersion: number;
  mediaKind: CreativeMediaKind;
  visualType: VisualType;
  assetRole: string;
  visualBrief: VisualBrief;
  compiledPrompt: string;
  negativePrompt: string | null;
  renderSpec: Record<string, unknown> | null;
  rendererVersion: string | null;
  modelKey: string | null;
  deploymentId: string | null;
  provider: MediaProvider | null;
  providerParams: Record<string, unknown>;
  providerRequestId: string | null;
  providerRequestUrl: string | null;
  providerStatusUrl: string | null;
  providerResultUrl: string | null;
  providerCancelUrl: string | null;
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
  contentBaseId: string | null;
  originPostId: string | null;
  parentAssetId: string | null;
  legacyDraftId: string | null;
  assetRole: string;
  mediaKind: CreativeMediaKind;
  visualType: VisualType;
  fileName: string;
  mimeType: string;
  r2Key: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  byteSize: number;
  description: string;
  altText: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PostMediaLink {
  id: string;
  organizationId: string;
  postId: string;
  assetId: string;
  role: string;
  position: number;
  createdBy: string | null;
  createdAt: string;
  asset: ContentAsset;
}

function isoTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Media persistence returned an invalid timestamp.");
  return date.toISOString();
}

function nullableIsoTimestamp(value: string | Date | null): string | null {
  return value === null ? null : isoTimestamp(value);
}

export function normalizeStoredVisualBrief(value: unknown): VisualBrief {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const stored = value as Record<string, unknown>;
    if (typeof stored.creativeDirection === "string" && stored.creativeDirection.length > 2_000) {
      return visualBriefSchema.parse({
        ...stored,
        creativeDirection: stored.creativeDirection.slice(0, 2_000),
      });
    }
  }
  return visualBriefSchema.parse(value);
}

function mapRun(row: typeof runsTable.$inferSelect): CreativeGenerationRun {
  return {
    id: row.id, organizationId: row.organization_id, contentBaseId: row.content_base_id,
    originPostId: row.origin_post_id, parentAssetId: row.parent_asset_id, legacyDraftId: row.draft_id,
    templateKey: row.template_key, templateVersion: row.template_version,
    mediaKind: row.media_kind as CreativeMediaKind, visualType: row.visual_type as VisualType,
    assetRole: row.asset_role, visualBrief: normalizeStoredVisualBrief(row.visual_brief),
    compiledPrompt: row.compiled_prompt, negativePrompt: row.negative_prompt,
    renderSpec: row.render_spec as Record<string, unknown> | null, rendererVersion: row.renderer_version,
    modelKey: row.model_key, deploymentId: row.deployment_id, provider: row.provider as MediaProvider | null,
    providerParams: row.provider_params as Record<string, unknown>, providerRequestId: row.provider_request_id,
    providerRequestUrl: row.provider_request_url, providerStatusUrl: row.provider_status_url,
    providerResultUrl: row.provider_result_url, providerCancelUrl: row.provider_cancel_url,
    status: row.status as CreativeRunStatus, progress: row.progress,
    input: row.input as Record<string, unknown>, providerResult: row.provider_result, error: row.error,
    creditReservationId: row.credit_reservation_id, estimatedCredits: row.estimated_credits,
    actualCredits: row.actual_credits, createdBy: row.created_by, createdAt: isoTimestamp(row.created_at),
    startedAt: nullableIsoTimestamp(row.started_at), completedAt: nullableIsoTimestamp(row.completed_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function mapAsset(row: typeof assetsTable.$inferSelect): ContentAsset {
  return {
    id: row.id, organizationId: row.organization_id, generationRunId: row.generation_run_id,
    outputIndex: row.output_index, contentBaseId: row.content_base_id, originPostId: row.origin_post_id,
    parentAssetId: row.parent_asset_id, legacyDraftId: row.draft_id, assetRole: row.asset_role,
    mediaKind: row.media_kind as CreativeMediaKind, visualType: row.visual_type as VisualType,
    fileName: row.file_name, mimeType: row.mime_type, r2Key: row.r2_key,
    width: row.width, height: row.height, durationMs: row.duration_ms, byteSize: row.byte_size,
    description: row.description, altText: row.alt_text, metadata: row.metadata as Record<string, unknown>,
    createdAt: isoTimestamp(row.created_at), updatedAt: isoTimestamp(row.updated_at),
  };
}

function mapLink(row: typeof linksTable.$inferSelect, asset: typeof assetsTable.$inferSelect): PostMediaLink {
  return {
    id: row.id, organizationId: row.organization_id, postId: row.post_id, assetId: row.asset_id,
    role: row.role, position: row.position, createdBy: row.created_by, createdAt: isoTimestamp(row.created_at),
    asset: mapAsset(asset),
  };
}

export async function createCreativeGenerationRun(pool: Pool, input: {
  organizationId: string; contentBaseId: string; originPostId?: string; parentAssetId?: string;
  mediaKind: CreativeMediaKind; visualType: VisualType; visualBrief: VisualBrief; compiledPrompt: string;
  negativePrompt?: string; renderSpec?: Record<string, unknown>; rendererVersion?: string;
  provider: "openrouter"; deploymentId: string; modelKey?: string; providerParams?: Record<string, unknown>;
  providerInput: Record<string, unknown>; creditReservationId: string; estimatedCredits: number; createdBy: string;
  status?: "preparing" | "queued";
}): Promise<CreativeGenerationRun> {
  const [row] = await databaseFor(pool).insert(runsTable).values({
    organization_id: input.organizationId, content_base_id: input.contentBaseId,
    origin_post_id: input.originPostId, parent_asset_id: input.parentAssetId,
    template_key: input.visualType, template_version: 1, media_kind: input.mediaKind,
    visual_type: input.visualType, asset_role: "primary", visual_brief: input.visualBrief,
    compiled_prompt: input.compiledPrompt, negative_prompt: input.negativePrompt,
    render_spec: input.renderSpec, renderer_version: input.rendererVersion,
    provider: input.provider, deployment_id: input.deploymentId, model_key: input.modelKey,
    provider_params: input.providerParams ?? {}, input: input.providerInput,
    status: input.status ?? "queued",
    credit_reservation_id: input.creditReservationId, estimated_credits: input.estimatedCredits,
    created_by: input.createdBy,
  }).returning();
  return mapRun(row);
}

export async function markCreativeRunPromptReady(pool: Pool, id: string, input: {
  compiledPrompt: string;
  providerInput: Record<string, unknown>;
  providerParams: Record<string, unknown>;
}): Promise<CreativeGenerationRun | null> {
  const [row] = await databaseFor(pool).update(runsTable).set({
    compiled_prompt: input.compiledPrompt,
    input: input.providerInput,
    provider_params: input.providerParams,
    status: "queued",
    progress: 0,
    updated_at: new Date().toISOString(),
  }).where(and(eq(runsTable.id, id), eq(runsTable.status, "preparing"))).returning();
  return row ? mapRun(row) : null;
}

export async function markCreativeRunSubmitted(pool: Pool, id: string, queue: {
  requestId: string; requestUrl?: string; statusUrl?: string; resultUrl?: string; cancelUrl?: string;
}): Promise<boolean> {
  const now = new Date().toISOString();
  const rows = await databaseFor(pool).update(runsTable).set({
    status: "submitted", provider_request_id: queue.requestId,
    provider_request_url: queue.requestUrl, provider_status_url: queue.statusUrl,
    provider_result_url: queue.resultUrl, provider_cancel_url: queue.cancelUrl,
    progress: 5, started_at: now, updated_at: now,
  }).where(and(
    eq(runsTable.id, id),
    eq(runsTable.status, "processing"),
    isNull(runsTable.provider_request_id),
  )).returning({ id: runsTable.id });
  return rows.length > 0;
}

/** Claim a locally queued run exactly once before making a billable provider call. */
export async function claimCreativeRunForProvider(pool: Pool, id: string): Promise<boolean> {
  const now = new Date().toISOString();
  const rows = await databaseFor(pool).update(runsTable).set({
    status: "processing", progress: 15, started_at: now, updated_at: now,
  }).where(and(eq(runsTable.id, id), eq(runsTable.status, "queued")))
    .returning({ id: runsTable.id });
  return rows.length > 0;
}

export async function updateCreativeRunProgress(pool: Pool, id: string, status: "submitted" | "processing", progress: number): Promise<void> {
  await databaseFor(pool).update(runsTable).set({ status, progress: Math.max(0, Math.min(99, progress)), updated_at: new Date().toISOString() })
    .where(and(eq(runsTable.id, id), inArray(runsTable.status, ["submitted", "processing"])));
}

export async function storeCreativeRunResult(pool: Pool, id: string, result: unknown): Promise<void> {
  await databaseFor(pool).update(runsTable).set({ provider_result: result, progress: 90, updated_at: new Date().toISOString() })
    .where(and(eq(runsTable.id, id), inArray(runsTable.status, ["submitted", "processing"])));
}

export async function transitionCreativeRunTerminal(pool: Pool, input: {
  id: string; from?: CreativeRunStatus[]; status: "succeeded" | "failed" | "cancelled";
  error?: string | null; actualCredits?: number | null;
}): Promise<boolean> {
  const now = new Date().toISOString();
  const rows = await databaseFor(pool).update(runsTable).set({
    status: input.status, progress: input.status === "succeeded" ? 100 : 0,
    error: input.error ?? null, actual_credits: input.actualCredits ?? null,
    completed_at: now, updated_at: now,
  }).where(and(eq(runsTable.id, input.id), inArray(runsTable.status, input.from ?? ["preparing", "queued", "submitted", "processing"])))
    .returning({ id: runsTable.id });
  return rows.length > 0;
}

export async function getCreativeGenerationRun(pool: Pool, id: string): Promise<CreativeGenerationRun | null> {
  const [row] = await databaseFor(pool).select().from(runsTable).where(eq(runsTable.id, id)).limit(1);
  return row ? mapRun(row) : null;
}

export async function listCreativeRunsForBase(pool: Pool, contentBaseId: string, limit = 40): Promise<CreativeGenerationRun[]> {
  const rows = await databaseFor(pool).select().from(runsTable).where(eq(runsTable.content_base_id, contentBaseId))
    .orderBy(desc(runsTable.created_at)).limit(limit);
  return rows.map(mapRun);
}

export async function listCreativeRunsToReconcile(adminPool: Pool, limit = 25): Promise<Array<{ id: string; organizationId: string }>> {
  return databaseFor(adminPool).select({ id: runsTable.id, organizationId: runsTable.organization_id }).from(runsTable)
    .where(or(
      eq(runsTable.status, "queued"),
      and(eq(runsTable.status, "preparing"), lt(runsTable.updated_at, new Date(Date.now() - 5 * 60_000).toISOString())),
      and(inArray(runsTable.status, ["submitted", "processing"]), lt(runsTable.updated_at, new Date(Date.now() - 15_000).toISOString())),
    ))
    .orderBy(asc(runsTable.updated_at)).limit(Math.max(1, Math.min(limit, 100)));
}

export async function createContentAsset(pool: Pool, input: {
  organizationId: string; generationRunId: string; outputIndex: number; contentBaseId: string;
  originPostId?: string; parentAssetId?: string; assetRole?: string; mediaKind: CreativeMediaKind;
  visualType: VisualType; fileName: string; mimeType: string; r2Key: string; width?: number; height?: number;
  durationMs?: number; byteSize: number; description: string; altText: string; metadata?: Record<string, unknown>;
}): Promise<ContentAsset> {
  const [row] = await databaseFor(pool).insert(assetsTable).values({
    organization_id: input.organizationId, generation_run_id: input.generationRunId,
    output_index: input.outputIndex, content_base_id: input.contentBaseId,
    origin_post_id: input.originPostId, parent_asset_id: input.parentAssetId,
    asset_role: input.assetRole ?? "primary", media_kind: input.mediaKind, visual_type: input.visualType,
    file_name: input.fileName, mime_type: input.mimeType, r2_key: input.r2Key,
    width: input.width, height: input.height, duration_ms: input.durationMs, byte_size: input.byteSize,
    description: input.description, alt_text: input.altText, metadata: input.metadata ?? {},
  }).onConflictDoUpdate({
    target: [assetsTable.organization_id, assetsTable.generation_run_id, assetsTable.output_index],
    set: {
      file_name: input.fileName, mime_type: input.mimeType, r2_key: input.r2Key,
      width: input.width, height: input.height, duration_ms: input.durationMs, byte_size: input.byteSize,
      description: input.description, alt_text: input.altText, metadata: input.metadata ?? {},
      updated_at: new Date().toISOString(),
    },
  }).returning();
  return mapAsset(row);
}

export async function listContentAssetsForBase(pool: Pool, contentBaseId: string): Promise<ContentAsset[]> {
  const rows = await databaseFor(pool).select().from(assetsTable).where(eq(assetsTable.content_base_id, contentBaseId))
    .orderBy(desc(assetsTable.created_at));
  return rows.map(mapAsset);
}

export async function getContentAsset(pool: Pool, id: string): Promise<ContentAsset | null> {
  const [row] = await databaseFor(pool).select().from(assetsTable).where(eq(assetsTable.id, id)).limit(1);
  return row ? mapAsset(row) : null;
}

export async function deleteContentAsset(pool: Pool, id: string): Promise<boolean> {
  const rows = await databaseFor(pool).delete(assetsTable).where(eq(assetsTable.id, id)).returning({ id: assetsTable.id });
  return rows.length > 0;
}

export async function attachContentAssetToPost(pool: Pool, input: {
  organizationId: string; postId: string; assetId: string; role?: string; position?: number; createdBy?: string;
}): Promise<PostMediaLink> {
  const [row] = await databaseFor(pool).insert(linksTable).values({
    organization_id: input.organizationId, post_id: input.postId, asset_id: input.assetId,
    role: input.role ?? "primary", position: input.position ?? 0, created_by: input.createdBy,
  }).onConflictDoUpdate({
    target: [linksTable.organization_id, linksTable.post_id, linksTable.asset_id],
    set: { role: input.role ?? "primary", position: input.position ?? 0 },
  }).returning();
  const asset = await getContentAsset(pool, row.asset_id);
  if (!asset) throw new Error("Attached media asset disappeared.");
  return { id: row.id, organizationId: row.organization_id, postId: row.post_id, assetId: row.asset_id,
    role: row.role, position: row.position, createdBy: row.created_by, createdAt: isoTimestamp(row.created_at), asset };
}

export async function detachContentAssetFromPost(pool: Pool, postId: string, assetId: string): Promise<boolean> {
  const rows = await databaseFor(pool).delete(linksTable).where(and(eq(linksTable.post_id, postId), eq(linksTable.asset_id, assetId)))
    .returning({ id: linksTable.id });
  return rows.length > 0;
}

export async function detachAllContentAssetsFromPost(pool: Pool, postId: string): Promise<void> {
  await databaseFor(pool).delete(linksTable).where(eq(linksTable.post_id, postId));
}

export async function listContentAssetsForPost(pool: Pool, postId: string): Promise<PostMediaLink[]> {
  const rows = await databaseFor(pool).select({ link: linksTable, asset: assetsTable }).from(linksTable)
    .innerJoin(assetsTable, and(eq(linksTable.organization_id, assetsTable.organization_id), eq(linksTable.asset_id, assetsTable.id)))
    .where(eq(linksTable.post_id, postId)).orderBy(asc(linksTable.position), asc(linksTable.created_at));
  return rows.map(({ link, asset }) => mapLink(link, asset));
}

export async function listContentMediaUsageForBase(pool: Pool, contentBaseId: string): Promise<PostMediaLink[]> {
  const rows = await databaseFor(pool).select({ link: linksTable, asset: assetsTable }).from(linksTable)
    .innerJoin(assetsTable, and(eq(linksTable.organization_id, assetsTable.organization_id), eq(linksTable.asset_id, assetsTable.id)))
    .where(eq(assetsTable.content_base_id, contentBaseId)).orderBy(desc(linksTable.created_at));
  return rows.map(({ link, asset }) => mapLink(link, asset));
}

export async function preferredContentAssetForPost(pool: Pool, postId: string, mediaKinds?: readonly CreativeMediaKind[]): Promise<ContentAsset | null> {
  const links = await listContentAssetsForPost(pool, postId);
  return links.find((link) => !mediaKinds?.length || mediaKinds.includes(link.asset.mediaKind))?.asset ?? null;
}

/** Resolve the cross-store legacy ownership only from verified Post-to-Base graph membership. */
export async function backfillLegacyMediaOwnership(pool: Pool, contentBaseId: string, postIds: string[]): Promise<void> {
  if (!postIds.length) return;
  await Promise.all([
    databaseFor(pool).update(runsTable).set({ content_base_id: contentBaseId, updated_at: new Date().toISOString() })
      .where(and(isNull(runsTable.content_base_id), inArray(runsTable.draft_id, postIds))),
    databaseFor(pool).update(assetsTable).set({ content_base_id: contentBaseId, updated_at: new Date().toISOString() })
      .where(and(isNull(assetsTable.content_base_id), inArray(assetsTable.draft_id, postIds))),
  ]);
}
