'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { apiStream, type ApiError } from '@content-automation/platform/network/api-client';

export type ActionDataPart = { type: string; id?: string; data?: unknown };

/**
 * Successor to useActionStream for registry stream capabilities.
 *
 * Same derived-state contract (partial/final/reasoning/progress/dataParts/
 * isStreaming/start), but the transport is the /api/v1 SSE projection
 * (POST <api>/stream) instead of the legacy generative-UI route. Chunks are
 * the same data-* part vocabulary the server always emitted; the final
 * result arrives as the SSE terminal `result` event rather than a
 * data-final part.
 */
export function useCapabilityStream<TPartial = unknown, TFinal = unknown>({
  api,
  body,
}: {
  /** Capability rest path under /api/v1, without the /stream suffix. */
  api: string;
  body?: Record<string, unknown>;
}) {
  const [parts, setParts] = useState<ActionDataPart[]>([]);
  const [final, setFinal] = useState<TFinal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const active = useRef<{ abort: () => void } | null>(null);

  const start = useCallback((extraBody: Record<string, unknown> = {}) => {
    active.current?.abort();
    setParts([]);
    setFinal(null);
    setError(null);
    setIsStreaming(true);
    const stream = apiStream<ActionDataPart, TFinal>(api, { ...body, ...extraBody }, {
      onChunk: (part) => setParts((current) => [...current, part]),
      onResult: (result) => setFinal(result.data),
      onError: (cause: ApiError) => setError(cause.message),
    });
    active.current = stream;
    stream.done
      .catch((cause: unknown) => {
        setError((current) => current ?? (cause instanceof Error ? cause.message : 'Action failed'));
      })
      .finally(() => setIsStreaming(false));
  }, [api, body]);

  const derived = useMemo(() => {
    let partial: TPartial | null = null;
    let reasoning = '';
    const progress = new Map<string, { id: string; label: string; state: string }>();
    const partialsById = new Map<string, TPartial>();
    const reasoningById = new Map<string, string>();
    const dataParts: ActionDataPart[] = [];
    for (const part of parts) {
      if (part.type === 'data-partial') {
        partial = part.data as TPartial;
        partialsById.set(part.id ?? 'default', part.data as TPartial);
      } else if (part.type === 'data-reasoning') {
        reasoning = (part.data as { text?: string })?.text ?? '';
        reasoningById.set(part.id ?? 'default', reasoning);
      } else if (part.type === 'data-action-error') {
        // Emitted mid-stream by orchestrators; terminal errors arrive as the
        // SSE error event, but honor the part form too.
        const message = (part.data as { message?: string })?.message;
        if (message) dataParts.push(part);
      } else if (part.type === 'data-progress') {
        const data = part.data as { label?: string; state?: string };
        const id = part.id ?? String(progress.size);
        progress.set(id, { id, label: data?.label ?? '', state: data?.state ?? 'running' });
      } else if (part.type.startsWith('data-')) {
        dataParts.push(part);
      }
    }
    return {
      partial,
      reasoning,
      progress: [...progress.values()],
      partialsById: Object.fromEntries(partialsById),
      reasoningById: Object.fromEntries(reasoningById),
      dataParts,
    };
  }, [parts]);

  return {
    ...derived,
    final,
    error,
    isStreaming,
    start,
    abort: () => active.current?.abort(),
  };
}
