import { commercialErrorResponse, reserveVariableCost } from "@content-automation/auth/commercial";
import { getAuthorizationContext } from "@content-automation/auth/server";
import { releaseReservation, settleReservation } from "@content-automation/platform/commercial";
import { runWithGraphOrganization } from "@content-automation/platform/data/graph";
import { kickJobReconcilers } from "@content-automation/platform/jobs/reconcilers";
import { z } from "zod";
import { getContentDraftById, getContentDrafts, getContentIdeaById } from "../data/content-repository";
import type { ContentIdea } from "../domain/content";
import { runGenerateContentDraft, type StructuredGenerate } from "../agent/actions/draft";
import { getPublishingAdminPool, getPublishingPool } from "../publishing/pool";
import { R2Media } from "../publishing/r2";
import { recordMediaAssetLineage, recordPostMediaUsage, removeMediaAssetLineage, removePostMediaUsage } from "./graph";
import {
  downloadOpenRouterVideo,
  generateOpenRouterImage,
  getOpenRouterVideoStatus,
  OpenRouterMediaError,
  submitOpenRouterVideo,
} from "./openrouter-provider";
import {
  attachContentAssetToPost,
  backfillLegacyMediaOwnership,
  claimCreativeRunForProvider,
  createContentAsset,
  createCreativeGenerationRun,
  deleteContentAsset,
  detachAllContentAssetsFromPost,
  detachContentAssetFromPost,
  getContentAsset,
  getCreativeGenerationRun,
  listContentAssetsForBase,
  listContentAssetsForPost,
  listContentMediaUsageForBase,
  listCreativeRunsForBase,
  listCreativeRunsToReconcile,
  markCreativeRunPromptReady,
  markCreativeRunSubmitted,
  storeCreativeRunResult,
  transitionCreativeRunTerminal,
  updateCreativeRunProgress,
  type ContentAsset,
  type CreativeGenerationRun,
} from "./repository";
import { applyExactTextOverlay, rasterizeImageForVision } from "./image-processing";
import { generateProviderMediaPrompt, type MediaPromptGenerate } from "./prompt-director";
import { creativeExecutionTarget } from "./runtime";
import {
  buildProviderInput,
  creativeMediaRequestSchema,
  imageVisualTypes,
  mediaCredits,
  videoVisualTypes,
  VISUAL_TYPE_LABELS,
} from "./templates";

const terminalStatuses = new Set(["succeeded", "failed", "cancelled"]);

export class CreativeMediaError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" | "UNAVAILABLE",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CreativeMediaError";
  }
}

function providerErrorMessage(error: unknown): string {
  if (error instanceof OpenRouterMediaError) return error.message;
  return error instanceof Error ? error.message : "Creative media generation failed.";
}

function runView(run: CreativeGenerationRun) {
  return {
    id: run.id, contentBaseId: run.contentBaseId, originPostId: run.originPostId,
    parentAssetId: run.parentAssetId, mediaKind: run.mediaKind, visualType: run.visualType,
    visualBrief: run.visualBrief, status: run.status, progress: run.progress, error: run.error,
    estimatedCredits: run.estimatedCredits, actualCredits: run.actualCredits,
    provenance: {
      provider: run.provider, deploymentId: run.deploymentId, providerRequestId: run.providerRequestId,
      compiledPrompt: run.compiledPrompt, negativePrompt: run.negativePrompt,
      rendererVersion: run.rendererVersion, renderSpec: run.renderSpec,
      providerParams: run.providerParams,
      queue: {
        requestUrl: run.providerRequestUrl,
        statusUrl: run.providerStatusUrl,
        resultUrl: run.providerResultUrl,
        cancelUrl: run.providerCancelUrl,
      },
    },
    createdAt: run.createdAt, startedAt: run.startedAt, completedAt: run.completedAt,
  };
}

function assetView(asset: ContentAsset) {
  return {
    id: asset.id, generationRunId: asset.generationRunId, contentBaseId: asset.contentBaseId,
    originPostId: asset.originPostId, parentAssetId: asset.parentAssetId,
    assetRole: asset.assetRole, mediaKind: asset.mediaKind, visualType: asset.visualType,
    fileName: asset.fileName, mimeType: asset.mimeType, width: asset.width, height: asset.height,
    durationMs: asset.durationMs, byteSize: asset.byteSize, description: asset.description,
    altText: asset.altText, metadata: asset.metadata, createdAt: asset.createdAt,
    url: `/api/content/media/assets/${asset.id}/file`,
  };
}

