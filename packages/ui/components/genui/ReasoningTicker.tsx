'use client';
import { useEffect, useRef } from 'react';

export function ReasoningTicker({ text, active }: { text: string; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [text]);
  if (!text) return null;
  return (
    <div ref={ref} data-testid="reasoning-ticker" className="max-h-28 overflow-y-auto rounded-md border border-border/50 bg-muted/30 px-4 py-3 font-mono text-xs leading-relaxed text-muted-foreground" aria-live="polite">
      {text}
      {active && <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-primary/70 align-middle" />}
    </div>
  );
}
