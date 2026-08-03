'use client';
export function StreamingText({ text, done }: { text: string; done: boolean }) {
  return <div className="whitespace-pre-wrap text-sm leading-relaxed">{text}{!done && <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-primary/70 align-text-bottom" />}</div>;
}
