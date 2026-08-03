import { createHash, createPublicKey, verify } from "node:crypto";
import { safeFetchPublicUrl } from "@content-automation/platform/network/safe-fetch";
import type { CreativeMediaKind } from "./templates";

const FAL_QUEUE_ORIGIN = "https://queue.fal.run";
const FAL_JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";
const DEFAULT_MAX_ASSET_BYTES = 100 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export type FalQueueStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";

export interface FalOutputAsset {
  url: string;
  kind: CreativeMediaKind;
  mimeType?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  fileName?: string;
  metadata: Record<string, unknown>;
}

export interface FalWebhookPayload {
  request_id: string;
  status: "OK" | "ERROR";
  payload?: unknown;
  error?: string | { message?: string };
}

export class FalProviderError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = "FalProviderError";
  }
}

function falKey(): string {
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new FalProviderError("FAL_KEY is not configured.");
  return key;
}

async function falRequest<T>(url: URL, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Key ${falKey()}`,
        "Content-Type": "application/json",
        "X-Fal-Store-IO": "0",
        ...init.headers,
      },
      cache: "no-store",
    });
    const body = await response.text();
    let parsed: unknown;
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      parsed = {};
    }
    if (!response.ok) {
      const detail = parsed && typeof parsed === "object" && "detail" in parsed
        ? String((parsed as { detail?: unknown }).detail)
        : `FAL returned HTTP ${response.status}.`;
      throw new FalProviderError(detail, response.status === 429 || response.status >= 500);
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof FalProviderError) throw error;
    throw new FalProviderError(
      error instanceof Error && error.name === "AbortError"
        ? "FAL request timed out."
        : "Could not reach FAL.",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function requestUrl(deploymentId: string, requestId?: string, suffix?: string): URL {
  const normalized = deploymentId.replace(/^\/+|\/+$/g, "");
  const parts = [FAL_QUEUE_ORIGIN, normalized];
  if (requestId) parts.push("requests", encodeURIComponent(requestId));
  if (suffix) parts.push(suffix);
  return new URL(parts.join("/"));
}

export async function submitFalGeneration(input: {
  deploymentId: string;
  payload: Record<string, unknown>;
  webhookUrl: string;
}): Promise<string> {
  const url = requestUrl(input.deploymentId);
  url.searchParams.set("fal_webhook", input.webhookUrl);
  const response = await falRequest<{ request_id?: string }>(url, {
    method: "POST",
    body: JSON.stringify(input.payload),
  });
  if (!response.request_id) throw new FalProviderError("FAL did not return a request ID.");
  return response.request_id;
}

export async function getFalGenerationStatus(
  deploymentId: string,
  requestId: string,
): Promise<{ status: FalQueueStatus; responseUrl?: string }> {
  const response = await falRequest<Record<string, unknown>>(
    requestUrl(deploymentId, requestId, "status"),
  );
  const status = response.status;
  if (status !== "IN_QUEUE" && status !== "IN_PROGRESS" && status !== "COMPLETED") {
    throw new FalProviderError("FAL returned an unknown queue status.", true);
  }
  return {
    status,
    responseUrl: typeof response.response_url === "string" ? response.response_url : undefined,
  };
}

export function getFalGenerationResult(
  deploymentId: string,
  requestId: string,
): Promise<unknown> {
  return falRequest<unknown>(requestUrl(deploymentId, requestId));
}

export async function cancelFalGeneration(deploymentId: string, requestId: string): Promise<void> {
  await falRequest(requestUrl(deploymentId, requestId, "cancel"), { method: "PUT" });
}

function inferredKind(hint: string, mimeType: string | undefined, url: string): CreativeMediaKind | null {
  const value = `${hint} ${mimeType ?? ""} ${url}`.toLowerCase();
  if (value.includes("video") || /\.(mp4|webm|mov)(?:\?|$)/.test(value)) return "video";
  if (value.includes("audio") || /\.(mp3|wav|m4a|ogg|flac)(?:\?|$)/.test(value)) return "audio";
  if (value.includes("image") || /\.(png|jpe?g|webp|gif|avif)(?:\?|$)/.test(value)) return "image";
  return null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Normalize the deliberately non-uniform output shapes used by FAL models. */
export function normalizeFalOutput(output: unknown, expectedKind: CreativeMediaKind): FalOutputAsset[] {
  const assets: FalOutputAsset[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown, hint: string, depth: number) => {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, hint, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const url = typeof record.url === "string"
      ? record.url
      : typeof record.audio_url === "string"
        ? record.audio_url
        : typeof record.video_url === "string"
          ? record.video_url
          : typeof record.image_url === "string"
            ? record.image_url
            : undefined;
    if (url && /^https:\/\//i.test(url) && !seen.has(url)) {
      const mimeType = typeof record.content_type === "string"
        ? record.content_type
        : typeof record.mime_type === "string"
          ? record.mime_type
          : undefined;
      const kind = inferredKind(hint, mimeType, url) ?? expectedKind;
      assets.push({
        url,
        kind,
        mimeType,
        width: finiteNumber(record.width),
        height: finiteNumber(record.height),
        durationMs: finiteNumber(record.duration_ms)
          ?? (finiteNumber(record.duration) !== undefined ? Math.round(finiteNumber(record.duration)! * 1_000) : undefined),
        fileName: typeof record.file_name === "string" ? record.file_name : undefined,
        metadata: Object.fromEntries(
          Object.entries(record).filter(([key]) => !["url", "audio_url", "video_url", "image_url"].includes(key)),
        ),
      });
      seen.add(url);
    }
    for (const [key, nested] of Object.entries(record)) {
      if (nested && typeof nested === "object") visit(nested, `${hint}.${key}`, depth + 1);
    }
  };
  visit(output, "output", 0);
  return assets;
}

function maxAssetBytes(): number {
  const configured = Number(process.env.CREATIVE_MEDIA_MAX_BYTES ?? DEFAULT_MAX_ASSET_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, 100 * 1024 * 1024)
    : DEFAULT_MAX_ASSET_BYTES;
}

export async function downloadFalAsset(asset: FalOutputAsset): Promise<{
  bytes: Buffer;
  mimeType: string;
}> {
  const url = new URL(asset.url);
  const response = await safeFetchPublicUrl(url, {}, {
    allowedHosts: [url.hostname],
    maxResponseBytes: maxAssetBytes(),
    timeoutMs: 60_000,
  });
  if (!response.ok) throw new FalProviderError(`Generated asset download returned HTTP ${response.status}.`, true);
  return {
    bytes: Buffer.from(response.bytes),
    mimeType: asset.mimeType ?? response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream",
  };
}

type FalJwk = Record<string, string | undefined> & { kid?: string };
let jwksCache: { keys: FalJwk[]; expiresAt: number } | undefined;

async function falJwks(fetchImpl: typeof fetch = fetch): Promise<FalJwk[]> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetchImpl(FAL_JWKS_URL, { cache: "no-store" });
  if (!response.ok) throw new FalProviderError("Could not load FAL webhook signing keys.", true);
  const payload = await response.json() as { keys?: FalJwk[] };
  if (!payload.keys?.length) throw new FalProviderError("FAL webhook signing keys were empty.", true);
  jwksCache = { keys: payload.keys, expiresAt: Date.now() + 60 * 60 * 1_000 };
  return payload.keys;
}

function signatureBytes(value: string): Buffer {
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return Buffer.from(value, "base64");
  }
}

/** Verify FAL's Ed25519 signature over request metadata and the exact raw body. */
export async function verifyFalWebhook(input: {
  rawBody: string;
  headers: Headers;
  now?: number;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const requestId = input.headers.get("x-fal-webhook-request-id");
  const userId = input.headers.get("x-fal-webhook-user-id");
  const timestamp = input.headers.get("x-fal-webhook-timestamp");
  const signature = input.headers.get("x-fal-webhook-signature");
  if (!requestId || !userId || !timestamp || !signature) return false;
  const timestampMs = Number(timestamp) * 1_000;
  if (!Number.isFinite(timestampMs) || Math.abs((input.now ?? Date.now()) - timestampMs) > 5 * 60_000) return false;
  const bodyHash = createHash("sha256").update(input.rawBody).digest("hex");
  const message = Buffer.from([requestId, userId, timestamp, bodyHash].join("\n"));
  const keys = await falJwks(input.fetchImpl);
  return keys.some((jwk) => {
    try {
      return verify(null, message, createPublicKey({ key: jwk, format: "jwk" }), signatureBytes(signature));
    } catch {
      return false;
    }
  });
}
