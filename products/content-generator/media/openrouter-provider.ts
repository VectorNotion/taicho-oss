const OPENROUTER_ORIGIN = "https://openrouter.ai";
const OPENROUTER_API_ORIGIN = `${OPENROUTER_ORIGIN}/api/v1`;
const DEFAULT_MAX_ASSET_BYTES = 100 * 1024 * 1024;

export class OpenRouterMediaError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = "OpenRouterMediaError";
  }
}

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new OpenRouterMediaError("OPENROUTER_API_KEY is not configured.");
  return key;
}

function maxAssetBytes(): number {
  const configured = Number(process.env.CREATIVE_MEDIA_MAX_BYTES ?? DEFAULT_MAX_ASSET_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, DEFAULT_MAX_ASSET_BYTES)
    : DEFAULT_MAX_ASSET_BYTES;
}

function errorDetail(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (typeof record.error === "string" && record.error.trim()) return record.error;
    if (record.error && typeof record.error === "object") {
      const message = (record.error as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  return `OpenRouter returned HTTP ${status}.`;
}

async function boundedResponseBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new OpenRouterMediaError("OpenRouter returned a response larger than the configured media limit.");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new OpenRouterMediaError("OpenRouter returned a response larger than the configured media limit.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

async function openRouterJson<T>(input: {
  url: URL;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000);
  timeout.unref?.();
  try {
    const response = await (input.fetchImpl ?? fetch)(input.url, {
      method: input.method ?? "GET",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        Accept: "application/json",
        ...(input.body ? { "Content-Type": "application/json" } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new OpenRouterMediaError("OpenRouter returned an unexpected redirect.", true);
    }
    const bytes = await boundedResponseBytes(response, input.maxResponseBytes ?? 2 * 1024 * 1024);
    let payload: unknown = {};
    try {
      payload = bytes.byteLength ? JSON.parse(bytes.toString("utf8")) : {};
    } catch {
      payload = {};
    }
    if (!response.ok) {
      throw new OpenRouterMediaError(
        errorDetail(payload, response.status),
        response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof OpenRouterMediaError) throw error;
    throw new OpenRouterMediaError(
      controller.signal.aborted
        ? "OpenRouter request timed out."
        : "Could not reach OpenRouter.",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function cleanBase64(value: string): string {
  const comma = value.indexOf(",");
  const candidate = value.startsWith("data:") && comma >= 0 ? value.slice(comma + 1) : value;
  return candidate.replace(/\s+/g, "");
}

function decodeImage(value: unknown): Buffer {
  if (typeof value !== "string" || !value.trim()) {
    throw new OpenRouterMediaError("OpenRouter returned an image without encoded pixels.");
  }
  const encoded = cleanBase64(value);
  if (!/^[a-z0-9+/]*={0,2}$/i.test(encoded)) {
    throw new OpenRouterMediaError("OpenRouter returned invalid image data.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.byteLength) throw new OpenRouterMediaError("OpenRouter returned an empty image.");
  if (bytes.byteLength > maxAssetBytes()) {
    throw new OpenRouterMediaError("The generated image exceeded the configured media size limit.");
  }
  return bytes;
}

function imageMimeType(value: unknown): string {
  return typeof value === "string" && /^image\/[a-z0-9.+-]+$/i.test(value)
    ? value.toLowerCase()
    : "image/png";
}

export interface OpenRouterImageGeneration {
  outputs: Array<{ bytes: Buffer; mimeType: string; fileName: string }>;
  providerResult: Record<string, unknown>;
}

export async function generateOpenRouterImage(input: {
  model: string;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<OpenRouterImageGeneration> {
  const result = await openRouterJson<{
    created?: number;
    data?: Array<{ b64_json?: unknown; media_type?: unknown }>;
    usage?: unknown;
  }>({
    url: new URL(`${OPENROUTER_API_ORIGIN}/images`),
    method: "POST",
    body: { model: input.model, ...input.payload },
    timeoutMs: 180_000,
    maxResponseBytes: maxAssetBytes(),
    fetchImpl: input.fetchImpl,
  });
  if (!Array.isArray(result.data) || !result.data.length) {
    throw new OpenRouterMediaError("OpenRouter completed without returning an image.");
  }
  const outputs = result.data.map((output, index) => {
    const mimeType = imageMimeType(output.media_type);
    return {
      bytes: decodeImage(output.b64_json),
      mimeType,
      fileName: `image-${index + 1}.${mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1] ?? "png"}`,
    };
  });
  return {
    outputs,
    providerResult: {
      created: result.created,
      usage: result.usage,
      outputCount: outputs.length,
      mediaTypes: outputs.map((output) => output.mimeType),
    },
  };
}

function canonicalVideoUrl(value: unknown, field: string): URL {
  if (typeof value !== "string" || !value.trim()) {
    throw new OpenRouterMediaError(`OpenRouter did not return a ${field}.`);
  }
  let url: URL;
  try {
    url = new URL(value, OPENROUTER_ORIGIN);
  } catch {
    throw new OpenRouterMediaError(`OpenRouter returned an invalid ${field}.`);
  }
  if (
    url.protocol !== "https:"
    || url.origin !== OPENROUTER_ORIGIN
    || !/^\/api\/v1\/videos\/[^/]+$/.test(url.pathname)
    || url.search
    || url.hash
  ) {
    throw new OpenRouterMediaError(`OpenRouter returned an untrusted ${field}.`);
  }
  return url;
}

function videoContentUrl(statusUrl: string, index = 0): string {
  const status = canonicalVideoUrl(statusUrl, "polling URL");
  status.pathname = `${status.pathname}/content`;
  status.searchParams.set("index", String(index));
  return status.toString();
}

export interface OpenRouterVideoSubmission {
  requestId: string;
  requestUrl: string;
  statusUrl: string;
  resultUrl: string;
}

export async function submitOpenRouterVideo(input: {
  model: string;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<OpenRouterVideoSubmission> {
  const requestUrl = new URL(`${OPENROUTER_API_ORIGIN}/videos`);
  const result = await openRouterJson<{
    id?: unknown;
    polling_url?: unknown;
    status?: unknown;
  }>({
    url: requestUrl,
    method: "POST",
    body: { model: input.model, ...input.payload },
    fetchImpl: input.fetchImpl,
  });
  if (typeof result.id !== "string" || !result.id.trim()) {
    throw new OpenRouterMediaError("OpenRouter did not return a video job ID.");
  }
  if (result.status !== "pending" && result.status !== "in_progress") {
    throw new OpenRouterMediaError("OpenRouter returned an unexpected video submission status.");
  }
  const statusUrl = canonicalVideoUrl(result.polling_url, "polling URL").toString();
  return {
    requestId: result.id,
    requestUrl: requestUrl.toString(),
    statusUrl,
    resultUrl: videoContentUrl(statusUrl),
  };
}

export type OpenRouterVideoStatus = "pending" | "in_progress" | "completed" | "failed";

export interface OpenRouterVideoJob {
  id: string;
  status: OpenRouterVideoStatus;
  error?: string;
  generationId?: string;
  unsignedUrls: string[];
  usage?: unknown;
}

export async function getOpenRouterVideoStatus(
  statusUrl: string,
  fetchImpl?: typeof fetch,
): Promise<OpenRouterVideoJob> {
  const result = await openRouterJson<{
    id?: unknown;
    status?: unknown;
    error?: unknown;
    generation_id?: unknown;
    unsigned_urls?: unknown;
    usage?: unknown;
  }>({ url: canonicalVideoUrl(statusUrl, "polling URL"), fetchImpl });
  if (typeof result.id !== "string" || !result.id.trim()) {
    throw new OpenRouterMediaError("OpenRouter returned a video status without a job ID.", true);
  }
  if (!new Set(["pending", "in_progress", "completed", "failed"]).has(String(result.status))) {
    throw new OpenRouterMediaError("OpenRouter returned an unknown video job status.", true);
  }
  return {
    id: result.id,
    status: result.status as OpenRouterVideoStatus,
    error: typeof result.error === "string" ? result.error : undefined,
    generationId: typeof result.generation_id === "string" ? result.generation_id : undefined,
    unsignedUrls: Array.isArray(result.unsigned_urls)
      ? result.unsigned_urls.filter((url): url is string => typeof url === "string")
      : [],
    usage: result.usage,
  };
}

export async function downloadOpenRouterVideo(input: {
  statusUrl: string;
  index?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> {
  const index = input.index ?? 0;
  const url = new URL(videoContentUrl(input.statusUrl, index));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  timeout.unref?.();
  try {
    const response = await (input.fetchImpl ?? fetch)(url, {
      headers: { Authorization: `Bearer ${apiKey()}` },
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new OpenRouterMediaError("OpenRouter returned an unexpected video download redirect.", true);
    }
    if (!response.ok) {
      throw new OpenRouterMediaError(`OpenRouter video download returned HTTP ${response.status}.`, response.status >= 500);
    }
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "video/mp4";
    if (!mimeType.startsWith("video/")) {
      throw new OpenRouterMediaError("OpenRouter returned a non-video result for the video job.");
    }
    return {
      bytes: await boundedResponseBytes(response, maxAssetBytes()),
      mimeType,
      fileName: `video-${index + 1}.${mimeType === "video/webm" ? "webm" : "mp4"}`,
    };
  } catch (error) {
    if (error instanceof OpenRouterMediaError) throw error;
    throw new OpenRouterMediaError(
      controller.signal.aborted
        ? "OpenRouter video download timed out."
        : "Could not download the generated video from OpenRouter.",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}
