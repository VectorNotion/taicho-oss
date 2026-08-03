import {
  AUTO_MODEL_KEY,
  DEFAULT_MODEL_BY_SURFACE,
  getModelDefinition,
  listModelOptions,
  type ModelCapability,
  type ModelDefinition,
  type ModelProvider,
  type ModelSelectionKey,
  type ModelSurface,
  type PlatformModelDefinition,
} from "./catalog";

export const AI_MODEL_EXECUTION_CONTEXT_KEY = "ai.model.execution";

export interface ModelDeployment {
  provider: ModelProvider;
  modelId: string;
}

export type ModelResolutionSource = "request" | "workspace-default" | "platform-default";

export interface ResolvedModelSelection {
  requestedKey: ModelSelectionKey;
  resolvedKey: string;
  source: ModelResolutionSource;
  model: ModelDefinition;
  deployment: ModelDeployment;
}

export type ModelPolicyErrorCode =
  | "unknown_model" | "model_not_allowed" | "incompatible_surface"
  | "missing_capability" | "no_compatible_model";

export class ModelPolicyError extends Error {
  constructor(message: string, readonly code: ModelPolicyErrorCode) {
    super(message);
    this.name = "ModelPolicyError";
  }
}

function defaultForRequest(
  models: readonly PlatformModelDefinition[],
  surface: ModelSurface,
  requiredCapabilities: readonly ModelCapability[],
  allowedModelKeys?: readonly string[],
): string {
  const compatible = listModelOptions(models, { surface, requiredCapabilities, allowedModelKeys });
  const configuredDefault = DEFAULT_MODEL_BY_SURFACE[surface];
  const fallback = compatible.find((model) => model.key === configuredDefault)
    ?? compatible.find((model) => model.recommended)
    ?? compatible[0];
  if (!fallback) {
    throw new ModelPolicyError(
      `No allowed model can satisfy ${surface} with the required capabilities.`,
      "no_compatible_model",
    );
  }
  return fallback.key;
}

function validateExplicitModel(input: {
  models: readonly PlatformModelDefinition[];
  key: string;
  surface: ModelSurface;
  requiredCapabilities: readonly ModelCapability[];
  allowedModelKeys?: readonly string[];
}): string {
  const model = getModelDefinition(input.models, input.key);
  if (!model) throw new ModelPolicyError(`Unknown model selection "${input.key}".`, "unknown_model");
  if (input.allowedModelKeys && !input.allowedModelKeys.includes(input.key)) {
    throw new ModelPolicyError("This model is not enabled for the workspace.", "model_not_allowed");
  }
  if (!model.surfaces.includes(input.surface)) {
    throw new ModelPolicyError(`${model.name} is not available in ${input.surface}.`, "incompatible_surface");
  }
  const missing = input.requiredCapabilities.filter((capability) => !model.capabilities.includes(capability));
  if (missing.length) {
    throw new ModelPolicyError(`${model.name} does not support: ${missing.join(", ")}.`, "missing_capability");
  }
  return input.key;
}

export function resolveModelSelection(input: {
  models: readonly PlatformModelDefinition[];
  surface: ModelSurface;
  requestedKey?: string | null;
  workspaceDefaultKey?: string | null;
  requiredCapabilities?: readonly ModelCapability[];
  allowedModelKeys?: readonly string[];
}): ResolvedModelSelection {
  const requestedKey = input.requestedKey?.trim() || AUTO_MODEL_KEY;
  const requiredCapabilities = input.requiredCapabilities ?? [];
  let source: ModelResolutionSource;
  let resolvedKey: string;
  if (requestedKey !== AUTO_MODEL_KEY) {
    source = "request";
    resolvedKey = validateExplicitModel({ ...input, key: requestedKey, requiredCapabilities });
  } else if (input.workspaceDefaultKey && input.workspaceDefaultKey !== AUTO_MODEL_KEY) {
    source = "workspace-default";
    resolvedKey = validateExplicitModel({ ...input, key: input.workspaceDefaultKey, requiredCapabilities });
  } else {
    source = "platform-default";
    resolvedKey = defaultForRequest(input.models, input.surface, requiredCapabilities, input.allowedModelKeys);
  }
  const model = getModelDefinition(input.models, resolvedKey)!;
  return {
    requestedKey,
    resolvedKey,
    source,
    model,
    deployment: { provider: model.provider, modelId: model.deploymentId },
  };
}

export type MastraLanguageModelConfig = `${string}/${string}` | {
  providerId: string;
  modelId: string;
  url: string;
  apiKey: string;
};

export function languageModelConfig(selection: ResolvedModelSelection): MastraLanguageModelConfig {
  if (selection.deployment.provider !== "litellm") {
    throw new ModelPolicyError(`${selection.model.name} is a creative model and cannot run as a language model.`, "missing_capability");
  }
  const baseUrl = process.env.LITELLM_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.LITELLM_API_KEY?.trim();
  if (baseUrl && apiKey) {
    return { providerId: "litellm", modelId: selection.deployment.modelId, url: baseUrl, apiKey };
  }
  throw new Error("The selected AI model is temporarily unavailable.");
}

export function languageModelConfigForStoredSelection(input: {
  models: readonly PlatformModelDefinition[];
  storedSelection: string;
  surface: Extract<ModelSurface, "squad">;
}): MastraLanguageModelConfig {
  if (getModelDefinition(input.models, input.storedSelection)) {
    return languageModelConfig(resolveModelSelection({
      models: input.models,
      surface: input.surface,
      requestedKey: input.storedSelection,
      requiredCapabilities: ["text-generation"],
    }));
  }
  if (process.env.OPENROUTER_API_KEY && /^[a-z0-9._-]+\/[a-z0-9._:/-]+$/i.test(input.storedSelection)) {
    return `openrouter/${input.storedSelection}`;
  }
  throw new ModelPolicyError("The stored agent model is no longer available. Choose an approved model.", "unknown_model");
}
