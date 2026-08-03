'use client';

import { useEffect, useState } from 'react';

export function ComponentTag({ id, name, className = '' }: { id: string; name: string; className?: string }) {
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 rounded border border-primary/20 bg-primary/6 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wide text-primary ${className}`}>
      <span>{id}</span><span className="text-muted-foreground">·</span><span className="font-sans normal-case tracking-normal text-foreground/75">{name}</span>
    </span>
  );
}

/**
 * WORK-07 Inference Ticker — a bottom-anchored window for live thinking.
 * The newest thought is always visible at the bottom; older lines and any
 * overflow from a long wrapping line scroll off the top under a fade mask.
 * `windowClass` caps the height (e.g. 'max-h-10' ≈ 2 lines at leading-5).
 */
function TickerLine({ line, active }: { line: string; active: boolean }) {
  // Enter closed, then open on the next frame — the grid-rows transition makes
  // the new line push the stack up smoothly instead of jumping.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
      <div className="overflow-hidden">
        <p className="flex items-start gap-2 pb-1">
          <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full ${active ? 'animate-pulse bg-primary motion-reduce:animate-none' : 'bg-muted-foreground/40'}`} />
          <span className={`min-w-0 flex-1 ${active ? 'animate-ticker-shimmer' : ''}`}>{line}</span>
        </p>
      </div>
    </div>
  );
}

export function InferenceTicker({ lines, windowClass = 'max-h-10', className = '' }: { lines: string[]; windowClass?: string; className?: string }) {
  return (
    <div aria-live="polite" className={`flex flex-col justify-end overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_45%)] ${windowClass} ${className}`}>
      <div className="font-mono text-[11px] leading-5 text-muted-foreground">
        {lines.map((line, index) => (
          <TickerLine active={index === lines.length - 1} key={line} line={line} />
        ))}
      </div>
    </div>
  );
}

export function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="max-w-3xl">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground md:text-base">{description}</p>
    </div>
  );
}
