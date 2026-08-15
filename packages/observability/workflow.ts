import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import {
  ROOT_CONTEXT,
  SpanStatusCode,
  context as otelContext,
  trace,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { withSpan } from "@arizeai/openinference-core";
import {
  MimeType,
  OpenInferenceSpanKind,
} from "@arizeai/openinference-semantic-conventions";
import { currentExecutionContext, executionAttributes } from "./context";
import { safeAttributes, safeError } from "./privacy";

const workflowContext = new AsyncLocalStorage<Context>();

const CONTENT_LIMIT_BYTES = 64 * 1024;
const STRING_LIMIT = 12 * 1024;
const ARRAY_LIMIT = 64;
const OBJECT_KEY_LIMIT = 96;
const SECRET_KEY = /(^|[._-])(authorization|cookie|credential|password|secret|token|api[_-]?key)([._-]|$)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /bearer\s+[a-z0-9._~+/-]+=*/gi;
const INLINE_SECRET = /\b(api[_-]?key|password|secret|token)\s*[:=]\s*[^\s,;]+/gi;

export type WorkflowSpanKind =
  | "workflow"
  | "data"
  | "tool"
  | "generation"
  | "scoring"
  | "decision"
  | "persistence";

export type WorkflowContentMode = "off" | "metadata" | "full";

export type ObserveWorkflowOptions = {
  kind: WorkflowSpanKind;
  input?: unknown;
  attributes?: Record<string, unknown>;
};

export type TraceableOptions<TArgs extends unknown[], TResult> = {
  /** Stable, human-readable waterfall label; defaults to the wrapped function name. */
  name?: string;
  kind?: WorkflowSpanKind;
  attributes?: Record<string, unknown> | ((args: TArgs) => Record<string, unknown>);
  /** Mirrors LangSmith's processInputs hook and is also the privacy boundary for arguments. */
  processInputs?: (args: TArgs) => unknown;
  /** Mirrors LangSmith's processOutputs hook for compacting or redacting the returned value. */
  processOutputs?: (output: TResult) => unknown;
};

export type WorkflowRecorder = {
  setInput(value: unknown): void;
  setOutput(value: unknown): void;
  setAttributes(attributes: Record<string, unknown>): void;
};

export type SerializedWorkflowContent = {
  value?: string;
  bytes: number;
  digest: string;
  truncated: boolean;
};

function workflowContentMode(): WorkflowContentMode {
  const configured = process.env.OBSERVABILITY_WORKFLOW_CONTENT?.trim().toLowerCase();
  if (configured === "off" || configured === "metadata" || configured === "full") {
    return configured;
  }
  return "full";
}

function sanitizeString(value: string): string {
  return value
    .replaceAll(EMAIL, "[REDACTED_EMAIL]")
    .replaceAll(BEARER, "Bearer [REDACTED]")
    .replaceAll(INLINE_SECRET, "$1=[REDACTED]")
    .slice(0, STRING_LIMIT);
}

function sanitizeContent(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[DEPTH_LIMIT]";
  if (value === undefined) return null;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    const normalized = safeError(value);
    return { type: normalized.type, code: normalized.code, detail: sanitizeString(normalized.message) };
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, ARRAY_LIMIT).map((item) => sanitizeContent(item, depth + 1));
    if (value.length > ARRAY_LIMIT) items.push(`[${value.length - ARRAY_LIMIT} MORE ITEMS]`);
    return items;
  }
  if (typeof value !== "object") return String(value);

  const output: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, item] of entries.slice(0, OBJECT_KEY_LIMIT)) {
    output[key] = SECRET_KEY.test(key) ? "[REDACTED]" : sanitizeContent(item, depth + 1);
  }
  if (entries.length > OBJECT_KEY_LIMIT) output.__truncated_keys = entries.length - OBJECT_KEY_LIMIT;
  return output;
}

export function serializeWorkflowContent(value: unknown): SerializedWorkflowContent {
  const serialized = JSON.stringify(sanitizeContent(value));
  const bytes = Buffer.byteLength(serialized);
  const digest = createHash("sha256").update(serialized).digest("hex");
  if (bytes <= CONTENT_LIMIT_BYTES) {
    return { value: serialized, bytes, digest, truncated: false };
  }
  const preview = Buffer.from(serialized).subarray(0, CONTENT_LIMIT_BYTES - 96).toString("utf8");
  return {
    value: `${preview}\n...[TRUNCATED sha256=${digest}]`,
    bytes,
    digest,
    truncated: true,
  };
}

function setContent(span: Span, direction: "input" | "output" | "error", value: unknown): void {
  span.setAttributes(contentAttributes(direction, value));
}

function contentAttributes(direction: "input" | "output" | "error", value: unknown): Attributes {
  const content = serializeWorkflowContent(value);
  const prefix = `taicho.content.${direction}`;
  const attributes: Attributes = {
    [`${prefix}.bytes`]: content.bytes,
    [`${prefix}.sha256`]: content.digest,
    [`${prefix}.truncated`]: content.truncated,
  };
  if (workflowContentMode() === "full" && content.value !== undefined) {
    if (direction === "input") {
      attributes["input.value"] = content.value;
      attributes["input.mime_type"] = MimeType.JSON;
    } else if (direction === "output") {
      attributes["output.value"] = content.value;
      attributes["output.mime_type"] = MimeType.JSON;
    } else {
      attributes[prefix] = content.value;
    }
  }
  return attributes;
}

