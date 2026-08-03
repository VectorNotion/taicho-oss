import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  context as otelContext,
  propagation,
  trace,
  type Attributes,
} from "@opentelemetry/api";
import { readHeaderAttribution, type HeaderAttribution } from "./headers";

export type ActorType = "user" | "service" | "system";
export type EventOrigin = "internal" | "external_connector";

export type ExecutionContext = {
  executionId: string;
  requestId: string;
  parentExecutionId?: string;
  organizationId?: string;
  actorId?: string;
  actorType: ActorType;
  sessionId?: string;
  runId?: string;
  jobId?: string;
  operation?: string;
  eventOrigin?: EventOrigin;
  connectorId?: string;
  externalEventId?: string;
};

export type ExecutionContextInput = Partial<ExecutionContext> & {
  headers?: Headers;
};

export type TraceCarrier = {
  traceparent?: string;
  tracestate?: string;
};

const executionStorage = new AsyncLocalStorage<ExecutionContext>();
const processIdentityHashKey = randomBytes(32);

function value(input: string | undefined): string | undefined {
  const normalized = input?.trim();
  return normalized ? normalized.slice(0, 128) : undefined;
}

function contextInputFromHeaders(headers?: Headers): HeaderAttribution {
  return headers ? readHeaderAttribution(headers) : {};
}

export function createExecutionContext(input: ExecutionContextInput = {}): ExecutionContext {
  const inherited = executionStorage.getStore();
  const headerContext = contextInputFromHeaders(input.headers);
  const requestId = value(input.requestId)
    ?? value(headerContext.requestId)
    ?? inherited?.requestId
    ?? randomUUID();
  return {
    executionId: value(input.executionId)
      ?? value(headerContext.executionId)
      ?? inherited?.executionId
      ?? requestId,
    requestId,
    parentExecutionId: value(input.parentExecutionId)
      ?? value(headerContext.parentExecutionId)
      ?? inherited?.parentExecutionId,
    organizationId: value(input.organizationId)
      ?? value(headerContext.organizationId)
      ?? inherited?.organizationId,
    actorId: value(input.actorId)
      ?? value(headerContext.actorId)
      ?? inherited?.actorId,
    actorType: input.actorType
      ?? headerContext.actorType
      ?? inherited?.actorType
      ?? "system",
    sessionId: value(input.sessionId)
      ?? value(headerContext.sessionId)
      ?? inherited?.sessionId,
    runId: value(input.runId) ?? inherited?.runId,
    jobId: value(input.jobId) ?? inherited?.jobId,
    operation: value(input.operation) ?? inherited?.operation,
    eventOrigin: input.eventOrigin
      ?? headerContext.eventOrigin
      ?? inherited?.eventOrigin,
    connectorId: value(input.connectorId)
      ?? value(headerContext.connectorId)
      ?? inherited?.connectorId,
    externalEventId: value(input.externalEventId)
      ?? value(headerContext.externalEventId)
      ?? inherited?.externalEventId,
  };
}

export function currentExecutionContext(): ExecutionContext | undefined {
  return executionStorage.getStore();
}

export function runWithExecutionContext<T>(
  input: ExecutionContextInput,
  callback: (context: ExecutionContext) => T,
): T {
  const execution = createExecutionContext(input);
  return executionStorage.run(execution, () => {
    applyExecutionContextToActiveSpan(execution);
    return callback(execution);
  });
}

/**
 * Activates attribution inside framework-controlled async work where wrapping the
 * original callback is not possible (for example a Next.js authorization call).
 */
export function activateExecutionContext(input: ExecutionContextInput): ExecutionContext {
  const execution = createExecutionContext(input);
  executionStorage.enterWith(execution);
  applyExecutionContextToActiveSpan(execution);
  return execution;
}

export function enrichExecutionContext(input: ExecutionContextInput): ExecutionContext {
  const current = executionStorage.getStore();
  if (!current) return activateExecutionContext(input);
  const merged = createExecutionContext({ ...current, ...input });
  Object.assign(current, merged);
  applyExecutionContextToActiveSpan(current);
  return current;
}

export function externalIdentityRef(
  kind: "organization" | "actor" | "session" | "entity",
  id: string,
): string {
  const key = process.env.OBSERVABILITY_ID_HASH_KEY;
  const digest = createHmac("sha256", key || processIdentityHashKey)
    .update(`${kind}:${id}`)
    .digest("hex");
  return `${kind}_${digest.slice(0, 24)}`;
}

export function executionAttributes(execution = currentExecutionContext()): Attributes {
  if (!execution) return {};
  const attributes: Attributes = {
    "taicho.execution.id": execution.executionId,
    "taicho.request.id": execution.requestId,
    "taicho.actor.type": execution.actorType,
  };
  if (execution.parentExecutionId) attributes["taicho.execution.parent_id"] = execution.parentExecutionId;
  if (execution.organizationId) {
    attributes["taicho.organization.ref"] = externalIdentityRef("organization", execution.organizationId);
  }
  if (execution.actorId) attributes["taicho.actor.ref"] = externalIdentityRef("actor", execution.actorId);
  if (execution.sessionId) attributes["taicho.session.ref"] = externalIdentityRef("session", execution.sessionId);
  if (execution.runId) attributes["taicho.run.id"] = execution.runId;
  if (execution.jobId) attributes["taicho.job.id"] = execution.jobId;
  if (execution.operation) attributes["taicho.operation"] = execution.operation;
  if (execution.eventOrigin) attributes["taicho.event.origin"] = execution.eventOrigin;
  return attributes;
}

export function activeTraceIds(): { traceId?: string; spanId?: string } {
  const spanContext = trace.getSpan(otelContext.active())?.spanContext();
  if (!spanContext?.traceId || /^0+$/.test(spanContext.traceId)) return {};
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}

export function activeTraceCarrier(): TraceCarrier {
  const carrier: Record<string, string> = {};
  propagation.inject(otelContext.active(), carrier);
  return {
    traceparent: carrier.traceparent,
    tracestate: carrier.tracestate,
  };
}

export function applyExecutionContextToActiveSpan(execution = currentExecutionContext()): void {
  const span = trace.getSpan(otelContext.active());
  if (!span || !execution) return;
  span.setAttributes(executionAttributes(execution));
}
