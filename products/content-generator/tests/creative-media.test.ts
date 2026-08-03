import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import type { ContentDraft } from "../domain/content";
import { normalizeFalOutput, verifyFalWebhook } from "../media/fal-provider";
import {
  buildFalInput,
  estimateCreativeCredits,
  getCreativeMediaTemplate,
} from "../media/templates";

const draft: ContentDraft = {
  id: "draft-1",
  ideaId: "idea-1",
  title: "A practical guide to durable creative workflows",
  type: "blog_post",
  content: "Use a queue, own the final files, and make every provider callback replay safe.",
  status: "ready",
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
};

test("creative templates produce canonical FAL inputs and parameter-aware credit estimates", () => {
  const image = getCreativeMediaTemplate("social-image")!;
  assert.deepEqual(buildFalInput(image, draft, {
    templateKey: image.key,
    aspectRatio: "16:9",
    variations: 3,
  }), {
    prompt: `${image.promptPreamble}\n\nUse this source material:\nTitle: ${draft.title}\nContent: ${draft.content}`,
    image_size: "landscape_16_9",
    num_images: 3,
    enable_safety_checker: true,
    output_format: "png",
  });
  assert.equal(estimateCreativeCredits(image, { templateKey: image.key, variations: 3 }, 1.5), 180);

  const video = getCreativeMediaTemplate("short-video")!;
  assert.equal(
    estimateCreativeCredits(video, { templateKey: video.key, durationSeconds: 10 }, 1),
    1_200,
  );
});

test("FAL output normalization handles image, video, and audio model response shapes", () => {
  const assets = normalizeFalOutput({
    images: [{ url: "https://cdn.example/one.png", width: 1024, height: 1024, content_type: "image/png" }],
    video: { url: "https://cdn.example/clip.mp4", content_type: "video/mp4", duration: 5 },
    audio_url: "https://cdn.example/voice.wav",
  }, "image");
  assert.deepEqual(assets.map((asset) => asset.kind), ["audio", "image", "video"]);
  assert.equal(assets.find((asset) => asset.kind === "image")?.width, 1024);
  assert.equal(assets.find((asset) => asset.kind === "video")?.durationMs, 5_000);
});

test("FAL webhook verification checks the raw body signature and timestamp window", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const requestId = "webhook-request-1";
  const userId = "fal-user-1";
  const now = Date.now();
  const timestamp = String(Math.floor(now / 1_000));
  const rawBody = JSON.stringify({ request_id: "provider-request-1", status: "OK", payload: {} });
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const signature = sign(
    null,
    Buffer.from([requestId, userId, timestamp, bodyHash].join("\n")),
    privateKey,
  ).toString("base64url");
  const headers = new Headers({
    "x-fal-webhook-request-id": requestId,
    "x-fal-webhook-user-id": userId,
    "x-fal-webhook-timestamp": timestamp,
    "x-fal-webhook-signature": signature,
  });
  const fetchImpl = async () => Response.json({
    keys: [publicKey.export({ format: "jwk" })],
  });
  assert.equal(await verifyFalWebhook({ rawBody, headers, now, fetchImpl: fetchImpl as typeof fetch }), true);
  assert.equal(await verifyFalWebhook({ rawBody: `${rawBody} `, headers, now, fetchImpl: fetchImpl as typeof fetch }), false);
  assert.equal(await verifyFalWebhook({ rawBody, headers, now: now + 301_000, fetchImpl: fetchImpl as typeof fetch }), false);
});