function usageView(usage: Awaited<ReturnType<typeof listContentAssetsForPost>>[number]) {
  return {
    id: usage.id, postId: usage.postId, assetId: usage.assetId, role: usage.role,
    position: usage.position, createdAt: usage.createdAt, asset: assetView(usage.asset),
  };
}

function safeFileName(kind: ContentAsset["mediaKind"], index: number, mimeType: string, suggested?: string): string {
  const extensionByMime: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/avif": "avif",
    "video/mp4": "mp4", "video/webm": "webm", "image/svg+xml": "svg",
  };
  const clean = suggested?.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120);
  if (clean && clean.includes(".")) return clean;
  return `${kind}-${index + 1}.${extensionByMime[mimeType] ?? "bin"}`;
}

async function settleSucceeded(run: CreativeGenerationRun): Promise<void> {
  if (!run.creditReservationId) return;
  try {
    await settleReservation({
      reservationId: run.creditReservationId, actualCredits: run.estimatedCredits,
      idempotencyKey: `creative-generation:${run.id}:settlement`, usageKind: "agent_action",
      provider: run.provider ?? undefined,
      model: run.deploymentId ?? undefined,
      metadata: {
        action: "generate_content_media", visualType: run.visualType, mediaKind: run.mediaKind,
        runtimeVersion: run.providerParams.runtimeVersion,
        simulation: run.providerParams.simulation === true,
      },
    });
  } catch (error) {
    await releaseReservation(run.creditReservationId, `Creative media settlement failed: ${providerErrorMessage(error)}`).catch(() => undefined);
  }
}

async function failCreativeGeneration(run: CreativeGenerationRun, message: string, status: "failed" | "cancelled" = "failed"): Promise<boolean> {
  const changed = await transitionCreativeRunTerminal(getPublishingPool(run.organizationId), { id: run.id, status, error: message });
  if (changed && run.creditReservationId) await releaseReservation(run.creditReservationId, message).catch(() => undefined);
  return changed;
}

async function resolveRunBase(run: CreativeGenerationRun): Promise<ContentIdea> {
  if (run.contentBaseId) {
    const base = await getContentIdeaById(run.contentBaseId);
    if (base) return base;
  }
  const postId = run.originPostId ?? run.legacyDraftId;
  if (postId) {
    const post = await getContentDraftById(postId);
    if (post) {
      const base = await getContentIdeaById(post.ideaId);
      if (base) {
        await backfillLegacyMediaOwnership(getPublishingPool(run.organizationId), base.id, [post.id]);
        return base;
      }
    }
  }
  throw new CreativeMediaError("NOT_FOUND", "The Content Base that owns this media generation no longer exists.", 404);
}

async function persistAsset(input: {
  run: CreativeGenerationRun; base: ContentIdea; outputIndex: number; bytes: Buffer; mimeType: string;
  fileName?: string; width?: number; height?: number; durationMs?: number; metadata?: Record<string, unknown>;
  description?: string; altText?: string;
}): Promise<ContentAsset> {
  const r2 = R2Media.fromEnv();
  if (!r2) throw new CreativeMediaError("UNAVAILABLE", "Media storage is not configured. Add the R2 credentials and retry.", 503);
  const exactText = input.run.mediaKind === "image" ? input.run.visualBrief.exactOnMediaText : undefined;
  const overlaid = exactText
    ? await applyExactTextOverlay({
        bytes: input.bytes,
        mimeType: input.mimeType,
        text: exactText,
        width: input.width,
        height: input.height,
      })
    : undefined;
  const bytes = overlaid?.bytes ?? input.bytes;
  const mimeType = overlaid?.mimeType ?? input.mimeType;
  const width = overlaid?.width ?? input.width;
  const height = overlaid?.height ?? input.height;
  const suggestedFileName = overlaid
    ? `${input.fileName?.replace(/\.[^.]+$/, "") || `image-${input.outputIndex + 1}`}.png`
    : input.fileName;
  const fileName = safeFileName(input.run.mediaKind, input.outputIndex, mimeType, suggestedFileName);
  const r2Key = await r2.putGeneratedForOrganization(input.run.organizationId, input.run.id, input.outputIndex, fileName, bytes, mimeType);
  const description = input.description ?? `${VISUAL_TYPE_LABELS[input.run.visualType]} generated from “${input.base.title}”.`;
  const asset = await createContentAsset(getPublishingPool(input.run.organizationId), {
    organizationId: input.run.organizationId, generationRunId: input.run.id, outputIndex: input.outputIndex,
    contentBaseId: input.base.id, originPostId: input.run.originPostId ?? undefined,
    parentAssetId: input.run.parentAssetId ?? undefined, assetRole: input.run.assetRole,
    mediaKind: input.run.mediaKind, visualType: input.run.visualType, fileName, mimeType,
    r2Key, width, height, durationMs: input.durationMs,
    byteSize: bytes.byteLength, description,
    altText: input.altText ?? (input.run.visualBrief.exactOnMediaText
      ? `${description} It displays the text “${input.run.visualBrief.exactOnMediaText}”.`
      : description),
    metadata: {
      ...input.metadata,
      sourceLineage: {
        topics: input.base.sourceTopics ?? [],
        research: input.base.sourceResearch ?? [],
        claimIds: input.base.sourceClaimIds ?? [],
        evidenceIds: input.base.sourceEvidenceIds ?? [],
        citations: input.base.suggestedCitations ?? [],
      },
      ...(overlaid ? { exactTextOverlay: { compositor: "exact-text-overlay-v1" } } : {}),
    },
  });
  await recordMediaAssetLineage({ base: input.base, run: input.run, asset });
  if (input.run.originPostId) {
    await attachContentAssetToPost(getPublishingPool(input.run.organizationId), {
      organizationId: input.run.organizationId, postId: input.run.originPostId,
      assetId: asset.id, role: input.run.assetRole, createdBy: input.run.createdBy ?? undefined,
    });
    await recordPostMediaUsage({ baseId: input.base.id, postId: input.run.originPostId, assetId: asset.id });
  }
  return asset;
}

