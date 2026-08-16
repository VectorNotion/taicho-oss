import { randomUUID } from "node:crypto";
import {
  SpanStatusCode,
  context as otelContext,
  metrics,
  propagation,
  trace,
  type Attributes,
} from "@opentelemetry/api";
import {
  applyExecutionContextToActiveSpan,
  createExecutionContext,
  currentExecutionContext,
  executionAttributes,
  runWithExecutionContext,
  type ExecutionContext,
  type ExecutionContextInput,
  type TraceCarrier,
} from "./context";
import { createLogger } from "./logger";
import { safeAttributes, safeError } from "./privacy";
import { observeWorkflow } from "./workflow";
import {
  newExecutionEventId,
  writeExecutionLedger,
} from "./ledger";

const tracer = trace.getTracer("content-automation");
const meter = metrics.getMeter("content-automation");
const operationCounter = meter.createCounter("taicho.operation.count");
const operationDuration = meter.createHistogram("taicho.operation.duration", { unit: "ms" });

export type SemanticOperationTrace<T = unknown> = {
  /** Human-readable Phoenix waterfall name; defaults to the operation name. */
  name?: string;
  /** Deliberate, privacy-reviewed business input shown in the trace. */
  input?: unknown;
  /** Compacts or redacts the returned value before it becomes output.value. */
  processOutput?: (output: T) => unknown;
};

export type ObserveOperationInput<T = unknown> = ExecutionContextInput & {
  attributes?: Record<string, unknown>;
  traceCarrier?: TraceCarrier;
  /** Opts this business operation into the semantic OpenInference waterfall. */
  workflow?: SemanticOperationTrace<T>;
};

export async function observeOperation<T>(
  operation: string,
  input: ObserveOperationInput<T>,
  callback: (execution: ExecutionContext) => T | Promise<T>,
): Promise<T> {
  const log = createLogger(operation);
  const startedAt = performance.now();
  const eventId = newExecutionEventId();
  const inherited = currentExecutionContext()
    ?? (input.headers ? createExecutionContext({ headers: input.headers }) : undefined);
  const normalizedInput: ObserveOperationInput<T> = {
    ...input,
    executionId: input.executionId ?? randomUUID(),
    requestId: input.requestId ?? inherited?.requestId ?? randomUUID(),
    parentExecutionId: input.parentExecutionId ?? inherited?.executionId,
  };
  const attributes: Attributes = {
    ...safeAttributes(normalizedInput.attributes),
    "taicho.operation": operation,
    // Every observeOperation span is a deliberate business span and must
    // survive the workflow-focused export filter: exporting only the inner
    // semantic spans orphans them from their parents and renders the trace
    // flat in the backend.
    "taicho.trace.category": "workflow",
  };

  const parentContext = normalizedInput.traceCarrier?.traceparent
    ? propagation.extract(otelContext.active(), normalizedInput.traceCarrier)
    : otelContext.active();

  return tracer.startActiveSpan(operation, { attributes }, parentContext, async (span) =>
    runWithExecutionContext({ ...normalizedInput, operation }, async (execution) => {
      applyExecutionContextToActiveSpan(execution);
      span.setAttributes(executionAttributes(execution));
      await writeExecutionLedger({
        eventId,
        execution,
        operation,
        status: "started",
        attributes: normalizedInput.attributes,
      }).catch((error) => log.error("execution_ledger.write_failed", error, {
        ledger_status: "started",
      }));
      operationCounter.add(1, { ...attributes, "taicho.operation.status": "started" });
      log.info("operation.started", normalizedInput.attributes);
      try {
        const run = () => callback(execution);
        const result = normalizedInput.workflow
          ? await observeWorkflow(
            normalizedInput.workflow.name ?? operation,
            {
              kind: "workflow",
              input: normalizedInput.workflow.input ?? normalizedInput.attributes ?? {},
              attributes: {
                ...normalizedInput.attributes,
                "taicho.operation": operation,
              },
              processOutput: normalizedInput.workflow.processOutput as ((output: unknown) => unknown) | undefined,
            },
            run,
          )
          : await run();
        const durationMs = performance.now() - startedAt;
        span.setStatus({ code: SpanStatusCode.OK });
        span.setAttribute("taicho.operation.duration_ms", durationMs);
        operationCounter.add(1, { ...attributes, "taicho.operation.status": "succeeded" });
        operationDuration.record(durationMs, { ...attributes, "taicho.operation.status": "succeeded" });
        await writeExecutionLedger({
          eventId,
          execution,
          operation,
          status: "succeeded",
          attributes: normalizedInput.attributes,
          durationMs,
        }).catch((error) => log.error("execution_ledger.write_failed", error, {
          ledger_status: "succeeded",
        }));
        log.info("operation.succeeded", { ...normalizedInput.attributes, duration_ms: durationMs });
        return result;
      } catch (error) {
        const durationMs = performance.now() - startedAt;
        const normalized = safeError(error);
        span.recordException({
          name: normalized.type,
          message: normalized.message,
          stack: normalized.stack,
        });
        span.setStatus({ code: SpanStatusCode.ERROR, message: normalized.code ?? normalized.type });
        span.setAttributes({
          "error.type": normalized.type,
          ...(normalized.code ? { "error.code": normalized.code } : {}),
          "taicho.operation.duration_ms": durationMs,
        });
        operationCounter.add(1, { ...attributes, "taicho.operation.status": "failed" });
        operationDuration.record(durationMs, { ...attributes, "taicho.operation.status": "failed" });
        await writeExecutionLedger({
          eventId,
          execution,
          operation,
          status: "failed",
          attributes: normalizedInput.attributes,
          durationMs,
          error,
        }).catch((ledgerError) => log.error("execution_ledger.write_failed", ledgerError, {
          ledger_status: "failed",
        }));
        log.error("operation.failed", error, { ...normalizedInput.attributes, duration_ms: durationMs });
        throw error;
      } finally {
        span.end();
      }
    }),
  );
}
