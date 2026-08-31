export type MediaKind = "image" | "video";
export type VisualType =
  | "editorial-scene" | "illustration" | "infographic" | "diagram" | "data-chart"
  | "quote-card" | "meme" | "product-showcase" | "cinematic-clip";

export interface VisualBrief {
  kind: MediaKind;
  visualType: VisualType;
  exactOnMediaText?: string;
  creativeDirection?: string;
}

export interface CreativeAssetView {
  id: string;
  generationRunId: string;
  contentBaseId: string;
  originPostId: string | null;
  parentAssetId: string | null;
  assetRole: string;
  mediaKind: MediaKind;
  visualType: VisualType;
  fileName: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  byteSize: number;
  description: string;
  altText: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  url: string;
}

export interface CreativeRunView {
  id: string;
  contentBaseId: string;
  originPostId: string | null;
  parentAssetId: string | null;
  mediaKind: MediaKind;
  visualType: VisualType;
  visualBrief: VisualBrief;
  status: "preparing" | "queued" | "submitted" | "processing" | "succeeded" | "failed" | "cancelled";
  progress: number;
  error: string | null;
  estimatedCredits: number;
  provenance: {
    provider: string | null;
    deploymentId: string | null;
    providerRequestId: string | null;
    compiledPrompt: string;
    negativePrompt: string | null;
    rendererVersion: string | null;
    renderSpec: Record<string, unknown> | null;
    providerParams: Record<string, unknown>;
    queue: {
      requestUrl: string | null;
      statusUrl: string | null;
      resultUrl: string | null;
      cancelUrl: string | null;
    };
  };
  createdAt: string;
}

export interface PostMediaUsageView {
  id: string;
  postId: string;
  assetId: string;
  role: string;
  position: number;
  createdAt: string;
  asset: CreativeAssetView;
}

export interface BaseMediaOverview {
  visualTypes: Record<MediaKind, Array<{ key: VisualType; label: string }>>;
  runs: CreativeRunView[];
  assets: CreativeAssetView[];
  usage: PostMediaUsageView[];
}
