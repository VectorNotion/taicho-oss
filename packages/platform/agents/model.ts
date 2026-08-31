/**
 * Release-owned language-model runtime.
 *
 * Product requests, workspaces, surfaces, and environments cannot choose the
 * provider model. Changing the target is a reviewed code change that ships in
 * the same artifact everywhere.
 */

export const PRIMARY_LANGUAGE_MODEL_SLUG = 'qwen/qwen3.7-plus';
export const LANGUAGE_RUNTIME_VERSION = 'language-runtime-v1';
export const OPENROUTER_CHAT_COMPLETIONS_URL =
  'https://openrouter.ai/api/v1/chat/completions';
export const AI_GENERATION_NOT_CONFIGURED_MESSAGE =
  'AI generation is not configured for this environment.';

export interface LanguageModelExecutionDescriptor {
  provider: 'openrouter';
  modelId: string;
  runtimeVersion: typeof LANGUAGE_RUNTIME_VERSION;
}

export class LanguageRuntimeReadinessError extends Error {
  readonly code = 'ai_generation_not_configured';

  constructor(message = AI_GENERATION_NOT_CONFIGURED_MESSAGE) {
    super(message);
    this.name = 'LanguageRuntimeReadinessError';
  }
}

export interface LanguageModelRuntime {
  readonly modelSlug: string;
  readonly routerModel: `openrouter/${string}`;
  readonly execution: LanguageModelExecutionDescriptor;
  isConfigured(): boolean;
  requireApiKey(): string;
  requireReady(): LanguageModelExecutionDescriptor;
}

const productionSimulationSettings = [
  ['TAICHO_CHAT_SIMULATION', '1'],
  ['AGENTS_RUNTIME_MODE', 'stub'],
  ['ASSISTANT_MODEL_MODE', 'stub'],
  ['CONTENT_GENERATION_MODE', 'stub'],
  ['CONTENT_REFINEMENT_MODE', 'stub'],
  ['CREATIVE_MEDIA_MODE', 'stub'],
  ['CASCADE_BRAIN_MODE', 'stub'],
] as const;

function assertProductionSimulationDisabled(environment: NodeJS.ProcessEnv) {
  if (environment.NODE_ENV !== 'production') return;
  const active = productionSimulationSettings.find(
    ([name, value]) => environment[name]?.trim().toLowerCase() === value,
  );
  if (active) {
    throw new LanguageRuntimeReadinessError(
      `${active[0]}=${active[1]} is forbidden in production.`,
    );
  }
}

/**
 * Construct an injectable runtime for unit tests and server-owned adapters.
 * Production consumers use the module-level helpers below; the optional slug
 * exists only so tests can prove metadata propagation without mutating global
 * process state.
 */
export function createLanguageModelRuntime(options: {
  environment?: NodeJS.ProcessEnv;
  primaryModelSlug?: string;
} = {}): LanguageModelRuntime {
  const environment = options.environment ?? process.env;
  const primaryModelSlug = options.primaryModelSlug ?? PRIMARY_LANGUAGE_MODEL_SLUG;
  if (!/^[a-z0-9._-]+\/[a-z0-9._:/-]+$/i.test(primaryModelSlug)) {
    throw new Error('The primary language-model slug is invalid.');
  }
  const execution = Object.freeze({
    provider: 'openrouter' as const,
    modelId: primaryModelSlug,
    runtimeVersion: LANGUAGE_RUNTIME_VERSION,
  });
  const requireApiKey = () => {
    assertProductionSimulationDisabled(environment);
    const apiKey = environment.OPENROUTER_API_KEY?.trim();
    if (!apiKey) throw new LanguageRuntimeReadinessError();
    return apiKey;
  };

  return Object.freeze({
    modelSlug: primaryModelSlug,
    routerModel: `openrouter/${primaryModelSlug}` as const,
    execution,
    isConfigured() {
      return Boolean(environment.OPENROUTER_API_KEY?.trim());
    },
    requireApiKey,
    requireReady() {
      requireApiKey();
      return execution;
    },
  });
}

function runtime(environment: NodeJS.ProcessEnv = process.env) {
  return createLanguageModelRuntime({ environment });
}

/** OpenRouter slug for raw HTTP clients and execution provenance. */
export function modelSlug(): string {
  return PRIMARY_LANGUAGE_MODEL_SLUG;
}

/** Mastra model-router reference for the fixed language target. */
export function routerModel(): `openrouter/${string}` {
  return `openrouter/${PRIMARY_LANGUAGE_MODEL_SLUG}`;
}

export function languageModelExecutionDescriptor(): LanguageModelExecutionDescriptor {
  return runtime().execution;
}

export function languageModelRuntimeIsConfigured(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return runtime(environment).isConfigured();
}

export function requireLanguageModelRuntime(
  environment: NodeJS.ProcessEnv = process.env,
): LanguageModelExecutionDescriptor {
  return runtime(environment).requireReady();
}

export function requireLanguageModelApiKey(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return runtime(environment).requireApiKey();
}
