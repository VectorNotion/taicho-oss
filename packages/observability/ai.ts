import type {
  AnySpan,
  SpanOutputProcessor,
} from "@mastra/core/observability";
import type { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { LangfuseExporter } from "@mastra/langfuse";
import { Observability } from "@mastra/observability";
import {
  currentExecutionContext,
  externalIdentityRef,
} from "./context";

const CONTENT_REDACTED = "[CONTENT REDACTED]";
const SAFE_AI_ATTRIBUTE_KEYS = new Set([
  "availableTools",
  "maxSteps",
  "model",
  "provider",
  "resultType",
  "usage",
  "parameters",
  "streaming",
  "finishReason",
  "completionStartTime",
  "responseModel",
  "responseId",
  "stepIndex",
  "isContinued",
  "chunkType",
  "sequenceNumber",
  "toolType",
  "success",
  "mcpServer",
  "serverVersion",
  "processorExecutor",
  "processorIndex",
  "status",
  "conditionCount",
  "truthyIndexes",
  "selectedSteps",
  "branchCount",
  "parallelSteps",
  "loopType",
  "iteration",
  "maxIterations",
  "sleepType",
  "timeoutMs",
  "eventReceived",
  "waitDurationMs",
]);
const DISALLOWED_AI_NESTED_KEYS = new Set([
  "headers",
  "abortSignal",
  "stopSequences",
  "warnings",
]);
const SENSITIVE_AI_NESTED_KEY = /(authorization|api.?key|body|content|cookie|credential|email|header|instruction|message|password|payload|phone|prompt|query|recipient|secret|subject|text|token|url)/i;
const SAFE_AI_NUMERIC_KEY = new Set([
  "inputTokens",
  "outputTokens",
  "text",
  "cacheRead",
  "cacheWrite",
  "audio",
  "image",
  "reasoning",
]);

function safeAiValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined;
  if (
    typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) return typeof value === "string" ? value.slice(0, 256) : value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .slice(0, 32)
      .map((item) => safeAiValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const safeMetric = typeof nested === "number" && SAFE_AI_NUMERIC_KEY.has(key);
    if (
      DISALLOWED_AI_NESTED_KEYS.has(key)
      || (!safeMetric && SENSITIVE_AI_NESTED_KEY.test(key))
    ) continue;
    const safe = safeAiValue(nested, depth + 1);
    if (safe !== undefined) output[key] = safe;
  }
  return output;
}

function safeAiAttributes(attributes: Record<string, unknown> | undefined) {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (!SAFE_AI_ATTRIBUTE_KEYS.has(key)) continue;
    const safe = safeAiValue(value);
    if (safe !== undefined) output[key] = safe;
  }
  return output;
}

/**
 * Privacy checkpoint for AI traces.
 *
 * Langfuse keeps model/tool/timing/usage metadata, while prompts, completions,
 * tool payloads, and raw error details always stay inside the product.
 */
export class MastraPrivacyProcessor implements SpanOutputProcessor {
  readonly name = "taicho-ai-privacy";

  process(span?: AnySpan): AnySpan | undefined {
    if (!span) return undefined;
    const execution = currentExecutionContext();
    span.metadata = {
      ...(execution?.executionId ? { executionId: execution.executionId } : {}),
      ...(execution?.requestId ? { requestId: execution.requestId } : {}),
      ...(execution?.parentExecutionId ? { parentExecutionId: execution.parentExecutionId } : {}),
      ...(execution?.organizationId
        ? { organizationRef: externalIdentityRef("organization", execution.organizationId) }
        : {}),
      ...(execution?.actorId
        ? { userId: externalIdentityRef("actor", execution.actorId) }
        : {}),
      ...(execution?.sessionId
        ? { sessionId: externalIdentityRef("session", execution.sessionId) }
        : {}),
      actorType: execution?.actorType ?? "system",
    };

    span.name = span.type;
    span.entityName = undefined;
    if (span.entityId) span.entityId = externalIdentityRef("entity", span.entityId);
    span.tags = undefined;
    span.attributes = safeAiAttributes(
      span.attributes as Record<string, unknown> | undefined,
    ) as never;
    if (span.input !== undefined) span.input = CONTENT_REDACTED;
    if (span.output !== undefined) span.output = CONTENT_REDACTED;
    if (span.errorInfo) {
      span.errorInfo = {
        id: span.errorInfo.id,
        domain: span.errorInfo.domain,
        category: span.errorInfo.category,
        message: "AI operation failed.",
      };
    }
    return span;
  }

  async shutdown(): Promise<void> {}
}

export function langfuseConfigured(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

const observabilityInstances = new Set<Observability>();

export function langfuseClientOptions(): { environment: string; release?: string } {
  return {
    environment: process.env.DD_ENV ?? process.env.NODE_ENV ?? "development",
    ...(process.env.DD_VERSION ? { release: process.env.DD_VERSION } : {}),
  };
}

export function createLangfuseObservability(serviceName: string): Observability | undefined {
  if (!langfuseConfigured()) return undefined;
  if (!process.env.OBSERVABILITY_ID_HASH_KEY) {
    throw new Error("OBSERVABILITY_ID_HASH_KEY is required whenever Langfuse is enabled.");
  }
  const observability = new Observability({
    configs: {
      langfuse: {
        serviceName,
        spanOutputProcessors: [new MastraPrivacyProcessor()],
        exporters: [
          new LangfuseExporter({
            publicKey: process.env.LANGFUSE_PUBLIC_KEY,
            secretKey: process.env.LANGFUSE_SECRET_KEY,
            baseUrl: process.env.LANGFUSE_BASE_URL,
            realtime: process.env.LANGFUSE_REALTIME === "true",
            options: langfuseClientOptions(),
          }),
        ],
      },
    },
  });
  observabilityInstances.add(observability);
  return observability;
}

const dynamicAgentHosts = new Map<string, Mastra>();

/**
 * Registers short-lived/dynamic agents with a service-level Mastra host so
 * their model generations reach the same privacy-filtered Langfuse project.
 */
export function registerObservedAgent<T extends Agent>(agent: T, serviceName: string): T {
  if (!langfuseConfigured()) return agent;
  let host = dynamicAgentHosts.get(serviceName);
  if (!host) {
    const observability = createLangfuseObservability(serviceName);
    host = new Mastra({ ...(observability ? { observability } : {}) });
    dynamicAgentHosts.set(serviceName, host);
  }
  agent.__registerMastra(host);
  return agent;
}

export async function shutdownAiObservability(): Promise<void> {
  const instances = [...observabilityInstances];
  observabilityInstances.clear();
  dynamicAgentHosts.clear();
  await Promise.allSettled(instances.map((observability) => observability.shutdown()));
}
