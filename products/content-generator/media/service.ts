import { commercialErrorResponse, reserveVariableCost } from "@content-automation/auth/commercial";
import { getAuthorizationContext } from "@content-automation/auth/server";
import { releaseReservation, settleReservation } from "@content-automation/platform/commercial";
import { getPlatformCatalog } from "@content-automation/platform/models/catalog-service";
import { listModelOptions, publicModelOptions } from "@content-automation/platform/models/catalog";
import { ModelPolicyError, resolveModelSelection } from "@content-automation/platform/models/resolver";
import { kickJobReconcilers } from "@content-automation/platform/jobs/reconcilers";
import { z } from "zod";
import { getContentDraftById } from "../data/content-repository";
import { getPublishingAdminPool, getPublishingPool } from "../publishing/pool";
import { R2Media } from "../publishing/r2";
import {
  cancelFalGeneration,
  downloadFalAsset,
  FalProviderError,
  getFalGenerationResult,
  getFalGenerationStatus,
  normalizeFalOutput,
  submitFalGeneration,
  type FalWebhookPayload,
} from "./fal-provider";
import {
  createContentAsset,
  createCreativeGenerationRun,
  findCreativeRunControlPlane,
  getContentAsset,
  getCreativeGenerationRun,
  getSelectedContentAssetForDraft,
  listContentAssetsForDraft,
  listCreativeRunsForDraft,
  listCreativeRunsToReconcile,
  markCreativeRunSubmitted,
  selectContentAsset,
  storeCreativeRunResult,
  transitionCreativeRunTerminal,
  updateCreativeRunProgress,
  type ContentAsset,
  type CreativeGenerationRun,
} from "./repository";
import {
  buildFalInput,
  CREATIVE_MEDIA_TEMPLATES,
  creativeMediaRequestSchema,
  estimateCreativeCredits,
  getCreativeMediaTemplate,
} from "./templates";

const terminalStatuses = new Set(["succeeded", "failed", "cancelled"]);

function publicOrigin(): string {
  const configured = process.env.CREATIVE_MEDIA_WEBHOOK_URL?.trim();
  if (configured) return new URL(configured).toString();
  const origin = process.env.PUBLIC_APP_URL?.trim();
  if (!origin) throw new Error("PUBLIC_APP_URL or CREATIVE_MEDIA_WEBHOOK_URL must be configured.");
  return new URL("/api/content/media/fal/webhook", origin).toString();
}

function runView(run: CreativeGenerationRun) {
  return {
    id: run.id,
    draftId: run.draftId,
    templateKey: run.templateKey,
    templateVersion: run.templateVersion,
    mediaKind: run.mediaKind,
    assetRole: run.assetRole,
    modelKey: run.modelKey,
    status: run.status,
    progress: run.progress,
    error: run.error,
    estimatedCredits: run.estimatedCredits,
    actualCredits: run.actualCredits,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

function assetView(asset: ContentAsset) {
  return {
    id: asset.id,
    generationRunId: asset.generationRunId,
    draftId: asset.draftId,
    assetRole: asset.assetRole,
    mediaKind: asset.mediaKind,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    byteSize: asset.byteSize,
    isSelected: asset.isSelected,
    createdAt: asset.createdAt,
    url: `/api/content/media/assets/${asset.id}/file`,
  };
}

function providerErrorMessage(error: unknown): string {
  if (error instanceof FalProviderError) return error.message;
  return error instanceof Error ? error.message : "Creative media generation failed.";
}

function safeFileName(kind: ContentAsset["mediaKind"], index: number, mimeType: string, suggested?: string): string {
  const extensionByMime: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
  };
  const clean = suggested?.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120);
  if (clean && clean.includes(".")) return clean;
  return `${kind}-${index + 1}.${extensionByMime[mimeType] ?? "bin"}`;
}

async function settleSucceeded(run: CreativeGenerationRun): Promise<void> {
  if (!run.creditReservationId) return;
  try {
    await settleReservation({
      reservationId: run.creditReservationId,
      actualCredits: run.estimatedCredits,
      idempotencyKey: `creative-generation:${run.id}:settlement`,
      usageKind: "agent_action",
      metadata: {
        action: "generate_content_media",
        templateKey: run.templateKey,
        modelKey: run.modelKey,
        mediaKind: run.mediaKind,
      },
    });
  } catch (error) {
    await releaseReservation(
      run.creditReservationId,
      `Creative media settlement failed: ${providerErrorMessage(error)}`,
    ).catch(() => undefined);
  }
}

