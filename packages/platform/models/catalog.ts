export const MODEL_PROVIDERS = ["litellm", "fal"] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export const MODEL_SURFACES = [
  // `squad` is accepted only while older signed CMS catalogs age out. No
  // runtime or product surface consumes it.
  "chat", "content", "outreach", "cascade", "squad", "creative",
] as const;
export type ModelSurface = (typeof MODEL_SURFACES)[number];

export const MODEL_CAPABILITIES = [
  "text-generation", "tool-use", "structured-output", "vision-input",
  "image-generation", "image-edit", "video-generation", "audio-generation",
] as const;
export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export type ModelKind = "language" | "image" | "video" | "audio";
export type ModelSpeed = "fast" | "balanced" | "deliberate";
export type ModelStatus = "available" | "preview";
export type ModelKey = string;
export const AUTO_MODEL_KEY = "auto" as const;
export type ModelSelectionKey = string;

export interface ModelDefinition {
  key: string;
  name: string;
  family: string;
  provider: ModelProvider;
  kind: ModelKind;
  description: string;
  capabilities: readonly ModelCapability[];
  surfaces: readonly ModelSurface[];
  speed: ModelSpeed;
  creditMultiplier: number;
  status: ModelStatus;
  recommended?: boolean;
}

export type PublicModelDefinition = Omit<ModelDefinition, "provider">;

export interface PlatformModelDefinition extends ModelDefinition {
  deploymentId: string;
  credentialReference?: string | null;
  operationalStatus: "configured" | "degraded";
  sortOrder: number;
}

export interface PlatformCatalog {
  schemaVersion: 1;
  catalogVersion: string;
  generatedAt: string;
  models: PlatformModelDefinition[];
}

export const DEFAULT_MODEL_BY_SURFACE: Readonly<Record<ModelSurface, string>> = {
  chat: "text-balanced",
  content: "text-balanced",
  outreach: "text-fast",
  cascade: "text-balanced",
  squad: "text-balanced",
  creative: "image-fast",
};

export function getModelDefinition<T extends PublicModelDefinition>(
  models: readonly T[],
  key: string,
): T | undefined {
  return models.find((model) => model.key === key);
}

export function supportsCapabilities(
  model: PublicModelDefinition,
  required: readonly ModelCapability[],
): boolean {
  return required.every((capability) => model.capabilities.includes(capability));
}

export function listModelOptions<T extends PublicModelDefinition>(
  models: readonly T[],
  input: {
    surface: ModelSurface;
    requiredCapabilities?: readonly ModelCapability[];
    allowedModelKeys?: readonly string[];
  },
): T[] {
  const allowed = input.allowedModelKeys ? new Set(input.allowedModelKeys) : null;
  const required = input.requiredCapabilities ?? [];
  return models.filter((model) =>
    model.surfaces.includes(input.surface)
    && (!allowed || allowed.has(model.key))
    && supportsCapabilities(model, required));
}

export function publicModelOptions(
  models: readonly PlatformModelDefinition[],
  input: Parameters<typeof listModelOptions>[1],
): PublicModelDefinition[] {
  return listModelOptions(models, input).map((model) => ({
    key: model.key,
    name: model.name,
    family: model.family,
    kind: model.kind,
    description: model.description,
    capabilities: model.capabilities,
    surfaces: model.surfaces,
    speed: model.speed,
    creditMultiplier: model.creditMultiplier,
    status: model.status,
    recommended: model.recommended,
  }));
}
