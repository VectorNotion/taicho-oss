/**
 * Single source of truth for the platform's LLM.
 *
 * All Mastra agents resolve their model through here. The stack runs on
 * OpenRouter (OPENROUTER_API_KEY); MODEL_NAME holds the OpenRouter slug
 * (vendor/model), defaulting to Qwen3.7 Plus.
 */

export const DEFAULT_MODEL_SLUG = 'qwen/qwen3.7-plus';

/** OpenRouter slug, e.g. "qwen/qwen3.7-plus" — for raw HTTP clients. */
export function modelSlug(): string {
  return process.env.MODEL_NAME || DEFAULT_MODEL_SLUG;
}

/** Mastra model-router string, e.g. "openrouter/qwen/qwen3.7-plus". */
export function routerModel(): string {
  return `openrouter/${modelSlug()}`;
}