async function failCreativeGeneration(
  run: CreativeGenerationRun,
  message: string,
  status: "failed" | "cancelled" = "failed",
): Promise<boolean> {
  const pool = getPublishingPool(run.organizationId);
  const changed = await transitionCreativeRunTerminal(pool, { id: run.id, status, error: message });
  if (changed && run.creditReservationId) {
    await releaseReservation(run.creditReservationId, message).catch(() => undefined);
  }
  return changed;
}

/** Copy provider outputs into tenant-owned R2 before making the run publishable. */
export async function finalizeCreativeGeneration(
  organizationId: string,
  runId: string,
  providerResult: unknown,
): Promise<void> {
  const pool = getPublishingPool(organizationId);
  let run = await getCreativeGenerationRun(pool, runId);
  if (!run || terminalStatuses.has(run.status)) return;
  await storeCreativeRunResult(pool, runId, providerResult);
  const outputs = normalizeFalOutput(providerResult, run.mediaKind);
  if (outputs.length === 0) {
    await failCreativeGeneration(run, "FAL completed without returning a usable media asset.");
    return;
  }
  const r2 = R2Media.fromEnv();
  if (!r2) {
    await failCreativeGeneration(run, "R2 media storage is not configured.");
    return;
  }
  const created: ContentAsset[] = [];
  const failures: string[] = [];
  for (const [index, output] of outputs.entries()) {
    try {
      const downloaded = await downloadFalAsset(output);
      const fileName = safeFileName(output.kind, index, downloaded.mimeType, output.fileName);
      const r2Key = await r2.putGeneratedForOrganization(
        organizationId,
        run.id,
        index,
        fileName,
        downloaded.bytes,
        downloaded.mimeType,
      );
      created.push(await createContentAsset(pool, {
        organizationId,
        generationRunId: run.id,
        outputIndex: index,
        draftId: run.draftId,
        assetRole: run.assetRole,
        mediaKind: output.kind,
        fileName,
        mimeType: downloaded.mimeType,
        r2Key,
        width: output.width,
        height: output.height,
        durationMs: output.durationMs,
        byteSize: downloaded.bytes.byteLength,
        metadata: output.metadata,
      }));
    } catch (error) {
      failures.push(providerErrorMessage(error));
    }
  }
  if (created.length === 0) {
    run = await getCreativeGenerationRun(pool, runId) ?? run;
    await failCreativeGeneration(run, failures[0] ?? "Generated assets could not be stored.");
    return;
  }
  const selected = await getSelectedContentAssetForDraft(pool, run.draftId, [run.assetRole]);
  if (!selected) await selectContentAsset(pool, created[0].id);
  const changed = await transitionCreativeRunTerminal(pool, {
    id: run.id,
    status: "succeeded",
    actualCredits: run.estimatedCredits,
    error: failures.length ? `${failures.length} output(s) could not be stored.` : null,
  });
  if (changed) await settleSucceeded(run);
}

export async function reconcileCreativeGeneration(
  organizationId: string,
  runId: string,
): Promise<void> {
  const pool = getPublishingPool(organizationId);
  const run = await getCreativeGenerationRun(pool, runId);
  if (!run || terminalStatuses.has(run.status) || !run.providerRequestId) return;
  try {
    const remote = await getFalGenerationStatus(run.deploymentId, run.providerRequestId);
    if (remote.status === "IN_QUEUE") {
      await updateCreativeRunProgress(pool, run.id, "submitted", 10);
      return;
    }
    if (remote.status === "IN_PROGRESS") {
      await updateCreativeRunProgress(pool, run.id, "processing", 50);
      return;
    }
    await updateCreativeRunProgress(pool, run.id, "processing", 85);
    await finalizeCreativeGeneration(
      organizationId,
      run.id,
      await getFalGenerationResult(run.deploymentId, run.providerRequestId),
    );
  } catch (error) {
    if (error instanceof FalProviderError && error.retryable) return;
    await failCreativeGeneration(run, providerErrorMessage(error));
  }
}

export async function sweepCreativeGenerations(): Promise<void> {
  const pending = await listCreativeRunsToReconcile(getPublishingAdminPool(), 25);
  for (const run of pending) await reconcileCreativeGeneration(run.organizationId, run.id);
}

