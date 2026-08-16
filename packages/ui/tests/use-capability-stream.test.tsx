import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiStream, ApiError } = vi.hoisted(() => {
  class HoistedApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return { apiStream: vi.fn(), ApiError: HoistedApiError };
});

vi.mock('@content-automation/platform/network/api-client', () => ({ apiStream, ApiError }));

import { useCapabilityStream } from '../hooks/use-capability-stream';

type Handlers = {
  onChunk?: (chunk: unknown) => void;
  onResult?: (result: { data: unknown; meta: { requestId: string; replayed: boolean; summary: string } }) => void;
  onError?: (cause: ApiError) => void;
};

describe('useCapabilityStream', () => {
  let handlers: Handlers;
  let settleDone: { resolve: (value: unknown) => void; reject: (cause: unknown) => void };
  const aborts: Array<ReturnType<typeof vi.fn>> = [];

  beforeEach(() => {
    apiStream.mockReset();
    aborts.length = 0;
    apiStream.mockImplementation((_path, _body, streamHandlers) => {
      handlers = streamHandlers as Handlers;
      const abort = vi.fn();
      aborts.push(abort);
      return {
        done: new Promise((resolve, reject) => {
          settleDone = { resolve, reject };
        }),
        abort,
      };
    });
  });

  it('derives partial, reasoning, progress, and data parts from chunks; final from the result event', async () => {
    const { result } = renderHook(() =>
      useCapabilityStream<{ count: number }, { count: number }>({ api: '/content/research/run', body: { stable: true } }));

    act(() => result.current.start({ entityId: 'prospect-1' }));
    expect(apiStream).toHaveBeenCalledWith(
      '/content/research/run',
      { stable: true, entityId: 'prospect-1' },
      expect.any(Object),
    );
    expect(result.current.isStreaming).toBe(true);

    act(() => {
      handlers.onChunk?.({ type: 'data-partial', data: { count: 1 } });
      handlers.onChunk?.({ type: 'data-partial', data: { count: 2 } });
      handlers.onChunk?.({ type: 'data-reasoning', data: { text: 'Checking' } });
      handlers.onChunk?.({ type: 'data-progress', id: 'search', data: { label: 'Search', state: 'running' } });
      handlers.onChunk?.({ type: 'data-progress', id: 'search', data: { label: 'Search', state: 'done' } });
      handlers.onChunk?.({ type: 'data-candidate', id: 'v1', data: { id: 'v1' } });
      handlers.onChunk?.({ type: 'data-action-error', id: 'error', data: { message: 'Recoverable' } });
    });
    expect(result.current.partial).toEqual({ count: 2 });
    expect(result.current.reasoning).toBe('Checking');
    expect(result.current.progress).toEqual([{ id: 'search', label: 'Search', state: 'done' }]);
    expect(result.current.dataParts).toEqual([
      { type: 'data-candidate', id: 'v1', data: { id: 'v1' } },
      { type: 'data-action-error', id: 'error', data: { message: 'Recoverable' } },
    ]);
    expect(result.current.final).toBeNull();

    const outcome = { data: { count: 3 }, meta: { requestId: 'req', replayed: false, summary: 'Done.' } };
    await act(async () => {
      handlers.onResult?.(outcome);
      settleDone.resolve(outcome);
      await Promise.resolve();
    });
    expect(result.current.final).toEqual({ count: 3 });
    expect(result.current.isStreaming).toBe(false);
  });

  it('surfaces the terminal error event and aborts a superseded stream', async () => {
    const { result } = renderHook(() => useCapabilityStream({ api: '/outreach/prospects/p1/qualify' }));

    act(() => result.current.start());
    const failure = new ApiError(500, 'INTERNAL', 'Stream failed');
    await act(async () => {
      handlers.onError?.(failure);
      settleDone.reject(failure);
      await Promise.resolve();
    });
    expect(result.current.error).toBe('Stream failed');
    expect(result.current.isStreaming).toBe(false);

    // A new start aborts the previous transport and clears the derived state.
    act(() => result.current.start());
    expect(aborts[0]).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(result.current.isStreaming).toBe(true);

    act(() => result.current.abort());
    expect(aborts[1]).toHaveBeenCalled();
  });
});
