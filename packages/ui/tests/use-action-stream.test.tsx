import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useChat, setMessages, sendMessage } = vi.hoisted(() => ({
  useChat: vi.fn(),
  setMessages: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('@ai-sdk/react', () => ({ useChat }));

import { useActionStream } from '../hooks/use-action-stream';

describe('useActionStream', () => {
  beforeEach(() => {
    setMessages.mockReset();
    sendMessage.mockReset();
    useChat.mockReset();
  });

  it('derives the latest partial, final, reasoning, error, and keyed progress', () => {
    useChat.mockReturnValue({
      messages: [
        { role: 'user', parts: [{ type: 'data-final', data: { ignored: true } }] },
        { role: 'assistant', parts: [
          { type: 'data-partial', data: { count: 1 } },
          { type: 'data-partial', data: { count: 2 } },
          { type: 'data-reasoning', data: { text: 'Checking' } },
          { type: 'data-progress', id: 'search', data: { label: 'Search', state: 'running' } },
          { type: 'data-progress', id: 'search', data: { label: 'Search', state: 'done' } },
          { type: 'data-final', data: { count: 3 } },
          { type: 'data-action-error', data: { message: 'Recoverable' } },
        ] },
      ],
      setMessages,
      sendMessage,
      status: 'streaming',
      error: null,
    });
    const { result } = renderHook(() => useActionStream<{ count: number }, { count: number }>({ api: '/stream' }));
    expect(result.current.partial).toEqual({ count: 2 });
    expect(result.current.final).toEqual({ count: 3 });
    expect(result.current.reasoning).toBe('Checking');
    expect(result.current.error).toBe('Recoverable');
    expect(result.current.progress).toEqual([{ id: 'search', label: 'Search', state: 'done' }]);
    expect(result.current.isStreaming).toBe(true);
  });

  it('falls back to the transport error and starts with a clean message list', () => {
    useChat.mockReturnValue({
      messages: [], setMessages, sendMessage, status: 'error', error: new Error('Transport failed'),
    });
    const { result } = renderHook(() => useActionStream({ api: '/stream', body: { stable: true } }));
    expect(result.current.error).toBe('Transport failed');
    expect(result.current.isStreaming).toBe(false);
    act(() => result.current.start({ entityId: 'prospect-1' }));
    expect(setMessages).toHaveBeenCalledWith([]);
    expect(sendMessage).toHaveBeenCalledWith(
      { text: 'run' },
      { body: { entityId: 'prospect-1' } },
    );
  });
});