async function completeOpenRouterImage(run: CreativeGenerationRun, base: ContentIdea): Promise<void> {
  const pool = getPublishingPool(run.organizationId);
  const generated = await generateOpenRouterImage({
    model: run.deploymentId ?? "",
    payload: run.input,
  });
  let current = await getCreativeGenerationRun(pool, run.id);
  if (!current || terminalStatuses.has(current.status)) return;
  await storeCreativeRunResult(pool, current.id, generated.providerResult);
  current = await getCreativeGenerationRun(pool, current.id) ?? current;
  if (terminalStatuses.has(current.status)) return;
  const failures: string[] = [];
  let created = 0;
  for (const [index, output] of generated.outputs.entries()) {
    try {
      await persistAsset({
        run: current,
        base,
        outputIndex: index,
        bytes: output.bytes,
        mimeType: output.mimeType,
        fileName: output.fileName,
        width: 1_024,
        height: 1_024,
        metadata: { openRouter: generated.providerResult },
      });
      created += 1;
    } catch (error) {
      failures.push(providerErrorMessage(error));
    }
  }
  if (!created) return void await failCreativeGeneration(current, failures[0] ?? "Generated images could not be stored.");
  const changed = await transitionCreativeRunTerminal(pool, {
    id: current.id,
    status: "succeeded",
    actualCredits: current.estimatedCredits,
    error: failures.length ? `${failures.length} image output(s) could not be stored.` : null,
  });
  if (changed) await settleSucceeded(current);
}

async function completeOpenRouterVideo(
  run: CreativeGenerationRun,
  base: ContentIdea,
  remote: Awaited<ReturnType<typeof getOpenRouterVideoStatus>>,
): Promise<void> {
  const pool = getPublishingPool(run.organizationId);
  await updateCreativeRunProgress(pool, run.id, "processing", 85);
  await storeCreativeRunResult(pool, run.id, {
    id: remote.id,
    status: remote.status,
    generationId: remote.generationId,
    outputCount: Math.max(1, remote.unsignedUrls.length),
    usage: remote.usage,
  });
  let current = await getCreativeGenerationRun(pool, run.id);
  if (!current || terminalStatuses.has(current.status)) return;
  const failures: string[] = [];
  let created = 0;
  for (let index = 0; index < Math.max(1, remote.unsignedUrls.length); index += 1) {
    try {
      const output = await downloadOpenRouterVideo({ statusUrl: run.providerStatusUrl ?? "", index });
      current = await getCreativeGenerationRun(pool, run.id) ?? current;
      if (terminalStatuses.has(current.status)) return;
      await persistAsset({
        run: current,
        base,
        outputIndex: index,
        bytes: output.bytes,
        mimeType: output.mimeType,
        fileName: output.fileName,
        width: 720,
        height: 1_280,
        durationMs: 5_000,
        metadata: {
          openRouter: {
            generationId: remote.generationId,
            usage: remote.usage,
          },
        },
      });
      created += 1;
    } catch (error) {
      failures.push(providerErrorMessage(error));
    }
  }
  if (!created) {
    const first = failures[0] ?? "The generated video could not be stored.";
    if (failures.length && /could not download|timed out|HTTP 5/i.test(first)) throw new OpenRouterMediaError(first, true);
    return void await failCreativeGeneration(current, first);
  }
  const changed = await transitionCreativeRunTerminal(pool, {
    id: current.id,
    status: "succeeded",
    actualCredits: current.estimatedCredits,
    error: failures.length ? `${failures.length} video output(s) could not be stored.` : null,
  });
  if (changed) await settleSucceeded(current);
}

