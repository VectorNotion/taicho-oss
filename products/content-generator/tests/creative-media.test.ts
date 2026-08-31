import assert from "node:assert/strict";
import test from "node:test";
import type { ContentIdea } from "../domain/content";
import {
  downloadOpenRouterVideo,
  generateOpenRouterImage,
  getOpenRouterVideoStatus,
  OpenRouterMediaError,
  submitOpenRouterVideo,
} from "../media/openrouter-provider";
import { applyExactTextOverlay, rasterizeImageForVision } from "../media/image-processing";
import { generateProviderMediaPrompt } from "../media/prompt-director";
import { normalizeStoredVisualBrief } from "../media/repository";
import {
  buildProviderInput,
  creativeMediaRequestSchema,
  imageVisualTypes,
  mediaCredits,
  mediaDeployment,
} from "../media/templates";

const base: ContentIdea = {
  id: "idea-1", title: "Durable creative workflows", description: "Own the final files and make callbacks replay safe.",
  rationale: "A practical guide", priority: "high", status: "refined",
  outline: ["Queue the work", "Store final assets"], keyPoints: ["Callbacks are replay safe", "Storage is tenant owned"],
  createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z",
};

test("Visual Brief is expanded by the LLM visual director before provider submission", async () => {
  const request = creativeMediaRequestSchema.parse({
    brief: { kind: "image", visualType: "editorial-scene", exactOnMediaText: "Own the outcome", creativeDirection: "Calm, editorial" },
  });
  const directedPrompt = await generateProviderMediaPrompt(base, request.brief, async (args) => {
    assert.match(args.instructions, /senior visual director/);
    assert.match(args.instructions, /composition/);
    assert.match(args.prompt, /Required visual type: Editorial scene/);
    assert.match(args.prompt, /Own the outcome/);
    assert.match(args.prompt, /Durable creative workflows/);
    return "A calm editorial scene centered on a durable creative operations desk, with one clearly dominant archival object representing ownership. Compose the square frame with a strong foreground-to-background hierarchy, restrained navy and warm amber materials, soft directional studio light, tactile paper and storage textures, and generous negative space along the lower third for application-owned copy. Use subtle visual cues for queued work, durable storage, and replay-safe callbacks without showing literal interfaces. Keep the image credible, polished, uncluttered, and suitable for a professional content campaign. Do not render text, logos, watermarks, statistics, or unsupported product details.";
  });
  assert.deepEqual(buildProviderInput(request, directedPrompt), {
    prompt: directedPrompt, resolution: "1K", aspect_ratio: "1:1", n: 1,
  });
  assert.equal(mediaDeployment(request).deploymentId, "x-ai/grok-imagine-image-quality");
  assert.equal(mediaCredits(request), 40);
  assert.equal(creativeMediaRequestSchema.safeParse({ ...request, modelKey: "user-choice" }).success, false);
  assert.equal(creativeMediaRequestSchema.safeParse({ ...request, aspectRatio: "16:9" }).success, false);
  assert.equal(creativeMediaRequestSchema.safeParse({ ...request, variations: 3 }).success, false);
  assert.equal(creativeMediaRequestSchema.safeParse({
    brief: { kind: "image", visualType: "infographic", creativeDirection: "x".repeat(2_001) },
  }).success, false, "new creative direction remains bounded at the API boundary");
});

test("the visual director rejects a shallow provider prompt instead of falling back", async () => {
  const request = creativeMediaRequestSchema.parse({ brief: { kind: "image", visualType: "infographic" } });
  await assert.rejects(
    generateProviderMediaPrompt(base, request.brief, async () => "Create an infographic."),
    /Too small|at least 400/i,
  );
});

test("legacy creative directions are normalized without rejecting the media gallery", () => {
  const normalized = normalizeStoredVisualBrief({
    kind: "image",
    visualType: "infographic",
    creativeDirection: "legacy prompt ".repeat(300),
  });
  assert.equal(normalized.creativeDirection?.length, 2_000);
});

test("every image visual type routes to Grok Imagine on OpenRouter with no deterministic generation path", () => {
  for (const visualType of imageVisualTypes) {
    const request = creativeMediaRequestSchema.parse({ brief: { kind: "image", visualType } });
    assert.deepEqual(mediaDeployment(request), {
      provider: "openrouter",
      deploymentId: "x-ai/grok-imagine-image-quality",
      credits: 40,
    });
    assert.equal(mediaCredits(request), 40);
  }
});

test("video V1 exposes one cinematic clip type and a fixed deployment", () => {
  const request = creativeMediaRequestSchema.parse({ brief: { kind: "video", visualType: "cinematic-clip" } });
  assert.equal(mediaDeployment(request).deploymentId, "bytedance/seedance-2.0-mini");
  assert.deepEqual(buildProviderInput(request, "A directed cinematic prompt."), {
    prompt: "A directed cinematic prompt.", aspect_ratio: "9:16", duration: 5,
    resolution: "720p", generate_audio: true,
  });
  assert.equal(mediaCredits(request), 600);
  assert.equal(creativeMediaRequestSchema.safeParse({ brief: { kind: "video", visualType: "talking-head" } }).success, false);
  assert.equal(creativeMediaRequestSchema.safeParse({ brief: { kind: "video", visualType: "cinematic-clip", exactOnMediaText: "Not yet" } }).success, false);
});

