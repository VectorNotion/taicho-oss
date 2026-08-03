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
import {
  newExecutionEventId,
  writeExecutionLedger,
} from "./ledger";

const tracer = trace.getTracer("content-automation");
const meter = metrics.getMeter("content-automation");
const operationCounter = meter.createCounter("taicho.operation.count");
const operationDuration = meter.createHistogram("taicho.operation.duration", { unit: "ms" });

export type ObserveOperationInput = ExecutionContextInput & {
  attributes?: Record<string, unknown>;
  traceCarrier?: TraceCarrier;
};

export async function observeOperation<T>(
  operation: string,
  input: ObserveOperationInput,
  callback: (execution: ExecutionContext) => T | Promise<T>,
): Promise<T> {
  const log = createLogger(operation);
  const startedAt = performance.now();
  const eventId = newExecutionEventId();
  const inherited = currentExecutionContext()
    ?? (input.headers ? createExecutionContext({ headers: input.headers }) : undefined);
  const normalizedInput: ObserveOperationInput = {
    ...input,
    executionId: input.executionId ?? randomUUID(),
    requestId: input.requestId ?? inherited?.requestId ?? randomUUID(),
    parentExecutionId: input.parentExecutionId ?? inherited?.executionId,
  };
  const attributes: Attributes = {
    ...safeAttributes(normalizedInput.attributes),
    "taicho.operation": operation,
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
        const result = await callback(execution);
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
