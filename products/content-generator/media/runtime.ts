import type { CreativeMediaKind } from './templates';

export const CREATIVE_RUNTIME_VERSION = 'creative-runtime-v1';

export interface CreativeExecutionTarget {
  provider: 'openrouter';
  modelId: string;
  runtimeVersion: typeof CREATIVE_RUNTIME_VERSION;
}

/** Release-owned provider targets. Product and browser requests cannot override them. */
export const CREATIVE_EXECUTION_TARGETS: Readonly<Record<CreativeMediaKind, CreativeExecutionTarget>> =
  Object.freeze({
    image: Object.freeze({
      provider: 'openrouter',
      modelId: 'x-ai/grok-imagine-image-quality',
      runtimeVersion: CREATIVE_RUNTIME_VERSION,
    }),
    video: Object.freeze({
      provider: 'openrouter',
      modelId: 'bytedance/seedance-2.0-mini',
      runtimeVersion: CREATIVE_RUNTIME_VERSION,
    }),
  });

export function creativeExecutionTarget(kind: CreativeMediaKind): CreativeExecutionTarget {
  return CREATIVE_EXECUTION_TARGETS[kind];
}