async function submitQueuedOpenRouterRun(run: CreativeGenerationRun): Promise<void> {
  const pool = getPublishingPool(run.organizationId);
  if (!await claimCreativeRunForProvider(pool, run.id)) return;
  const claimed = await getCreativeGenerationRun(pool, run.id);
  if (!claimed || terminalStatuses.has(claimed.status)) return;
  const base = await resolveRunBase(claimed);
  if (claimed.mediaKind === "image") {
    await completeOpenRouterImage(claimed, base);
    return;
  }
  const queue = await submitOpenRouterVideo({
    model: claimed.deploymentId ?? "",
    payload: claimed.input,
  });
  if (!await markCreativeRunSubmitted(pool, claimed.id, queue)) {
    const latest = await getCreativeGenerationRun(pool, claimed.id);
    if (!latest || terminalStatuses.has(latest.status)) return;
    throw new OpenRouterMediaError("The OpenRouter video job could not be attached to its local run.");
  }
}

async function reconcileCreativeGenerationForOrganization(organizationId: string, runId: string): Promise<void> {
  const pool = getPublishingPool(organizationId);
  const run = await getCreativeGenerationRun(pool, runId);
  if (!run || terminalStatuses.has(run.status)) return;
  if (run.status === "preparing") {
    if (Date.now() - new Date(run.updatedAt).getTime() > 5 * 60_000) {
      await failCreativeGeneration(run, "Media prompt preparation was interrupted. Retry the generation.");
    }
    return;
  }
  if (run.provider !== "openrouter") {
    return void await failCreativeGeneration(
      run,
      `This unfinished run uses the retired ${run.provider ?? "unknown"} media provider. Retry it to generate through OpenRouter.`,
    );
  }
  try {
    if (!run.providerRequestId) {
      if (run.status === "queued") await submitQueuedOpenRouterRun(run);
      else if (Date.now() - new Date(run.updatedAt).getTime() > 5 * 60_000) {
        await failCreativeGeneration(run, "The OpenRouter submission was interrupted before a provider job was recorded. Retry the generation.");
      }
      return;
    }
    if (run.mediaKind !== "video") {
      return void await failCreativeGeneration(run, "The OpenRouter image run entered an invalid queued-job state. Retry the generation.");
    }
    if (!run.providerStatusUrl) {
      return void await failCreativeGeneration(run, "OpenRouter did not provide an authoritative polling URL. Retry the generation.");
    }
    if (Date.now() - new Date(run.updatedAt).getTime() < 15_000) return;
    const remote = await getOpenRouterVideoStatus(run.providerStatusUrl);
    if (remote.id !== run.providerRequestId) {
      return void await failCreativeGeneration(run, "OpenRouter returned status for a different video job.");
    }
    if (remote.status === "pending") return void await updateCreativeRunProgress(pool, run.id, "submitted", 10);
    if (remote.status === "in_progress") return void await updateCreativeRunProgress(pool, run.id, "processing", 50);
    if (remote.status === "failed") {
      return void await failCreativeGeneration(run, remote.error || "OpenRouter reported that video generation failed.");
    }
    await completeOpenRouterVideo(run, await resolveRunBase(run), remote);
  } catch (error) {
    if (run.providerRequestId && error instanceof OpenRouterMediaError && error.retryable) return;
    await failCreativeGeneration(run, providerErrorMessage(error));
  }
}

export async function reconcileCreativeGeneration(organizationId: string, runId: string): Promise<void> {
  await runWithGraphOrganization(organizationId, () => (
    reconcileCreativeGenerationForOrganization(organizationId, runId)
  ));
}

export async function sweepCreativeGenerations(): Promise<void> {
  for (const run of await listCreativeRunsToReconcile(getPublishingAdminPool(), 25)) {
    await reconcileCreativeGeneration(run.organizationId, run.id);
  }
}

export type CreativeReservation = { organizationId: string; userId: string; reservationId: string };