function openInferenceKind(kind: WorkflowSpanKind): OpenInferenceSpanKind {
  switch (kind) {
    case "data": return OpenInferenceSpanKind.RETRIEVER;
    case "tool": return OpenInferenceSpanKind.TOOL;
    case "generation": return OpenInferenceSpanKind.LLM;
    case "scoring": return OpenInferenceSpanKind.EVALUATOR;
    case "decision": return OpenInferenceSpanKind.CHAIN;
    case "persistence": return OpenInferenceSpanKind.TOOL;
    case "workflow": return OpenInferenceSpanKind.CHAIN;
  }
}

function workflowAttributes(options: ObserveWorkflowOptions, role: "root" | "step"): Attributes {
  return {
    ...executionAttributes(currentExecutionContext()),
    ...safeAttributes(options.attributes),
    "taicho.trace.category": "workflow",
    "taicho.workflow.role": role,
    "taicho.workflow.span_kind": options.kind,
    "taicho.content.mode": workflowContentMode(),
    "openinference.span.kind": openInferenceKind(options.kind),
  };
}

async function observeWorkflowSpan<T>(
  name: string,
  options: ObserveWorkflowOptions,
  callback: (recorder: WorkflowRecorder) => T | Promise<T>,
  processOutput: (output: T) => unknown = (output) => output,
): Promise<T> {
  const tracer = trace.getTracer("taicho.workflow");
  const semanticParent = workflowContext.getStore();
  const role = semanticParent ? "step" : "root";
  const parentContext = semanticParent ?? ROOT_CONTEXT;
  const startedAt = performance.now();

  return tracer.startActiveSpan(
    name,
    { attributes: workflowAttributes(options, role) },
    parentContext,
    async (span) => {
      const activeSemanticContext = trace.setSpan(parentContext, span);
      const recorder: WorkflowRecorder = {
        setInput: (value) => setContent(span, "input", value),
        setOutput: (value) => setContent(span, "output", value),
        setAttributes: (attributes) => span.setAttributes(safeAttributes(attributes)),
      };
      if (options.input !== undefined) recorder.setInput(options.input);

      return workflowContext.run(activeSemanticContext, async () => {
        try {
          const result = await callback(recorder);
          recorder.setOutput(processOutput(result));
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          const normalized = safeError(error);
          span.recordException({ name: normalized.type, message: normalized.message });
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.setAttribute("error.type", normalized.type);
          setContent(span, "error", { type: normalized.type, code: normalized.code, detail: normalized.message });
          throw error;
        } finally {
          span.setAttribute("taicho.workflow.duration_ms", performance.now() - startedAt);
          span.end();
        }
      });
    },
  );
}

/**
 * LangSmith-style function instrumentation for semantic OTel waterfalls.
 * Arguments, return values, errors, duration, and async parent/child context are
 * captured automatically; callers only select which meaningful functions to wrap.
 */
export function traceable<TArgs extends unknown[], TResult>(
  callback: (...args: TArgs) => TResult | Promise<TResult>,
  options: TraceableOptions<TArgs, TResult> = {},
): (...args: TArgs) => Promise<TResult> {
  const name = options.name ?? callback.name ?? "workflow.function";
  return async (...args: TArgs): Promise<TResult> => {
    const semanticParent = workflowContext.getStore();
    const role = semanticParent ? "step" : "root";
    const attributes = typeof options.attributes === "function"
      ? options.attributes(args)
      : options.attributes;
    const kind = options.kind ?? "workflow";
    const traced = withSpan(
      (...innerArgs: TArgs) => workflowContext.run(
        otelContext.active(),
        () => callback(...innerArgs),
      ),
      {
        name,
        kind: openInferenceKind(kind),
        attributes: workflowAttributes({ kind, attributes }, role),
        processInput: (...innerArgs: TArgs) => {
          const input = options.processInputs
            ? options.processInputs(innerArgs)
            : innerArgs.length === 1
              ? innerArgs[0]
              : { arguments: innerArgs };
          return contentAttributes("input", input);
        },
        processOutput: (output: TResult) => contentAttributes(
          "output",
          options.processOutputs ? options.processOutputs(output) : output,
        ),
      },
    );
    const parentContext = semanticParent ?? ROOT_CONTEXT;
    return Promise.resolve(otelContext.with(parentContext, () => traced(...args)));
  };
}

/** Starts a clean workflow root, or a semantic segment when another workflow is already active. */
export function observeWorkflow<T>(
  name: string,
  options: ObserveWorkflowOptions,
  callback: (recorder: WorkflowRecorder) => T | Promise<T>,
): Promise<T> {
  return observeWorkflowSpan(name, { ...options, kind: "workflow" }, callback);
}

/** Adds one human-meaningful step to the active workflow waterfall. */
export function observeWorkflowStep<T>(
  name: string,
  options: ObserveWorkflowOptions,
  callback: (recorder: WorkflowRecorder) => T | Promise<T>,
): Promise<T> {
  return observeWorkflowSpan(name, options, callback);
}

/** Adds safe counters or labels to the currently active semantic step. */
export function annotateWorkflow(attributes: Record<string, unknown>): void {
  const semanticContext = workflowContext.getStore();
  const span = semanticContext ? trace.getSpan(semanticContext) : undefined;
  span?.setAttributes(safeAttributes(attributes));
}

/** Prevents fire-and-forget work from becoming an unfinished child of its caller. */
export function runDetachedWorkflow<T>(callback: () => T): T {
  return workflowContext.exit(() => otelContext.with(ROOT_CONTEXT, callback));
}