export async function receiveFalWebhook(payload: FalWebhookPayload): Promise<boolean> {
  const control = await findCreativeRunControlPlane(getPublishingAdminPool(), payload.request_id);
  if (!control) return false;
  const pool = getPublishingPool(control.organizationId);
  const run = await getCreativeGenerationRun(pool, control.id);
  if (!run || terminalStatuses.has(run.status)) return true;
  if (payload.status === "ERROR") {
    const message = typeof payload.error === "string"
      ? payload.error
      : payload.error?.message ?? "FAL reported a generation error.";
    await failCreativeGeneration(run, message);
    return true;
  }
  await finalizeCreativeGeneration(control.organizationId, control.id, payload.payload);
  return true;
}

export async function handleStartCreativeGeneration(request: Request, draftId: string): Promise<Response> {
  let reservationId: string | undefined;
  let run: CreativeGenerationRun | undefined;
  try {
    const parsed = creativeMediaRequestSchema.parse(await request.json());
    const template = getCreativeMediaTemplate(parsed.templateKey);
    if (!template) return Response.json({ error: "Unknown creative media template." }, { status: 400 });
    const draft = await getContentDraftById(draftId);
    if (!draft) return Response.json({ error: "Content draft not found." }, { status: 404 });
    if (!process.env.FAL_KEY?.trim()) return Response.json({ error: "Creative media generation is not configured." }, { status: 503 });
    if (!R2Media.fromEnv()) return Response.json({ error: "Creative media storage is not configured." }, { status: 503 });
    const catalog = await getPlatformCatalog();
    const selection = resolveModelSelection({
      models: catalog.models,
      surface: "creative",
      requestedKey: parsed.modelKey,
      requiredCapabilities: [template.requiredCapability],
    });
    if (selection.deployment.provider !== "fal") {
      return Response.json({ error: "The selected creative model is not served by FAL." }, { status: 400 });
    }
    const estimatedCredits = estimateCreativeCredits(template, parsed, selection.model.creditMultiplier);
    const reserved = await reserveVariableCost(request, {
      action: "generate_content_media",
      credits: estimatedCredits,
      capability: "content.full",
    });
    reservationId = reserved.reservationId;
    const providerInput = buildFalInput(template, draft, parsed);
    const pool = getPublishingPool(reserved.context.organizationId);
    run = await createCreativeGenerationRun(pool, {
      organizationId: reserved.context.organizationId,
      draftId,
      templateKey: template.key,
      templateVersion: template.version,
      mediaKind: template.kind,
      assetRole: template.assetRole,
      modelKey: selection.resolvedKey,
      deploymentId: selection.deployment.modelId,
      providerInput,
      creditReservationId: reserved.reservationId,
      estimatedCredits,
      createdBy: reserved.context.session.user.id,
    });
    const providerRequestId = await submitFalGeneration({
      deploymentId: run.deploymentId,
      payload: providerInput,
      webhookUrl: publicOrigin(),
    });
    const submitted = await markCreativeRunSubmitted(pool, run.id, providerRequestId);
    if (!submitted) {
      await cancelFalGeneration(run.deploymentId, providerRequestId).catch(() => undefined);
      throw new Error("The creative generation run could not be submitted.");
    }
    // Also sweeps older abandoned runs; the signed webhook and poll-on-read
    // remain the primary completion paths for this newly submitted run.
    kickJobReconcilers();
    return Response.json({ run: runView({ ...run, providerRequestId, status: "submitted", progress: 5 }) }, { status: 202 });
  } catch (error) {
    if (run) await failCreativeGeneration(run, providerErrorMessage(error));
    else if (reservationId) await releaseReservation(reservationId, providerErrorMessage(error)).catch(() => undefined);
    const commercial = commercialErrorResponse(error);
    if (commercial) return commercial;
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid creative generation request.", issues: error.issues }, { status: 400 });
    if (error instanceof ModelPolicyError) return Response.json({ error: error.message, code: error.code }, { status: 400 });
    const status = error instanceof FalProviderError && error.retryable ? 503 : 500;
    return Response.json({ error: providerErrorMessage(error) }, { status });
  }
}