export async function startContentBaseMediaGeneration(input: {
  contentBaseId: string; originPostId?: string; request: unknown;
  reserve: (estimatedCredits: number) => Promise<CreativeReservation>;
  generatePrompt?: MediaPromptGenerate;
}) {
  let reservationId: string | undefined;
  let run: CreativeGenerationRun | undefined;
  try {
    const parsed = creativeMediaRequestSchema.parse(input.request);
    const base = await getContentIdeaById(input.contentBaseId);
    if (!base) throw new CreativeMediaError("NOT_FOUND", "Content Base not found.", 404);
    if (base.status !== "refined") throw new CreativeMediaError("CONFLICT", "Build the Content Base before generating media.", 409);
    if (input.originPostId) {
      const post = await getContentDraftById(input.originPostId);
      if (!post || post.ideaId !== base.id) throw new CreativeMediaError("NOT_FOUND", "Post not found in this Content Base.", 404);
    }
    const target = creativeExecutionTarget(parsed.brief.kind);
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      throw new CreativeMediaError(
        "UNAVAILABLE",
        `${parsed.brief.kind === "video" ? "Video" : "Image"} generation is not configured. Add OPENROUTER_API_KEY and retry.`,
        503,
      );
    }
    if (!R2Media.fromEnv()) {
      throw new CreativeMediaError("UNAVAILABLE", "Media storage is not configured. Add the R2 credentials and retry.", 503);
    }
    const estimatedCredits = mediaCredits(parsed);
    const reserved = await input.reserve(estimatedCredits);
    reservationId = reserved.reservationId;
    if (parsed.parentAssetId) {
      const parent = await getContentAsset(getPublishingPool(reserved.organizationId), parsed.parentAssetId);
      if (!parent || parent.contentBaseId !== base.id) throw new CreativeMediaError("NOT_FOUND", "Parent media asset not found in this Content Base.", 404);
    }
    const providerParams = parsed.brief.kind === "image"
      ? { resolution: "1K", aspectRatio: "1:1", variations: 1, runtimeVersion: target.runtimeVersion, simulation: false }
      : { resolution: "720p", aspectRatio: "9:16", durationSeconds: 5, generateAudio: true, runtimeVersion: target.runtimeVersion, simulation: false };
    run = await createCreativeGenerationRun(getPublishingPool(reserved.organizationId), {
      organizationId: reserved.organizationId, contentBaseId: base.id, originPostId: input.originPostId,
      parentAssetId: parsed.parentAssetId, mediaKind: parsed.brief.kind, visualType: parsed.brief.visualType,
      visualBrief: parsed.brief, compiledPrompt: "",
      provider: target.provider, deploymentId: target.modelId,
      modelKey: target.modelId, providerParams,
      providerInput: {}, creditReservationId: reserved.reservationId, estimatedCredits, createdBy: reserved.userId,
      status: "preparing",
    });
    let compiledPrompt: string;
    try {
      compiledPrompt = await generateProviderMediaPrompt(base, parsed.brief, input.generatePrompt);
    } catch (error) {
      throw new CreativeMediaError("UNAVAILABLE", `The detailed media prompt could not be generated. ${providerErrorMessage(error)}`, 503);
    }
    const providerInput = buildProviderInput(parsed, compiledPrompt);
    const prepared = await markCreativeRunPromptReady(getPublishingPool(reserved.organizationId), run.id, {
      compiledPrompt, providerInput, providerParams,
    });
    if (!prepared) throw new CreativeMediaError("CONFLICT", "Media generation stopped before its prompt was ready. Retry the generation.", 409);
    run = prepared;
    kickJobReconcilers();
    return runView(run);
  } catch (error) {
    if (run) await failCreativeGeneration(run, providerErrorMessage(error));
    else if (reservationId) await releaseReservation(reservationId, providerErrorMessage(error)).catch(() => undefined);
    throw error;
  }
}

export async function listCreativeMediaForBase(organizationId: string, contentBaseId: string) {
  const base = await getContentIdeaById(contentBaseId);
  if (!base) throw new CreativeMediaError("NOT_FOUND", "Content Base not found.", 404);
  const posts = await getContentDrafts({ ideaId: contentBaseId });
  const pool = getPublishingPool(organizationId);
  await backfillLegacyMediaOwnership(pool, contentBaseId, posts.map((post) => post.id));
  let runs = await listCreativeRunsForBase(pool, contentBaseId);
  for (const active of runs.filter((entry) => !terminalStatuses.has(entry.status)).slice(0, 3)) {
    await reconcileCreativeGeneration(organizationId, active.id);
  }
  runs = await listCreativeRunsForBase(pool, contentBaseId);
  const [assets, usage] = await Promise.all([
    listContentAssetsForBase(pool, contentBaseId), listContentMediaUsageForBase(pool, contentBaseId),
  ]);
  return {
    visualTypes: { image: imageVisualTypes.map((key) => ({ key, label: VISUAL_TYPE_LABELS[key] })),
      video: videoVisualTypes.map((key) => ({ key, label: VISUAL_TYPE_LABELS[key] })) },
    runs: runs.map(runView), assets: assets.map(assetView), usage: usage.map(usageView),
  };
}

