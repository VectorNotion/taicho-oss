import {
  activateExecutionContext,
  applyExecutionContextToActiveSpan,
  executionAttributes,
  type ExecutionContext,
} from "./context";
import {
  ACTOR_ID_HEADER,
  ACTOR_TYPE_HEADER,
  EXECUTION_ID_HEADER,
  ORGANIZATION_ID_HEADER,
  PARENT_EXECUTION_ID_HEADER,
  REQUEST_ID_HEADER,
  SESSION_ID_HEADER,
  headersAtExternalBoundary,
} from "./headers";
import { createLogger, installPrivacySafeConsoleBridge } from "./logger";
import {
  cleanupExpiredExecutionLedger,
  closeExecutionLedger,
  ensureExecutionLedger,
} from "./ledger";
import { PrivacySafeSpanExporter } from "./otel-privacy";

type ObservabilityState = {
  start?: Promise<void>;
  sdk?: { shutdown(): Promise<void> };
  shutdownHookInstalled?: boolean;
};

const globalState = globalThis as typeof globalThis & {
  __contentAutomationObservability?: ObservabilityState;
};
const state = globalState.__contentAutomationObservability ??= {};
const log = createLogger("observability");

export type NodeObservabilityOptions = {
  serviceName: string;
  serviceVersion?: string;
};

function enabled(): boolean {
  if (process.env.OBSERVABILITY_ENABLED === "false") return false;
  return process.env.OBSERVABILITY_ENABLED === "true"
    || Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
    || Boolean(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
}

function cloudExportConfigured(): boolean {
  return enabled()
    || Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

const ATTRIBUTION_HEADERS = [
  REQUEST_ID_HEADER,
  EXECUTION_ID_HEADER,
  PARENT_EXECUTION_ID_HEADER,
  ORGANIZATION_ID_HEADER,
  ACTOR_ID_HEADER,
  ACTOR_TYPE_HEADER,
  SESSION_ID_HEADER,
] as const;

function activateIncomingHttpAttribution(request: unknown): ExecutionContext | undefined {
  if (
    !request
    || typeof request !== "object"
    || !("headers" in request)
    // ClientRequest has setHeader; IncomingMessage does not. Never copy private
    // attribution into the context of outbound calls to third parties.
    || "setHeader" in request
  ) return undefined;
  const rawHeaders = (request as { headers?: Record<string, string | string[] | undefined> }).headers;
  if (!rawHeaders) return undefined;
  const headers = new Headers();
  for (const name of ATTRIBUTION_HEADERS) {
    const raw = rawHeaders[name];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (header) headers.set(name, header);
  }
  const execution = activateExecutionContext({
    headers: headersAtExternalBoundary(headers),
    actorType: "system",
  });
  applyExecutionContextToActiveSpan(execution);
  return execution;
}

export async function initializeObservability(options: NodeObservabilityOptions): Promise<void> {
  process.env.OTEL_SERVICE_NAME ??= options.serviceName;
  process.env.DD_SERVICE ??= options.serviceName;
  if (options.serviceVersion) process.env.DD_VERSION ??= options.serviceVersion;
  if (cloudExportConfigured() && !process.env.OBSERVABILITY_ID_HASH_KEY) {
    throw new Error("OBSERVABILITY_ID_HASH_KEY is required whenever cloud telemetry is enabled.");
  }
  await ensureExecutionLedger();
  await cleanupExpiredExecutionLedger();
  if (!enabled()) {
    log.info("observability.export.disabled", {
      service_name: options.serviceName,
      environment: process.env.DD_ENV ?? process.env.NODE_ENV ?? "development",
    });
    return;
  }
  if (!state.shutdownHookInstalled) {
    state.shutdownHookInstalled = true;
    process.once("beforeExit", () => {
      void shutdownObservability();
    });
  }
  installPrivacySafeConsoleBridge();
  if (state.start) return state.start;

  state.start = (async () => {
    const [
      { NodeSDK },
      { getNodeAutoInstrumentations },
      { OTLPTraceExporter },
      { OTLPMetricExporter },
      { PeriodicExportingMetricReader },
      { resourceFromAttributes },
    ] = await Promise.all([
      import("@opentelemetry/sdk-node"),
      import("@opentelemetry/auto-instrumentations-node"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/exporter-metrics-otlp-http"),
      import("@opentelemetry/sdk-metrics"),
      import("@opentelemetry/resources"),
    ]);

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        "service.name": options.serviceName,
        "service.version": options.serviceVersion ?? process.env.DD_VERSION ?? "development",
        "deployment.environment.name": process.env.DD_ENV ?? process.env.NODE_ENV ?? "development",
      }),
      traceExporter: new PrivacySafeSpanExporter(new OTLPTraceExporter()),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 60_000),
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: false },
          "@opentelemetry/instrumentation-http": {
            requestHook: (span, request) => {
              const execution = activateIncomingHttpAttribution(request);
              if (execution) span.setAttributes(executionAttributes(execution));
            },
          },
        }),
      ],
    });
    await sdk.start();
    state.sdk = sdk;
    log.info("observability.export.started", {
      service_name: options.serviceName,
      environment: process.env.DD_ENV ?? process.env.NODE_ENV ?? "development",
    });
  })();

  return state.start;
}

export async function shutdownObservability(): Promise<void> {
  if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    await import("./ai").then(({ shutdownAiObservability }) => shutdownAiObservability());
  }
  if (state.sdk) {
    await state.sdk.shutdown();
    state.sdk = undefined;
    state.start = undefined;
  }
  await closeExecutionLedger();
}
