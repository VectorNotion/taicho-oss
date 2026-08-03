import assert from "node:assert/strict";
import test from "node:test";

import { CONTENT_TYPES, isContentType } from "../domain/content";
import {
  contentArtifactForResonance,
  contentForResonance,
  formatGeneratedContent,
} from "../domain/generated-content";
import {
  buildContentResonanceRunRequest,
  CONTENT_RESONANCE_PROFILES,
  estimateExperiment,
  resonanceProfileFor,
  resonanceExperimentRequestSchema,
} from "../domain/resonance-experiment";

test("content type registry includes the feed and campaign formats used by resonance", () => {
  for (const type of ["x_post", "x_thread", "social_post", "ad_campaign"]) {
    const canonical = type === "x_thread" ? "tweet_thread" : type;
    assert.equal(isContentType(canonical), true, canonical);
  }
  assert.equal(new Set(CONTENT_TYPES).size, CONTENT_TYPES.length);
});

test("every generation template has a complete three-signal resonance profile", () => {
  assert.deepEqual(Object.keys(CONTENT_RESONANCE_PROFILES).sort(), [...CONTENT_TYPES].sort());
  for (const type of CONTENT_TYPES) {
    const profile = resonanceProfileFor(type);
    assert.equal(profile.frames.length, 3, type);
    assert.equal(new Set(profile.frames).size, profile.frames.length, type);
    assert.ok(profile.description.length > 20, type);
    for (const frame of profile.frames) {
      assert.ok(profile.frameLabels[frame], `${type}:${frame}`);
    }
  }
});

test("experiment request accepts only the supported variation and audience ranges", () => {
  assert.equal(resonanceExperimentRequestSchema.safeParse({ variationCount: 3, audienceSize: 5_000 }).success, true);
  assert.equal(resonanceExperimentRequestSchema.safeParse({ variationCount: 1, audienceSize: 5_000 }).success, false);
  assert.equal(resonanceExperimentRequestSchema.safeParse({ variationCount: 7, audienceSize: 5_000 }).success, false);
  assert.equal(resonanceExperimentRequestSchema.safeParse({ variationCount: 3, audienceSize: 99 }).success, false);
  assert.equal(resonanceExperimentRequestSchema.safeParse({ variationCount: 6, audienceSize: 2_000_000 }).success, false);
});

test("experiment estimate includes the original control, generation, and scoring", () => {
  assert.deepEqual(estimateExperiment({ variationCount: 3, audienceSize: 5_000 }), {
    candidates: 4,
    generationCredits: 240,
    resonanceCells: 60_000,
    resonanceCredits: 60,
    totalCredits: 300,
  });
});

test("ad campaign parts render into one stable comparison artifact", () => {
  assert.equal(formatGeneratedContent("ad_campaign", {
    headline: "Headline",
    primary_text: "Body",
    description: "Description",
    call_to_action: "Learn more",
  }), "Headline: Headline\n\nPrimary text:\nBody\n\nDescription: Description\n\nCTA: Learn more");
});

test("long-form content is clipped at a semantic boundary for the scorer", () => {
  const content = `Opening sentence. ${"More detail. ".repeat(1_000)}`;
  const scored = contentForResonance(content);
  assert.ok(scored.length <= 5_000);
  assert.ok(scored.endsWith("…"));
  assert.match(scored, /^Opening sentence/);
});

test("scoring artifacts include public titles only for title-bearing templates", () => {
  const youtube = contentArtifactForResonance({
    type: "video_script",
    title: "The public YouTube title",
    content: "Opening hook",
  });
  assert.match(youtube, /YouTube video title: The public YouTube title/);
  assert.match(youtube, /Video script:\nOpening hook/);

  const xPost = contentArtifactForResonance({
    type: "x_post",
    title: "Internal draft title",
    content: "The post the audience sees",
  });
  assert.equal(xPost, "The post the audience sees");
  assert.doesNotMatch(xPost, /Internal draft title/);
});

test("run payload carries the template surface, frames, and audience-visible artifact", () => {
  const run = buildContentResonanceRunRequest([
    {
      id: "original",
      label: "Original",
      title: "The public video title",
      content: "The opening hook",
      contentType: "video_script",
      original: true,
    },
    {
      id: "variation-1",
      label: "Variation 1",
      title: "A second public title",
      content: "A different opening hook",
      contentType: "video_script",
      original: false,
    },
  ], 5_000);

  assert.equal(run.surface, "youtube_video");
  assert.deepEqual(run.frames, ["scroll_stop", "click", "compelling"]);
  assert.equal(run.audienceSize, 5_000);
  assert.match(run.creatives[0].text, /YouTube video title: The public video title/);
});

test("run payload rejects candidates from mixed templates", () => {
  assert.throws(() => buildContentResonanceRunRequest([
    {
      id: "original",
      label: "Original",
      title: "Video",
      content: "Script",
      contentType: "video_script",
      original: true,
    },
    {
      id: "variation-1",
      label: "Variation 1",
      title: "Post",
      content: "Copy",
      contentType: "x_post",
      original: false,
    },
  ], 500), /RESONANCE_CANDIDATE_TYPE_MISMATCH/);
});
