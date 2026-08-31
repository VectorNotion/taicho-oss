import { z } from "zod";
import { creativeExecutionTarget } from "./runtime";

export const creativeMediaKinds = ["image", "video"] as const;
export type CreativeMediaKind = (typeof creativeMediaKinds)[number];

export const imageVisualTypes = [
  "editorial-scene",
  "illustration",
  "infographic",
  "diagram",
  "data-chart",
  "quote-card",
  "meme",
  "product-showcase",
] as const;
export type ImageVisualType = (typeof imageVisualTypes)[number];

export const videoVisualTypes = ["cinematic-clip"] as const;
export type VideoVisualType = (typeof videoVisualTypes)[number];
export type VisualType = ImageVisualType | VideoVisualType;

const creativeDirection = z.string().trim().max(2_000).optional();

export const visualBriefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("image"),
    visualType: z.enum(imageVisualTypes),
    exactOnMediaText: z.string().trim().max(280).optional(),
    creativeDirection,
  }).strict(),
  z.object({
    kind: z.literal("video"),
    visualType: z.enum(videoVisualTypes),
    // Cinematic clip V1 has no application video compositor, so exact text is
    // deliberately unavailable instead of being misspelled by the provider.
    exactOnMediaText: z.never().optional(),
    creativeDirection,
  }).strict(),
]);
export type VisualBrief = z.infer<typeof visualBriefSchema>;

export const creativeMediaRequestSchema = z.object({
  brief: visualBriefSchema,
  parentAssetId: z.string().uuid().optional(),
}).strict();
export type CreativeMediaRequest = z.infer<typeof creativeMediaRequestSchema>;

const CONTENT_MEDIA_CREDITS = {
  image: 40,
  video: 600,
} as const;

export const VISUAL_TYPE_LABELS: Record<VisualType, string> = {
  "editorial-scene": "Editorial scene",
  illustration: "Illustration",
  infographic: "Infographic",
  diagram: "Diagram",
  "data-chart": "Data chart",
  "quote-card": "Quote or stat card",
  meme: "Meme",
  "product-showcase": "Product showcase",
  "cinematic-clip": "Cinematic clip",
};

export function buildProviderInput(request: CreativeMediaRequest, compiledPrompt: string): Record<string, unknown> {
  if (request.brief.kind === "image") {
    return {
      prompt: compiledPrompt,
      resolution: "1K",
      aspect_ratio: "1:1",
      n: 1,
    };
  }
  return {
    prompt: compiledPrompt,
    aspect_ratio: "9:16",
    duration: 5,
    resolution: "720p",
    generate_audio: true,
  };
}

export function mediaCredits(request: CreativeMediaRequest): number {
  return CONTENT_MEDIA_CREDITS[request.brief.kind];
}

export function mediaDeployment(request: CreativeMediaRequest) {
  const target = creativeExecutionTarget(request.brief.kind);
  return {
    provider: target.provider,
    deploymentId: target.modelId,
    credits: CONTENT_MEDIA_CREDITS[request.brief.kind],
  };
}
