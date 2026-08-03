'use client';

import { useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

export type ActionDataPart = { type: string; id?: string; data?: unknown };

export function useActionStream<TPartial = unknown, TFinal = unknown>({
  api,
  body,
}: {
  api: string;
  body?: Record<string, unknown>;
}) {
  const transport = useMemo(() => new DefaultChatTransport({ api, body }), [api, body]);
  const { messages, setMessages, sendMessage, status, error: transportError } = useChat({ transport });

  const derived = useMemo(() => {
    let partial: TPartial | null = null;
    let final: TFinal | null = null;
    let reasoning = '';
    let error: string | null = null;
    const progress = new Map<string, { id: string; label: string; state: string }>();
    const partialsById = new Map<string, TPartial>();
    const reasoningById = new Map<string, string>();
    const dataParts: ActionDataPart[] = [];

    for (const message of messages) {
      if (message.role !== 'assistant') continue;
      for (const raw of message.parts ?? []) {
        const part = raw as ActionDataPart;
        if (part.type === 'data-partial') {
          partial = part.data as TPartial;
          partialsById.set(part.id ?? 'default', part.data as TPartial);
        }
        else if (part.type === 'data-final') final = part.data as TFinal;
        else if (part.type === 'data-reasoning') {
          reasoning = (part.data as { text?: string })?.text ?? '';
          reasoningById.set(part.id ?? 'default', reasoning);
        }
        else if (part.type === 'data-action-error') error = (part.data as { message?: string })?.message ?? 'Action failed';
        else if (part.type === 'data-progress') {
          const data = part.data as { label?: string; state?: string };
          const id = part.id ?? String(progress.size);
          progress.set(id, { id, label: data?.label ?? '', state: data?.state ?? 'running' });
        } else if (part.type.startsWith('data-')) dataParts.push(part);
      }
    }
    return {
      partial,
      final,
      reasoning,
      error,
      progress: [...progress.values()],
      partialsById: Object.fromEntries(partialsById),
      reasoningById: Object.fromEntries(reasoningById),
      dataParts,
    };
  }, [messages]);

  return {
    ...derived,
    error: derived.error ?? transportError?.message ?? null,
    isStreaming: status === 'submitted' || status === 'streaming',
    start: (extraBody: Record<string, unknown> = {}) => {
      setMessages([]);
      void sendMessage({ text: 'run' }, { body: extraBody });
    },
  };
}
