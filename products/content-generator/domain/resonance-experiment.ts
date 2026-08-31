import { z } from "zod";
import { CELL_CAP } from "@content-automation/platform/resonance/payload";
import type {
  ResonanceFrame,
  ResonanceSurface,
  RunRequest,
} from "@content-automation/platform/resonance/types";
import { CONTENT_TYPES, type ContentDraft, type ContentType } from "./content";
import { contentArtifactForResonance } from "./generated-content";

export const MIN_RESONANCE_VARIATIONS = 2;
export const MAX_RESONANCE_VARIATIONS = 6;
export const DEFAULT_RESONANCE_VARIATIONS = 3;
export const CONTENT_GENERATION_CREDITS_PER_VARIATION = 80;

export interface ContentResonanceProfile {
  label: string;
  surface: ResonanceSurface;
  frames: readonly ResonanceFrame[];
  frameLabels: Partial<Record<ResonanceFrame, string>>;
  description: string;
}

/**
 * Format-aware test profiles for every generation template.
 *
 * The stable frame ids keep aggregation and score contracts shared across the
 * product. The surface tells the worker how to phrase those judgments for the
 * actual artifact, while frameLabels gives the UI honest, platform-native
 * language instead of showing "scroll stop" for a YouTube script.
 */
export const CONTENT_RESONANCE_PROFILES: Record<ContentType, ContentResonanceProfile> = {
  video_script: {
    label: "YouTube video",
    surface: "youtube_video",
    frames: ["scroll_stop", "click", "compelling"],
    frameLabels: {
      scroll_stop: "Hook hold",
      click: "Watch intent",
      compelling: "Viewer value",
    },
    description: "Tests the opening hook, intent to watch, and perceived viewer value.",
  },
  blog_post: {
    label: "Blog article",
    surface: "blog_article",
    frames: ["click", "compelling", "share"],
    frameLabels: {
      click: "Open intent",
      compelling: "Reader value",
      share: "Share intent",
    },
    description: "Tests the title and opening for open intent, reader value, and sharing.",
  },
  x_post: {
    label: "X post",
    surface: "x_post",
    frames: ["scroll_stop", "compelling", "share"],
    frameLabels: {
      scroll_stop: "Scroll stop",
      compelling: "Engage intent",
      share: "Repost intent",
    },
    description: "Tests whether the post stops the feed, earns engagement, and feels repostable.",
  },
  tweet_thread: {
    label: "X thread",
    surface: "x_thread",
    frames: ["scroll_stop", "compelling", "share"],
    frameLabels: {
      scroll_stop: "Thread open",
      compelling: "Read-through",
      share: "Repost intent",
    },
    description: "Tests the opening post, intent to read through, and repost potential.",
  },
  linkedin_post: {
    label: "LinkedIn post",
    surface: "linkedin_post",
    frames: ["scroll_stop", "compelling", "share"],
    frameLabels: {
      scroll_stop: "Feed stop",
      compelling: "Professional value",
      share: "Share intent",
    },
    description: "Tests feed attention, professional value, and willingness to share.",
  },
  social_post: {
    label: "Social post",
    surface: "social_post",
    frames: ["scroll_stop", "compelling", "share"],
    frameLabels: {
      scroll_stop: "Feed stop",
      compelling: "Engage intent",
      share: "Share intent",
    },
    description: "Tests attention, engagement intent, and share potential across social feeds.",
  },
  ad_campaign: {
    label: "Ad campaign",
    surface: "ad_campaign",
    frames: ["scroll_stop", "click", "compelling"],
    frameLabels: {
      scroll_stop: "Thumb stop",
      click: "Click intent",
      compelling: "Message clarity",
    },
    description: "Tests thumb-stop strength, destination intent, and message clarity.",
  },
};

export function resonanceProfileFor(type: ContentType): ContentResonanceProfile {
  return CONTENT_RESONANCE_PROFILES[type];
}

export const resonanceExperimentRequestSchema = z.object({
  variationCount: z.number().int().min(MIN_RESONANCE_VARIATIONS).max(MAX_RESONANCE_VARIATIONS),
  audienceSize: z.number().int().min(100).max(2_000_000),
}).superRefine((input, context) => {
  const cells = (input.variationCount + 1) * 3 * input.audienceSize;
  if (cells > CELL_CAP) {
    context.addIssue({
      code: "custom",
      path: ["audienceSize"],
      message: `This setup exceeds the ${CELL_CAP.toLocaleString()}-judgment run limit.`,
    });
  }
});

export type ResonanceExperimentRequest = z.infer<typeof resonanceExperimentRequestSchema>;

export const contentResonanceCandidateSchema = z.object({
  id: z.string().min(1).max(300),
  label: z.string().min(1).max(300),
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(500_000),
  contentType: z.enum(CONTENT_TYPES),
  original: z.boolean(),
});

export type ContentResonanceCandidate = z.infer<typeof contentResonanceCandidateSchema>;

export const contentResonanceExperimentResultSchema = z.object({
  kind: z.literal("content_resonance_experiment"),
  resonanceJobId: z.string().min(1),
  surface: z.enum([
    "generic",
    "youtube_video",
    "blog_article",
    "x_post",
    "x_thread",
    "linkedin_post",
    "social_post",
    "ad_campaign",
  ]),
  frames: z.array(z.enum(["scroll_stop", "click", "share", "compelling"])),
  candidates: z.array(contentResonanceCandidateSchema).min(2),
  variationCount: z.number().int().min(MIN_RESONANCE_VARIATIONS).max(MAX_RESONANCE_VARIATIONS),
  audienceSize: z.number().int().min(100).max(2_000_000),
  estimatedCells: z.number().int().min(0),
  estimatedCredits: z.number().int().min(0),
  sourceUpdatedAt: z.string().datetime(),
});

export type ContentResonanceExperimentResult = z.infer<typeof contentResonanceExperimentResultSchema>;

export function sourceCandidate(draft: ContentDraft): ContentResonanceCandidate {
  return {
    id: "original",
    label: "Original",
    title: draft.title,
    content: draft.content,
    contentType: draft.type,
    original: true,
  };
}

export function buildContentResonanceRunRequest(
  candidates: ContentResonanceCandidate[],
  audienceSize: number,
): RunRequest {
  const contentType = candidates[0]?.contentType;
  if (!contentType || candidates.some((candidate) => candidate.contentType !== contentType)) {
    throw new Error("RESONANCE_CANDIDATE_TYPE_MISMATCH");
  }
  const profile = resonanceProfileFor(contentType);
  return {
    creatives: candidates.map((candidate) => ({
      id: candidate.id,
      text: contentArtifactForResonance({
        type: candidate.contentType,
        title: candidate.title,
        content: candidate.content,
      }),
    })),
    audienceSize,
    frames: [...profile.frames],
    surface: profile.surface,
    seed: 0,
  };
}

export function estimateExperiment(input: ResonanceExperimentRequest): {
  candidates: number;
  generationCredits: number;
  resonanceCells: number;
  resonanceCredits: number;
  totalCredits: number;
} {
  const candidates = input.variationCount + 1;
  // Resonance's default run uses scroll-stop, click, and compelling.
  const resonanceCells = candidates * 3 * input.audienceSize;
  const generationCredits = input.variationCount * CONTENT_GENERATION_CREDITS_PER_VARIATION;
  const resonanceCredits = Math.max(1, Math.ceil(resonanceCells / 1000));
  return {
    candidates,
    generationCredits,
    resonanceCells,
    resonanceCredits,
    totalCredits: generationCredits + resonanceCredits,
  };
}
