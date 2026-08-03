'use client';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export type StreamState = 'idle' | 'streaming' | 'done' | 'error';
export function StreamSection({ title, state, children }: { title: string; state: StreamState; children: ReactNode }) {
  return (
    <div data-stream-state={state} aria-busy={state === 'streaming'} className={cn('rounded-xl border bg-card p-6 transition-colors duration-500', state === 'streaming' && 'animate-pulse border-primary/60', state === 'error' && 'border-destructive/60')}>
      <div className="mb-4 flex items-center gap-2">
        <h3 className="font-semibold">{title}</h3>
        {state === 'streaming' && <span className="text-xs text-primary">generating…</span>}
      </div>
      {children}
    </div>
  );
}