export async function getPostMediaOverview(organizationId: string, postId: string) {
  const post = await getContentDraftById(postId);
  if (!post) throw new CreativeMediaError("NOT_FOUND", "Post not found.", 404);
  const pool = getPublishingPool(organizationId);
  await backfillLegacyMediaOwnership(pool, post.ideaId, [post.id]);
  const [linked, available] = await Promise.all([
    listContentAssetsForPost(pool, post.id), listContentAssetsForBase(pool, post.ideaId),
  ]);
  return { contentBaseId: post.ideaId, linked: linked.map(usageView), available: available.map(assetView) };
}

export async function attachCreativeAssetToPost(organizationId: string, userId: string, postId: string, assetId: string) {
  const post = await getContentDraftById(postId);
  const asset = await getContentAsset(getPublishingPool(organizationId), assetId);
  if (!post || !asset || asset.contentBaseId !== post.ideaId) throw new CreativeMediaError("NOT_FOUND", "Media asset not found in this Post's Content Base.", 404);
  const link = await attachContentAssetToPost(getPublishingPool(organizationId), { organizationId, postId, assetId, createdBy: userId });
  await recordPostMediaUsage({ baseId: post.ideaId, postId, assetId });
  return { link: usageView(link) };
}

export async function detachCreativeAssetFromPost(organizationId: string, postId: string, assetId: string) {
  if (!await getContentDraftById(postId)) throw new CreativeMediaError("NOT_FOUND", "Post not found.", 404);
  if (!await detachContentAssetFromPost(getPublishingPool(organizationId), postId, assetId)) {
    throw new CreativeMediaError("NOT_FOUND", "This media asset is not attached to the Post.", 404);
  }
  await removePostMediaUsage(postId, assetId);
  return { detached: true };
}

export async function detachAllCreativeAssetsFromPost(organizationId: string, postId: string): Promise<void> {
  await detachAllContentAssetsFromPost(getPublishingPool(organizationId), postId);
}

export async function deleteCreativeAssetFromBase(organizationId: string, contentBaseId: string, assetId: string) {
  const pool = getPublishingPool(organizationId);
  const asset = await getContentAsset(pool, assetId);
  if (!asset || asset.contentBaseId !== contentBaseId) throw new CreativeMediaError("NOT_FOUND", "Media asset not found in this Content Base.", 404);
  if (!asset.r2Key.startsWith("local-generated:")) {
    const r2 = R2Media.fromEnv();
    if (!r2) throw new CreativeMediaError("UNAVAILABLE", "Media storage is not configured, so the stored object was not deleted.", 503);
    await r2.delete(asset.r2Key);
  }
  if (!await deleteContentAsset(pool, assetId)) throw new CreativeMediaError("CONFLICT", "The media asset could not be deleted.", 409);
  await removeMediaAssetLineage(assetId);
  return { deleted: true };
}

async function readCreativeAssetBytes(asset: ContentAsset): Promise<Buffer> {
  if (asset.r2Key.startsWith("local-generated:")) {
    throw new CreativeMediaError("NOT_FOUND", "This obsolete local placeholder has no stored media file. Generate a real provider asset instead.", 404);
  }
  const r2 = R2Media.fromEnv();
  if (!r2) throw new CreativeMediaError("UNAVAILABLE", "Media storage is not configured.", 503);
  return r2.get(asset.r2Key);
}

const MAX_POST_GROUNDING_IMAGES = 4;