test("exact image text is composed onto provider-generated pixels", async () => {
  const rendered = await applyExactTextOverlay({
    bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="1200" height="1200" fill="#315"/></svg>'),
    mimeType: "image/svg+xml", text: "Exact <copy> & punctuation!",
    width: 1200, height: 1200,
  });
  assert.equal(rendered.mimeType, "image/png");
  assert.equal(rendered.width, 1200);
  assert.equal(rendered.height, 1200);
  assert.deepEqual([...rendered.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("SVG artwork is rasterized before it is sent to a vision model", async () => {
  const legacySvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#315"/></svg>');
  const vision = await rasterizeImageForVision({ bytes: legacySvg, mimeType: "image/svg+xml" });
  assert.equal(vision.mimeType, "image/png");
  assert.deepEqual([...vision.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("OpenRouter image generation sends the fixed Grok model and decodes returned pixels", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  try {
    let request: { url: string; authorization: string | null; body: Record<string, unknown> } | undefined;
    const pixels = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const generated = await generateOpenRouterImage({
      model: "x-ai/grok-imagine-image-quality",
      payload: { prompt: "hello", resolution: "1K", aspect_ratio: "1:1", n: 1 },
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        request = {
          url: String(url),
          authorization: new Headers(init?.headers).get("authorization"),
          body: JSON.parse(String(init?.body)),
        };
        return Response.json({
          created: 123,
          data: [{ b64_json: pixels.toString("base64") }],
          usage: { cost: 0.05 },
        });
      }) as typeof fetch,
    });
    assert.deepEqual(request, {
      url: "https://openrouter.ai/api/v1/images",
      authorization: "Bearer test-key",
      body: {
        model: "x-ai/grok-imagine-image-quality",
        prompt: "hello", resolution: "1K", aspect_ratio: "1:1", n: 1,
      },
    });
    assert.deepEqual(generated.outputs[0]?.bytes, pixels);
    assert.equal(generated.outputs[0]?.mimeType, "image/png");
    assert.deepEqual(generated.providerResult, {
      created: 123, usage: { cost: 0.05 }, outputCount: 1, mediaTypes: ["image/png"],
    });
  } finally { process.env.OPENROUTER_API_KEY = previous; }
});

test("OpenRouter video submission preserves its canonical polling and content URLs", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  try {
    let submitted: Record<string, unknown> | undefined;
    const queue = await submitOpenRouterVideo({
      model: "bytedance/seedance-2.0-mini",
      payload: { prompt: "hello", duration: 5, resolution: "720p", aspect_ratio: "9:16", generate_audio: true },
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        submitted = JSON.parse(String(init?.body));
        return Response.json({
          id: "job-1",
          polling_url: "/api/v1/videos/job-1",
          status: "pending",
        }, { status: 202 });
      }) as typeof fetch,
    });
    assert.equal(submitted?.model, "bytedance/seedance-2.0-mini");
    assert.deepEqual(queue, {
      requestId: "job-1",
      requestUrl: "https://openrouter.ai/api/v1/videos",
      statusUrl: "https://openrouter.ai/api/v1/videos/job-1",
      resultUrl: "https://openrouter.ai/api/v1/videos/job-1/content?index=0",
    });
  } finally { process.env.OPENROUTER_API_KEY = previous; }
});

test("OpenRouter video submission rejects polling URLs outside OpenRouter", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  try {
    await assert.rejects(submitOpenRouterVideo({
      model: "bytedance/seedance-2.0-mini",
      payload: { prompt: "hello" },
      fetchImpl: (async () => Response.json({
        id: "job-1", polling_url: "https://evil.example/api/v1/videos/job-1", status: "pending",
      }, { status: 202 })) as typeof fetch,
    }), /untrusted polling URL/);
  } finally { process.env.OPENROUTER_API_KEY = previous; }
});

test("OpenRouter video polling and authenticated content download use the recorded job", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  try {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") });
      if (String(url).endsWith("/job-1")) {
        return Response.json({
          id: "job-1",
          status: "completed",
          generation_id: "generation-1",
          unsigned_urls: ["https://temporary.example/video.mp4"],
          usage: { cost: 0.25 },
        });
      }
      return new Response(Buffer.from("video-bytes"), { headers: { "content-type": "video/mp4" } });
    }) as typeof fetch;
    const status = await getOpenRouterVideoStatus("https://openrouter.ai/api/v1/videos/job-1", fetchImpl);
    assert.equal(status.status, "completed");
    assert.equal(status.generationId, "generation-1");
    const video = await downloadOpenRouterVideo({
      statusUrl: "https://openrouter.ai/api/v1/videos/job-1",
      fetchImpl,
    });
    assert.equal(video.bytes.toString(), "video-bytes");
    assert.equal(video.mimeType, "video/mp4");
    assert.deepEqual(calls, [
      { url: "https://openrouter.ai/api/v1/videos/job-1", authorization: "Bearer test-key" },
      { url: "https://openrouter.ai/api/v1/videos/job-1/content?index=0", authorization: "Bearer test-key" },
    ]);
  } finally { process.env.OPENROUTER_API_KEY = previous; }
});

test("OpenRouter rate-limit errors preserve provider detail and retryability", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  try {
    await assert.rejects(
      generateOpenRouterImage({
        model: "x-ai/grok-imagine-image-quality",
        payload: { prompt: "hello" },
        fetchImpl: (async () => Response.json({ error: { message: "Slow down" } }, { status: 429 })) as typeof fetch,
      }),
      (error: unknown) => {
        assert.ok(error instanceof OpenRouterMediaError);
        assert.equal(error.message, "Slow down");
        assert.equal(error.retryable, true);
        return true;
      });
  } finally { process.env.OPENROUTER_API_KEY = previous; }
});