export async function handleListCreativeMedia(request: Request, draftId: string): Promise<Response> {
  const context = await getAuthorizationContext(request.headers);
  if (!context) return Response.json({ error: "Unauthenticated" }, { status: 401 });
  const draft = await getContentDraftById(draftId);
  if (!draft) return Response.json({ error: "Content draft not found." }, { status: 404 });
  const pool = getPublishingPool(context.organizationId);
  let runs = await listCreativeRunsForDraft(pool, draftId);
  for (const active of runs.filter((entry) => !terminalStatuses.has(entry.status)).slice(0, 3)) {
    await reconcileCreativeGeneration(context.organizationId, active.id);
  }
  runs = await listCreativeRunsForDraft(pool, draftId);
  const assets = await listContentAssetsForDraft(pool, draftId);
  const catalog = await getPlatformCatalog();
  const templates = CREATIVE_MEDIA_TEMPLATES.map((template) => ({
    key: template.key,
    version: template.version,
    name: template.name,
    description: template.description,
    kind: template.kind,
    assetRole: template.assetRole,
    defaultAspectRatio: template.defaultAspectRatio,
    allowedAspectRatios: template.allowedAspectRatios ?? [],
    defaultDurationSeconds: template.defaultDurationSeconds,
    defaultVariations: template.defaultVariations,
    models: publicModelOptions(
      listModelOptions(catalog.models, {
        surface: "creative",
        requiredCapabilities: [template.requiredCapability],
      }),
      { surface: "creative", requiredCapabilities: [template.requiredCapability] },
    ),
  })).filter((template) => template.models.length > 0);
  return Response.json({ templates, runs: runs.map(runView), assets: assets.map(assetView) });
}

export async function handleGetCreativeRun(request: Request, runId: string): Promise<Response> {
  const context = await getAuthorizationContext(request.headers);
  if (!context) return Response.json({ error: "Unauthenticated" }, { status: 401 });
  await reconcileCreativeGeneration(context.organizationId, runId);
  const pool = getPublishingPool(context.organizationId);
  const run = await getCreativeGenerationRun(pool, runId);
  if (!run) return Response.json({ error: "Creative generation run not found." }, { status: 404 });
  const assets = (await listContentAssetsForDraft(pool, run.draftId))
    .filter((asset) => asset.generationRunId === run.id);
  return Response.json({ run: runView(run), assets: assets.map(assetView) });
}

export async function handleCancelCreativeRun(request: Request, runId: string): Promise<Response> {
  const context = await getAuthorizationContext(request.headers);
  if (!context) return Response.json({ error: "Unauthenticated" }, { status: 401 });
  const pool = getPublishingPool(context.organizationId);
  const run = await getCreativeGenerationRun(pool, runId);
  if (!run) return Response.json({ error: "Creative generation run not found." }, { status: 404 });
  if (terminalStatuses.has(run.status)) return Response.json({ error: "This generation is already finished." }, { status: 409 });
  if (run.providerRequestId) {
    try {
      await cancelFalGeneration(run.deploymentId, run.providerRequestId);
    } catch (error) {
      if (error instanceof FalProviderError && error.retryable) {
        return Response.json({ error: error.message }, { status: 503 });
      }
    }
  }
  const changed = await failCreativeGeneration(run, "Cancelled by the user.", "cancelled");
  return changed
    ? Response.json({ cancelled: true })
    : Response.json({ error: "This generation is already finished." }, { status: 409 });
}

export async function handleSelectCreativeAsset(
  request: Request,
  draftId: string,
  assetId: string,
): Promise<Response> {
  const context = await getAuthorizationContext(request.headers);
  if (!context) return Response.json({ error: "Unauthenticated" }, { status: 401 });
  const pool = getPublishingPool(context.organizationId);
  const asset = await getContentAsset(pool, assetId);
  if (!asset || asset.draftId !== draftId) return Response.json({ error: "Content asset not found." }, { status: 404 });
  const selected = await selectContentAsset(pool, assetId);
  return Response.json({ asset: assetView(selected!) });
}

export async function handleCreativeAssetFile(request: Request, assetId: string): Promise<Response> {
  const context = await getAuthorizationContext(request.headers);
  if (!context) return Response.json({ error: "Unauthenticated" }, { status: 401 });
  const asset = await getContentAsset(getPublishingPool(context.organizationId), assetId);
  if (!asset) return Response.json({ error: "Content asset not found." }, { status: 404 });
  const r2 = R2Media.fromEnv();
  if (!r2) return Response.json({ error: "Creative media storage is not configured." }, { status: 503 });
  const bytes = await r2.get(asset.r2Key);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename="${asset.fileName.replace(/["\\]/g, "-")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
