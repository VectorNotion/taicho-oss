import type {
  Attributes,
  AttributeValue,
  Link,
  SpanStatus,
} from "@opentelemetry/api";
import type {
  ReadableSpan,
  SpanExporter,
  TimedEvent,
} from "@opentelemetry/sdk-trace-base";
import { externalIdentityRef } from "./context";

const SAFE_ATTRIBUTE_KEYS = new Set([
  "http.method",
  "http.request.method",
  "http.response.status_code",
  "http.route",
  "http.status_code",
  "url.scheme",
  "server.port",
  "network.protocol.name",
  "network.protocol.version",
  "network.transport",
  "db.system",
  "db.system.name",
  "db.namespace",
  "db.operation.name",
  "db.collection.name",
  "db.sql.table",
  "rpc.system",
  "rpc.service",
  "rpc.method",
  "rpc.grpc.status_code",
  "messaging.system",
  "messaging.operation.name",
  "messaging.operation.type",
  "messaging.destination.name",
  "messaging.batch.message_count",
  "error.type",
  "exception.type",
  "capability_id",
  "http_method",
  "page_product",
  "lead_id",
  "persona_id",
  "medium",
  "workflow_id",
  "trigger_type",
  "worker_id",
  "work_kind",
  "attempt",
  "max_attempts",
  "mcp_action",
  "protocol_methods",
  "upload_id",
  "byte_size",
  "action",
  "actor_type",
  "argument_count",
  "batch_size",
  "channel_id",
  "completed",
  "concurrency",
  "database_schema",
  "delivery_number",
  "destination",
  "duration_ms",
  "environment",
  "error_type",
  "failed",
  "interval_ms",
  "job_id",
  "lead_id",
  "ledger_status",
  "medium",
  "media_storage_enabled",
  "message_id",
  "parent_execution_id",
  "payload_bytes",
  "persona_id",
  "post_id",
  "product_count",
  "provider",
  "published",
  "queued",
  "reason",
  "reaped_count",
  "recovered",
  "recovered_count",
  "refreshed",
  "requeued",
  "required_action",
  "required_product",
  "role",
  "run_id",
  "scheduled",
  "score",
  "sent",
  "service_name",
  "signal",
  "status",
  "skipped",
  "terminal",
  "work_id",
]);

const SAFE_ATTRIBUTE_PREFIXES = [
  "taicho.",
  "ai.",
  "cascade.",
  "publishing.",
  "job.",
  "test.",
] as const;
const CORRELATION_ID_KEYS = new Set([
  "taicho.execution.id",
  "taicho.request.id",
  "taicho.execution.parent_id",
  "taicho.run.id",
  "taicho.job.id",
  "job.id",
  "execution_id",
  "request_id",
  "parent_execution_id",
  "run_id",
  "job_id",
  "trace_id",
  "span_id",
]);

const SENSITIVE_ATTRIBUTE_KEY = /(^|[._-])(authorization|cookie|credential|email|file|header|input|message|output|password|payload|phone|prompt|query|recipient|request_body|response_body|result|secret|subject|token|url)([._-]|$)/i;
const SENSITIVE_VALUE = /(bearer\s+[a-z0-9._~+/-]+=*|api[_-]?key\s*[:=]|password\s*[:=]|secret\s*[:=])/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function safeValue(value: unknown): AttributeValue | undefined {
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (SENSITIVE_VALUE.test(value)) return "[REDACTED]";
    return value.replaceAll(EMAIL, "[REDACTED]").slice(0, 512);
  }
  if (!Array.isArray(value)) return undefined;
  const safe = value
    .filter((item): item is string | number | boolean =>
      typeof item === "string" || typeof item === "number" || typeof item === "boolean")
    .slice(0, 32)
    .map((item) => String(item).replaceAll(EMAIL, "[REDACTED]").slice(0, 256));
  return safe.length > 0 ? safe : undefined;
}

function permittedAttribute(key: string): boolean {
  if (SAFE_ATTRIBUTE_KEYS.has(key)) return true;
  if (SENSITIVE_ATTRIBUTE_KEY.test(key)) return false;
  return SAFE_ATTRIBUTE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function safeOtelAttributes(input: Attributes): Attributes {
  const output: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (!permittedAttribute(key)) continue;
    const safe = safeValue(value);
    if (safe === undefined) continue;
    output[key] = typeof safe === "string"
      && (key.endsWith("_id") || key.endsWith(".id"))
      && !CORRELATION_ID_KEYS.has(key)
      ? externalIdentityRef("entity", safe)
      : safe;
  }
  return output;
}

function spanName(span: ReadableSpan): string {
  const attributes = span.attributes;
  const method = attributes["http.request.method"] ?? attributes["http.method"];
  if (typeof method === "string") {
    const route = attributes["http.route"];
    return typeof route === "string"
      ? `${method.slice(0, 16)} ${route.split(/[?#]/, 1)[0].replaceAll(EMAIL, "[REDACTED]").slice(0, 128)}`
      : method.slice(0, 16);
  }
  if (
    "db.statement" in attributes
    || "db.query.text" in attributes
    || "db.system" in attributes
    || "db.system.name" in attributes
  ) {
    const operation = attributes["db.operation.name"];
    return typeof operation === "string" ? `db.${operation.slice(0, 32)}` : "db.query";
  }
  if (Object.keys(attributes).some((key) => key.startsWith("gen_ai."))) return "ai.operation";
  return span.name
    .split(/[?#]/, 1)[0]
    .replaceAll(EMAIL, "[REDACTED]")
    .replace(SENSITIVE_VALUE, "[REDACTED]")
    .slice(0, 160);
}

function safeEvent(event: TimedEvent): TimedEvent {
  return {
    ...event,
    name: event.name.slice(0, 96),
    attributes: event.attributes ? safeOtelAttributes(event.attributes) : undefined,
  };
}

function safeLink(link: Link): Link {
  return {
    ...link,
    attributes: link.attributes ? safeOtelAttributes(link.attributes) : undefined,
  };
}

export function privacySafeReadableSpan(span: ReadableSpan): ReadableSpan {
  const status: SpanStatus = { code: span.status.code };
  return {
    name: spanName(span),
    kind: span.kind,
    spanContext: () => span.spanContext(),
    parentSpanContext: span.parentSpanContext,
    startTime: span.startTime,
    endTime: span.endTime,
    status,
    attributes: safeOtelAttributes(span.attributes),
    links: span.links.map(safeLink),
    events: span.events.map(safeEvent),
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
}

/**
 * Last-mile privacy checkpoint. This protects against attributes added by
 * auto-instrumentation after application-level filtering has already run.
 */
export class PrivacySafeSpanExporter implements SpanExporter {
  constructor(private readonly delegate: SpanExporter) {}

  export(
    spans: ReadableSpan[],
    resultCallback: Parameters<SpanExporter["export"]>[1],
  ): void {
    this.delegate.export(spans.map(privacySafeReadableSpan), resultCallback);
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush?.() ?? Promise.resolve();
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }
}
