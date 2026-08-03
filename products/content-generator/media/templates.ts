import type { ModelCapability } from "@content-automation/platform/models/catalog";
import { z } from "zod";
import type { ContentDraft } from "../domain/content";

export const creativeMediaKinds = ["image", "video", "audio"] as const;
export type CreativeMediaKind = (typeof creativeMediaKinds)[number];

export const creativeMediaRequestSchema = z.object({
  templateKey: z.string().min(1).max(80),
  modelKey: z.string().min(1).max(128).optional(),
  prompt: z.string().trim().min(1).max(4_000).optional(),
  negativePrompt: z.string().trim().max(2_000).optional(),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional(),
  variations: z.number().int().min(1).max(4).optional(),
  durationSeconds: z.number().int().min(1).max(15).optional(),
});

export type CreativeMediaRequest = z.infer<typeof creativeMediaRequestSchema>;

export interface CreativeMediaTemplate {
  key: string;
  version: number;
  name: string;
  description: string;
  kind: CreativeMediaKind;
  assetRole: "primary" | "thumbnail" | "hero" | "voiceover";
  requiredCapability: ModelCapability;
  defaultAspectRatio?: CreativeMediaRequest["aspectRatio"];
  allowedAspectRatios?: readonly NonNullable<CreativeMediaRequest["aspectRatio"]>[];
  defaultDurationSeconds?: number;
  defaultVariations: number;
  baseCredits: number;
  promptPreamble: string;
}

export const CREATIVE_MEDIA_TEMPLATES: readonly CreativeMediaTemplate[] = [
  {
    key: "social-image",
    version: 1,
    name: "Social image",
    description: "A polished feed image designed to support this post.",
    kind: "image",
    assetRole: "primary",
    requiredCapability: "image-generation",
    defaultAspectRatio: "1:1",
    allowedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    defaultVariations: 1,
    baseCredits: 40,
    promptPreamble: "Create a striking editorial social-media image. Do not render text, logos, watermarks, or UI.",
  },
  {
    key: "blog-hero",
    version: 1,
    name: "Blog hero",
    description: "A wide editorial cover image for an article or landing page.",
    kind: "image",
    assetRole: "hero",
    requiredCapability: "image-generation",
    defaultAspectRatio: "16:9",
    allowedAspectRatios: ["16:9", "4:3"],
    defaultVariations: 1,
    baseCredits: 40,
    promptPreamble: "Create a premium wide editorial hero image with a clear focal point and generous negative space. Do not render text, logos, or watermarks.",
  },
  {
    key: "youtube-thumbnail",
    version: 1,
    name: "Video thumbnail",
    description: "A high-contrast 16:9 thumbnail composition.",
    kind: "image",
    assetRole: "thumbnail",
    requiredCapability: "image-generation",
    defaultAspectRatio: "16:9",
    allowedAspectRatios: ["16:9"],
    defaultVariations: 2,
    baseCredits: 40,
    promptPreamble: "Create a bold high-contrast YouTube thumbnail composition with one obvious subject and room for a title overlay. Do not render text, logos, or watermarks.",
  },
  {
    key: "ad-creative",
    version: 1,
    name: "Ad creative",
    description: "A conversion-oriented visual suitable for paid social.",
    kind: "image",
    assetRole: "primary",
    requiredCapability: "image-generation",
    defaultAspectRatio: "1:1",
    allowedAspectRatios: ["1:1", "16:9", "9:16", "4:3"],
    defaultVariations: 2,
    baseCredits: 45,
    promptPreamble: "Create a premium conversion-oriented advertising visual with a simple hierarchy and clear product or idea focus. Do not render text, logos, or watermarks.",
  },
  {
    key: "short-video",
    version: 1,
    name: "Short video",
    description: "A short text-to-video clip for reels, shorts, or post media.",
    kind: "video",
    assetRole: "primary",
    requiredCapability: "video-generation",
    defaultAspectRatio: "9:16",
    allowedAspectRatios: ["9:16", "16:9", "1:1"],
    defaultDurationSeconds: 5,
    defaultVariations: 1,
    baseCredits: 120,
    promptPreamble: "Create a cinematic short-form video with coherent motion, a strong opening frame, and no text, logos, or watermarks.",
  },
  {
    key: "voiceover",
    version: 1,
    name: "Voiceover",
    description: "A clear spoken rendition of the post for narration or audio content.",
    kind: "audio",
    assetRole: "voiceover",
    requiredCapability: "audio-generation",
    defaultVariations: 1,
    baseCredits: 25,
    promptPreamble: "Read the following copy naturally, with confident pacing and clear emphasis:",
  },
] as const;

export function getCreativeMediaTemplate(key: string): CreativeMediaTemplate | undefined {
  return CREATIVE_MEDIA_TEMPLATES.find((template) => template.key === key);
}

function conciseDraft(draft: ContentDraft): string {
  const content = draft.content.replace(/\s+/g, " ").trim();
  return `Title: ${draft.title}\nContent: ${content.slice(0, 3_500)}`;
}

export function resolveCreativeOptions(
  template: CreativeMediaTemplate,
  request: CreativeMediaRequest,
): Required<Pick<CreativeMediaRequest, "variations">> & CreativeMediaRequest {
  const aspectRatio = request.aspectRatio ?? template.defaultAspectRatio;
  if (aspectRatio && template.allowedAspectRatios && !template.allowedAspectRatios.includes(aspectRatio)) {
    throw new Error(`${template.name} does not support the ${aspectRatio} aspect ratio.`);
  }
  return {
    ...request,
    aspectRatio,
    variations: request.variations ?? template.defaultVariations,
    durationSeconds: request.durationSeconds ?? template.defaultDurationSeconds,
  };
}

export function buildCreativePrompt(
  template: CreativeMediaTemplate,
  draft: ContentDraft,
  request: CreativeMediaRequest,
): string {
  if (request.prompt) return request.prompt;
  return `${template.promptPreamble}\n\nUse this source material:\n${conciseDraft(draft)}`;
}

const imageSizes: Record<string, string> = {
  "1:1": "square_hd",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
};

export function buildFalInput(
  template: CreativeMediaTemplate,
  draft: ContentDraft,
  request: CreativeMediaRequest,
): Record<string, unknown> {
  const options = resolveCreativeOptions(template, request);
  const prompt = buildCreativePrompt(template, draft, options);
  if (template.kind === "image") {
    return {
      prompt,
      image_size: imageSizes[options.aspectRatio ?? "1:1"],
      num_images: options.variations,
      enable_safety_checker: true,
      output_format: "png",
      ...(options.negativePrompt ? { negative_prompt: options.negativePrompt } : {}),
    };
  }
  if (template.kind === "video") {
    return {
      prompt,
      aspect_ratio: options.aspectRatio ?? "9:16",
      duration: String(options.durationSeconds ?? 5),
      resolution: "720p",
      enable_safety_checker: true,
      ...(options.negativePrompt ? { negative_prompt: options.negativePrompt } : {}),
    };
  }
  return {
    text: `${template.promptPreamble}\n\n${request.prompt ?? draft.content}`.slice(0, 5_000),
  };
}

export function estimateCreativeCredits(
  template: CreativeMediaTemplate,
  request: CreativeMediaRequest,
  creditMultiplier: number,
): number {
  const options = resolveCreativeOptions(template, request);
  const quantity = template.kind === "video"
    ? Math.max(1, options.durationSeconds ?? template.defaultDurationSeconds ?? 1)
    : options.variations;
  return Math.max(1, Math.ceil(template.baseCredits * quantity * creditMultiplier));
}
