import { createHmac, timingSafeEqual } from "node:crypto";
import { platformCatalogSchema } from "./catalog-schema";
import { readPlatformCatalogSnapshot, writePlatformCatalogSnapshot } from "./catalog-repository";
import type { PlatformCatalog } from "./catalog";

const CACHE_TTL_MS = 60_000;
let memory: {
  catalog: PlatformCatalog;
  loadedAt: number;
  source: "verified" | "development";
} | undefined;
let refreshInFlight: Promise<PlatformCatalog> | undefined;

/**
 * Local development must not depend on a CMS snapshot surviving a database
 * reset. Production remains fail-closed and accepts only a signed catalog or
 * its last verified snapshot.
 */
export function localDevelopmentPlatformCatalog(): PlatformCatalog {
  const languageSurfaces = ["chat", "content", "outreach", "cascade"] as const;
  return {
    schemaVersion: 1,
    catalogVersion: "0".repeat(64),
    generatedAt: "2026-01-01T00:00:00.000Z",
    models: [
      {
        key: "text-fast",
        name: "Fast",
        family: "Local development",
        provider: "litellm",
        deploymentId: "taicho-text-fast",
        kind: "language",
        description: "Fast responses for lightweight workspace requests.",
        capabilities: ["text-generation", "tool-use"],
        surfaces: [...languageSurfaces],
        speed: "fast",
        creditMultiplier: 0.5,
        status: "available",
        operationalStatus: "degraded",
        sortOrder: 10,
      },
      {
        key: "text-balanced",
        name: "Balanced",
        family: "Local development",
        provider: "litellm",
        deploymentId: "taicho-text-balanced",
        kind: "language",
        description: "Balanced reasoning and tool use for everyday work.",
        capabilities: ["text-generation", "tool-use", "structured-output"],
        surfaces: [...languageSurfaces],
        speed: "balanced",
        creditMultiplier: 1,
        status: "available",
        recommended: true,
        operationalStatus: "degraded",
        sortOrder: 20,
      },
      {
        key: "text-reasoning",
        name: "Reasoning",
        family: "Local development",
        provider: "litellm",
        deploymentId: "taicho-text-reasoning",
        kind: "language",
        description: "Deeper reasoning for complex workspace decisions.",
        capabilities: ["text-generation", "tool-use", "structured-output"],
        surfaces: [...languageSurfaces],
        speed: "deliberate",
        creditMultiplier: 3,
        status: "available",
        operationalStatus: "degraded",
        sortOrder: 30,
      },
      {
        key: "image-fast",
        name: "Image Fast",
        family: "FLUX",
        provider: "fal",
        deploymentId: "fal-ai/flux/schnell",
        kind: "image",
        description: "Fast image generation for social posts, covers, thumbnails, and ads.",
        capabilities: ["image-generation"],
        surfaces: ["creative"],
        speed: "fast",
        creditMultiplier: 1,
        status: "available",
        recommended: true,
        operationalStatus: "degraded",
        sortOrder: 100,
      },
      {
        key: "video-balanced",
        name: "Video Balanced",
        family: "Wan",
        provider: "fal",
        deploymentId: "fal-ai/wan/v2.1.5/text-to-video",
        kind: "video",
        description: "Text-to-video generation for short-form creative assets.",
        capabilities: ["video-generation"],
        surfaces: ["creative"],
        speed: "balanced",
        creditMultiplier: 1,
        status: "available",
        recommended: true,
        operationalStatus: "degraded",
        sortOrder: 110,
      },
      {
        key: "audio-fast",
        name: "Voice Fast",
        family: "Chatterbox",
        provider: "fal",
        deploymentId: "fal-ai/chatterbox/text-to-speech",
        kind: "audio",
        description: "Speech generation for voiceovers and audio-first content.",
        capabilities: ["audio-generation"],
        surfaces: ["creative"],
        speed: "fast",
        creditMultiplier: 1,
        status: "preview",
        recommended: true,
        operationalStatus: "degraded",
        sortOrder: 120,
      },
    ],
  };
}

function configuredUrl(): string {
  const explicit = process.env.PLATFORM_CATALOG_URL?.trim();
  if (explicit) return explicit;
  const cms = process.env.PAYLOAD_INTERNAL_URL?.trim().replace(/\/+$/, "");
  if (cms) return `${cms}/api/platform/catalog`;
  throw new Error("The platform catalog service is not configured.");
}

function signatureIsValid(body: string, header: string | null, secret: string): boolean {
  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"));
  const actual = Buffer.from((header ?? "").replace(/^sha256=/, ""));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function refreshPlatformCatalog(
  fetchImpl: typeof fetch = fetch,
  persist: (catalog: PlatformCatalog) => Promise<void> = writePlatformCatalogSnapshot,
): Promise<PlatformCatalog> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const apiKey = process.env.PLATFORM_CATALOG_API_KEY?.trim();
    const signingSecret = process.env.PLATFORM_CATALOG_SIGNING_SECRET?.trim();
    if (!apiKey || !signingSecret) throw new Error("The platform catalog service is not configured.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetchImpl(configuredUrl(), {
        headers: { "x-api-key": apiKey },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Platform catalog returned ${response.status}.`);
      const body = await response.text();
      if (!signatureIsValid(body, response.headers.get("x-platform-catalog-signature"), signingSecret)) {
        throw new Error("Platform catalog signature verification failed.");
      }
      const catalog = platformCatalogSchema.parse(JSON.parse(body)) as PlatformCatalog;
      try {
        await persist(catalog);
      } catch (error) {
        console.warn("Could not persist the platform catalog snapshot; using the verified in-memory copy.", error);
      }
      memory = { catalog, loadedAt: Date.now(), source: "verified" };
      return catalog;
    } finally {
      clearTimeout(timeout);
    }
  })().finally(() => { refreshInFlight = undefined; });
  return refreshInFlight;
}

export async function getPlatformCatalog(): Promise<PlatformCatalog> {
  if (
    memory
    && Date.now() - memory.loadedAt < CACHE_TTL_MS
    && !(process.env.NODE_ENV === "production" && memory.source === "development")
  ) return memory.catalog;
  let stored: Awaited<ReturnType<typeof readPlatformCatalogSnapshot>> = null;
  try {
    stored = await readPlatformCatalogSnapshot();
    if (stored && Date.now() - stored.syncedAt.getTime() < CACHE_TTL_MS) {
      memory = { catalog: stored.catalog, loadedAt: Date.now(), source: "verified" };
      return stored.catalog;
    }
  } catch (error) {
    console.warn("Could not read the materialized platform catalog.", error);
  }
  try {
    return await refreshPlatformCatalog();
  } catch (error) {
    if (stored) {
      console.warn("Using the last known good platform catalog.", error);
      memory = { catalog: stored.catalog, loadedAt: Date.now(), source: "verified" };
      return stored.catalog;
    }
    if (process.env.NODE_ENV !== "production") {
      console.warn("Using the deterministic local development model catalog.", error);
      const catalog = localDevelopmentPlatformCatalog();
      memory = { catalog, loadedAt: Date.now(), source: "development" };
      return catalog;
    }
    throw error;
  }
}

export function clearPlatformCatalogMemoryCache(): void {
  memory = undefined;
}