export async function generatePostFromCreativeAssets(input: {
  organizationId: string; userId: string; assetIds: string[]; contentType: string; generate?: StructuredGenerate;
  expectedContentBaseId?: string;
}) {
  const pool = getPublishingPool(input.organizationId);
  const assetIds = [...new Set(input.assetIds.map((id) => id.trim()).filter(Boolean))];
  if (assetIds.length === 0) {
    throw new CreativeMediaError("INVALID_INPUT", "Select at least one Content Base image before generating a Post.", 400);
  }
  if (assetIds.length > MAX_POST_GROUNDING_IMAGES) {
    throw new CreativeMediaError("INVALID_INPUT", `Select no more than ${MAX_POST_GROUNDING_IMAGES} images for one Post.`, 400);
  }
  const assets = await Promise.all(assetIds.map((assetId) => getContentAsset(pool, assetId)));
  if (assets.some((asset) => !asset?.contentBaseId)) {
    throw new CreativeMediaError("NOT_FOUND", "One or more Content Base images could not be found.", 404);
  }
  const resolvedAssets = assets as ContentAsset[];
  const contentBaseId = resolvedAssets[0]!.contentBaseId!;
  if (
    (input.expectedContentBaseId && contentBaseId !== input.expectedContentBaseId)
    || resolvedAssets.some((asset) => asset.contentBaseId !== contentBaseId)
  ) {
    throw new CreativeMediaError("NOT_FOUND", "Every selected image must belong to this Content Base.", 404);
  }
  if (resolvedAssets.some((asset) => asset.mediaKind !== "image" || !asset.mimeType.startsWith("image/"))) {
    throw new CreativeMediaError("INVALID_INPUT", "Post generation currently requires image assets.", 400);
  }
  const vision = await Promise.all(resolvedAssets.map(async (asset) => {
    const [storedBytes, run] = await Promise.all([
      readCreativeAssetBytes(asset),
      getCreativeGenerationRun(pool, asset.generationRunId),
    ]);
    if (!run?.compiledPrompt.trim()) {
      throw new CreativeMediaError("CONFLICT", "The generation prompt for a selected image is unavailable. Choose another image.", 409);
    }
    const rasterized = await rasterizeImageForVision({ bytes: storedBytes, mimeType: asset.mimeType });
    return {
      bytes: rasterized.bytes,
      mimeType: rasterized.mimeType,
      description: asset.description,
      generationContext: [
        `Visual type: ${VISUAL_TYPE_LABELS[asset.visualType]}`,
        `Alt text: ${asset.altText}`,
        `Original Visual Brief: ${JSON.stringify(run.visualBrief)}`,
        `Original image-generation prompt:\n${run.compiledPrompt}`,
      ].join("\n"),
    };
  }));
  const result = await runGenerateContentDraft(
    { ideaId: contentBaseId, contentType: input.contentType },
    { deps: input.generate ? { generate: input.generate } : undefined, vision },
  );
  const post = await getContentDraftById(result.draftId);
  if (!post) throw new CreativeMediaError("NOT_FOUND", "The generated Post could not be loaded.", 404);
  for (const [position, asset] of resolvedAssets.entries()) {
    await attachContentAssetToPost(pool, {
      organizationId: input.organizationId,
      postId: post.id,
      assetId: asset.id,
      role: position === 0 ? "grounding-primary" : "grounding-supporting",
      position,
      createdBy: input.userId,
    });
    await recordPostMediaUsage({ baseId: contentBaseId, postId: post.id, assetId: asset.id, generatedFrom: true });
  }
  return { draftId: post.id, draft: post, mediaAssetIds: resolvedAssets.map((asset) => asset.id) };
}

export async function generatePostFromCreativeAsset(input: {
  organizationId: string; userId: string; assetId: string; contentType: string; generate: StructuredGenerate;
  expectedContentBaseId?: string;
}) {
  return generatePostFromCreativeAssets({
    ...input,
    assetIds: [input.assetId],
  });
}

export async function getCreativeRunView(organizationId: string, runId: string) {
  await reconcileCreativeGeneration(organizationId, runId);
  const run = await getCreativeGenerationRun(getPublishingPool(organizationId), runId);
  if (!run) throw new CreativeMediaError("NOT_FOUND", "Media generation run not found.", 404);
  const assets = run.contentBaseId ? (await listContentAssetsForBase(getPublishingPool(organizationId), run.contentBaseId)).filter((asset) => asset.generationRunId === run.id) : [];
  return { run: runView(run), assets: assets.map(assetView) };
}

export async function cancelCreativeRun(organizationId: string, runId: string) {
  const run = await getCreativeGenerationRun(getPublishingPool(organizationId), runId);
  if (!run) throw new CreativeMediaError("NOT_FOUND", "Media generation run not found.", 404);
  if (terminalStatuses.has(run.status)) throw new CreativeMediaError("CONFLICT", "This generation is already finished.", 409);
  if (!await failCreativeGeneration(run, "Cancelled by the user.", "cancelled")) throw new CreativeMediaError("CONFLICT", "This generation is already finished.", 409);
  return { cancelled: true };
}

