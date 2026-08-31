'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiMutate } from '@content-automation/platform/network/api-client';

export type DurableOperationStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';

export interface DurableOperation<TResult extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  action: string;
  entityId: string | null;
  status: DurableOperationStatus;
  progress: number;
  attempt: number;
  maxAttempts: number;
  result: TResult | null;
  error: { code?: string; message?: string } | null;
  estimatedCredits: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

function isRunning(operation: DurableOperation | null): boolean {
  return operation?.status === 'queued' || operation?.status === 'processing';
}

/**
 * Starts and polls one server-backed operation, and discovers an unfinished
 * matching operation after a browser reload. The operation row—not component
 * memory—is the source of truth, so leaving the page never starts a duplicate.
 */
export function useDurableOperation<
  TResult extends Record<string, unknown> = Record<string, unknown>,
  TProgress = unknown,
>({
  action,
  entityId,
  startApi,
  body,
  pollIntervalMs = 750,
}: {
  action: string;
  entityId: string;
  startApi: string;
  body: Record<string, unknown>;
  pollIntervalMs?: number;
}) {
  const [operation, setOperationState] = useState<DurableOperation<TResult> | null>(null);
  const [progressSnapshot, setProgressSnapshot] = useState<TProgress | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const operationRef = useRef<DurableOperation<TResult> | null>(null);
  const startingRef = useRef(false);
  const bodyRef = useRef(body);
  bodyRef.current = body;

  const absorb = useCallback((next: DurableOperation<TResult>) => {
    operationRef.current = next;
    setOperationState(next);
    setTransportError(null);
    const snapshot = (next.result as { progressSnapshot?: TProgress } | null)?.progressSnapshot;
    if (snapshot !== undefined) setProgressSnapshot(snapshot);
  }, []);

  const latestReconnectable = useCallback(async () => {
    const { operations } = await apiGet<{ operations: DurableOperation<TResult>[] }>('/operations', { limit: 100 });
    const matching = operations.filter((candidate) => (
      candidate.action === action
      && candidate.entityId === entityId
    ));
    return matching.find((candidate) => isRunning(candidate))
      ?? matching[0]
      ?? null;
  }, [action, entityId]);

  useEffect(() => {
    let cancelled = false;
    operationRef.current = null;
    setOperationState(null);
    setProgressSnapshot(null);
    setTransportError(null);
    void latestReconnectable()
      .then((found) => {
        if (!cancelled && found) absorb(found);
      })
      .catch(() => {
        if (!cancelled) setTransportError('Could not reconnect to the latest operation. Refresh to try again.');
      });
    return () => { cancelled = true; };
  }, [absorb, latestReconnectable]);

  useEffect(() => {
    if (!operation || !isRunning(operation)) return;
    const operationId = operation.id;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const { operation: next } = await apiGet<{ operation: DurableOperation<TResult> }>(
          `/operations/${operationId}`,
        );
        if (cancelled) return;
        absorb(next);
        if (isRunning(next)) timer = window.setTimeout(poll, pollIntervalMs);
      } catch {
        if (cancelled) return;
        setTransportError('Research is still running, but its status could not be refreshed. Retrying…');
        timer = window.setTimeout(poll, Math.max(1_500, pollIntervalMs));
      }
    };
    timer = window.setTimeout(poll, pollIntervalMs);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [absorb, operation, pollIntervalMs]);

  const start = useCallback(async (bodyOverride?: Record<string, unknown>) => {
    if (startingRef.current) return operationRef.current;
    if (isRunning(operationRef.current)) return operationRef.current;
    startingRef.current = true;
    setIsStarting(true);
    setTransportError(null);
    try {
      const existing = await latestReconnectable();
      if (existing && isRunning(existing)) {
        absorb(existing);
        return existing;
      }
      setProgressSnapshot(null);
      const response = await apiMutate<{ operation: DurableOperation<TResult> }>(
        'POST',
        startApi,
        bodyOverride ?? bodyRef.current,
        { idempotencyKey: crypto.randomUUID() },
      );
      absorb(response.data.operation);
      return response.data.operation;
    } catch (cause) {
      setTransportError(cause instanceof Error ? cause.message : 'Could not start the operation.');
      return null;
    } finally {
      startingRef.current = false;
      setIsStarting(false);
    }
  }, [absorb, latestReconnectable, startApi]);

  const retry = useCallback(async () => {
    const current = operationRef.current;
    if (!current || current.status !== 'failed' || isRetrying) return current;
    setIsRetrying(true);
    setTransportError(null);
    try {
      const response = await apiMutate<{ operation: DurableOperation<TResult> }>(
        'POST',
        `/operations/${current.id}/retry`,
        {},
        { idempotencyKey: crypto.randomUUID() },
      );
      absorb(response.data.operation);
      return response.data.operation;
    } catch (cause) {
      setTransportError(cause instanceof Error ? cause.message : 'Could not retry the operation.');
      return null;
    } finally {
      setIsRetrying(false);
    }
  }, [absorb, isRetrying]);

  const operationError = operation?.status === 'failed'
    ? operation.error?.message ?? 'The operation failed before it completed.'
    : null;

  return {
    operation,
    progressSnapshot,
    error: operationError ?? transportError,
    isStarting,
    isRetrying,
    isRunning: isRunning(operation) || isStarting,
    isComplete: operation?.status === 'succeeded',
    final: operation?.status === 'succeeded' ? operation.result : null,
    start,
    retry,
  };
}
