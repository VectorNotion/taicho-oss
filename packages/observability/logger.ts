import {
  activeTraceIds,
  currentExecutionContext,
  executionAttributes,
} from "./context";
import { safeAttributes, safeError } from "./privacy";
import { safeOtelAttributes } from "./otel-privacy";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type ConfiguredLogLevel = LogLevel | "silent";

export type LogFields = Record<string, unknown> & {
  error?: unknown;
};

export type StructuredLogRecord = {
  timestamp: string;
  level: LogLevel;
  service: string;
  component?: string;
  event: string;
  message?: string;
  trace_id?: string;
  span_id?: string;
  execution_id?: string;
  request_id?: string;
  organization_ref?: string;
  actor_ref?: string;
  actor_type?: string;
  attributes?: Record<string, unknown>;
  error?: ReturnType<typeof safeError>;
};

function serviceName(): string {
  return process.env.OTEL_SERVICE_NAME
    ?? process.env.DD_SERVICE
    ?? process.env.npm_package_name
    ?? "content-automation";
}

export function serializeLogRecord(
  level: LogLevel,
  event: string,
  message?: string,
  fields: LogFields = {},
  component?: string,
): StructuredLogRecord {
  const execution = currentExecutionContext();
  const traceIds = activeTraceIds();
  const attribution = executionAttributes(execution);
  const { error, ...attributes } = fields;
  return {
    timestamp: new Date().toISOString(),
    level,
    service: serviceName(),
    component,
    event: event.slice(0, 128),
    message: undefined,
    trace_id: traceIds.traceId,
    span_id: traceIds.spanId,
    execution_id: execution?.executionId,
    request_id: execution?.requestId,
    organization_ref: attribution["taicho.organization.ref"] as string | undefined,
    actor_ref: attribution["taicho.actor.ref"] as string | undefined,
    actor_type: execution?.actorType,
    attributes: Object.keys(attributes).length > 0
      ? cloudSafeLogAttributes(attributes)
      : undefined,
    error: error === undefined ? undefined : safeError(error),
  };
}

function write(record: StructuredLogRecord): void {
  const output = `${JSON.stringify(record)}\n`;
  if (record.level === "error" || record.level === "warn") process.stderr.write(output);
  else process.stdout.write(output);
}

const LOG_LEVEL_RANK: Record<ConfiguredLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
};

function configuredLogLevel(): ConfiguredLogLevel {
  const configured = process.env.OBSERVABILITY_LOG_LEVEL?.toLowerCase();
  return configured === "debug"
    || configured === "info"
    || configured === "warn"
    || configured === "error"
    || configured === "silent"
    ? configured
    : "info";
}

function shouldWrite(level: LogLevel): boolean {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[configuredLogLevel()];
}

function cloudSafeLogAttributes(input: Record<string, unknown>): Record<string, unknown> {
  return safeOtelAttributes(safeAttributes(input)) as Record<string, unknown>;
}

export function createLogger(component?: string) {
  return {
    debug(event: string, fields?: LogFields, message?: string) {
      if (shouldWrite("debug")) {
        write(serializeLogRecord("debug", event, message, fields, component));
      }
    },
    info(event: string, fields?: LogFields, message?: string) {
      if (shouldWrite("info")) {
        write(serializeLogRecord("info", event, message, fields, component));
      }
    },
    warn(event: string, fields?: LogFields, message?: string) {
      if (shouldWrite("warn")) {
        write(serializeLogRecord("warn", event, message, fields, component));
      }
    },
    error(event: string, error: unknown, fields?: LogFields, message?: string) {
      if (shouldWrite("error")) {
        write(serializeLogRecord("error", event, message, { ...fields, error }, component));
      }
    },
  };
}

export const logger = createLogger();

const consoleBridgeState = globalThis as typeof globalThis & {
  __contentAutomationConsoleBridgeInstalled?: boolean;
};

/**
 * Legacy server code still contains console calls. Datadog collects container
 * stdout, so forwarding their arbitrary arguments would defeat the privacy
 * boundary. This bridge keeps level and grouping information but never emits
 * the original arguments.
 */
export function installPrivacySafeConsoleBridge(): void {
  if (consoleBridgeState.__contentAutomationConsoleBridgeInstalled) return;
  consoleBridgeState.__contentAutomationConsoleBridgeInstalled = true;
  const legacy = createLogger("legacy-console");
  const emit = (level: LogLevel, args: unknown[]) => {
    const error = args.find((value) => value instanceof Error);
    const fields = {
      argument_count: args.length,
    };
    if (level === "error") legacy.error("legacy.console.error", error, fields);
    else if (level === "warn") legacy.warn("legacy.console.warn", fields);
    else if (level === "debug") legacy.debug("legacy.console.debug", fields);
    else legacy.info(`legacy.console.${level}`, fields);
  };
  console.log = (...args: unknown[]) => emit("info", args);
  console.info = (...args: unknown[]) => emit("info", args);
  console.warn = (...args: unknown[]) => emit("warn", args);
  console.error = (...args: unknown[]) => emit("error", args);
  console.debug = (...args: unknown[]) => emit("debug", args);
}