function creativeErrorResponse(error: unknown): Response | null {
  if (error instanceof CreativeMediaError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  return null;
}

export async function handleStartContentBaseMedia(request: Request, contentBaseId: string, originPostId?: string): Promise<Response> {
  try {
    const run = await startContentBaseMediaGeneration({
      contentBaseId, originPostId, request: await request.json(),
      reserve: async (estimatedCredits) => {
        const reserved = await reserveVariableCost(request, { action: "generate_content_media", credits: estimatedCredits, capability: "content.full" });
        return { organizationId: reserved.context.organizationId, userId: reserved.context.session.user.id, reservationId: reserved.reservationId };
      },
    });
    return Response.json({ run }, { status: run.status === "succeeded" ? 201 : 202 });
  } catch (error) {
    const response = creativeErrorResponse(error) ?? commercialErrorResponse(error);
    if (response) return response;
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid Visual Brief.", issues: error.issues }, { status: 400 });
    return Response.json({ error: providerErrorMessage(error) }, { status: error instanceof OpenRouterMediaError && error.retryable ? 503 : 500 });
  }
}

export async function handleListContentBaseMedia(request: Request, contentBaseId: string): Promise<Response> {
  const context = await getAuthorizationContext(request.headers);
  if (!context) return Response.json({ error: "Unauthenticated" }, { status: 401 });
  try { return Response.json(await listCreativeMediaForBase(context.organizationId, contentBaseId)); }
  catch (error) { return creativeErrorResponse(error) ?? Response.json({ error: providerErrorMessage(error) }, { status: 500 }); }
}

export async function handleListPostMedia(request: Request, postId: string): Promise<Response> {
  const context = await getAuthorizationContext(request.headers);
  if (!context) return Response.json({ error: "Unauthenticated" }, { status: 401 });
  try { return Response.json(await getPostMediaOverview(context.organizationId, postId)); }
  catch (error) { return creativeErrorResponse(error) ?? Response.json({ error: providerErrorMessage(error) }, { status: 500 }); }
}

export async function handleStartPostMedia(request: Request, postId: string): Promise<Response> {
  const post = await getContentDraftById(postId);
  if (!post) return Response.json({ error: "Post not found." }, { status: 404 });
  return handleStartContentBaseMedia(request, post.ideaId, post.id);
}

export async function handleAttachPostMedia(request: Request, postId: string, assetId: string): Promise<Response> {
  const context = await getAuthorizationContext(request.headers);
  if (!context) return Response.json({ error: "Unauthenticated" }, { status: 401 });
  try {
    return Response.json(await attachCreativeAssetToPost(
      context.organizationId, context.session.user.id, postId, assetId,
    ));
  } catch (error) {
    return creativeErrorResponse(error) ?? Response.json({ error: providerErrorMessage(error) }, { status: 500 });
  }
}

export async function handleGetCreativeRun(request: Request, runId: string): Promise<Response> {
  const context = await getAuthorizationContext(request.headers);
  if (!context) return Response.json({ error: "Unauthenticated" }, { status: 401 });
  try { return Response.json(await getCreativeRunView(context.organizationId, runId)); }
  catch (error) { return creativeErrorResponse(error) ?? Response.json({ error: providerErrorMessage(error) }, { status: 500 }); }
}

export async function handleCancelCreativeRun(request: Request, runId: string): Promise<Response> {
  const context = await getAuthorizationContext(request.headers);
  if (!context) return Response.json({ error: "Unauthenticated" }, { status: 401 });
  try { return Response.json(await cancelCreativeRun(context.organizationId, runId)); }
  catch (error) { return creativeErrorResponse(error) ?? Response.json({ error: providerErrorMessage(error) }, { status: 500 }); }
}

export async function handleCreativeAssetFile(request: Request, assetId: string): Promise<Response> {
  const context = await getAuthorizationContext(request.headers);
  if (!context) return Response.json({ error: "Unauthenticated" }, { status: 401 });
  const asset = await getContentAsset(getPublishingPool(context.organizationId), assetId);
  if (!asset) return Response.json({ error: "Content asset not found." }, { status: 404 });
  let bytes: Buffer;
  try { bytes = await readCreativeAssetBytes(asset); }
  catch (error) { return creativeErrorResponse(error) ?? Response.json({ error: providerErrorMessage(error) }, { status: 500 }); }
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": asset.mimeType, "Content-Length": String(bytes.byteLength),
    "Content-Disposition": `inline; filename="${asset.fileName.replace(/["\\]/g, "-")}"`,
    "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff",
  } });
}
