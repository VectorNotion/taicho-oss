'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrainGraph, BrainNode } from '../types';
import { BrainCanvas, type BrainCanvasHandle } from './BrainCanvas';
import { Inspector } from './Inspector';
import { CommandBar } from './CommandBar';
import { LABEL } from '../physics/constants';

type Lens = 'everything' | 'content' | 'prospects' | 'recent';
const LENSES: Lens[] = ['everything', 'content', 'prospects', 'recent'];
const LENS_LABEL: Record<Lens, string> = {
  everything: 'Everything', content: 'Content', prospects: 'Prospects', recent: 'Recent',
};

const LEGEND = [
  { label: 'Projects', color: '#8b7cf7' },
  { label: 'Capabilities', color: '#5fd4d0' },
  { label: 'Topics & research', color: '#d9a15c' },
  { label: 'Ideas & drafts', color: '#7cc98f' },
  { label: 'Prospects & assessments', color: '#d97c8a' },
  { label: 'Personas', color: '#e6e6f0' },
] as const;

export function BrainView() {
  const canvas = useRef<BrainCanvasHandle>(null);
  const [selected, setSelected] = useState<BrainNode | null>(null);
  const [trail, setTrail] = useState<BrainNode[]>([]);
  const [lens, setLensState] = useState<Lens>('everything');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [nodeCount, setNodeCount] = useState<number | null>(null);
  const loadedNeighborhoods = useRef(new Set<string>());

  useEffect(() => {
    fetch('/api/brain/overview')
      .then((r) => {
        if (!r.ok) throw new Error('Brain overview failed');
        return r.json();
      })
      .then((g: BrainGraph) => {
        setNodeCount(g.nodes.length);
        canvas.current?.setGraph(g);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  const refreshNeighborhood = useCallback(async (id: string) => {
    const g: BrainGraph = await fetch(`/api/brain/neighborhood/${encodeURIComponent(id)}`).then((r) => r.json());
    canvas.current?.mergeGraph(g, id);
    loadedNeighborhoods.current.add(id);
  }, []);

  const handleSelect = useCallback((node: BrainNode) => {
    setSelected(node);
    canvas.current?.focus(node.id);
    setTrail((t) => (t[t.length - 1]?.id === node.id ? t : [...t.slice(-7), node]));
    if (!loadedNeighborhoods.current.has(node.id)) void refreshNeighborhood(node.id);
  }, [refreshNeighborhood]);

  const handleClear = useCallback(() => {
    setSelected(null);
    canvas.current?.focus(null);
  }, []);

  const handleBack = useCallback(() => {
    setTrail((t) => {
      const next = t.slice(0, -1);
      const prev = next[next.length - 1];
      if (prev) { canvas.current?.flyTo(prev.id); setSelected(prev); }
      else handleClear();
      return next;
    });
  }, [handleClear]);

  const setLens = (l: Lens) => { setLensState(l); canvas.current?.setLens(l); };

  const handleProspectAdded = useCallback(async (id: string) => {
    await refreshNeighborhood(id);
    canvas.current?.flyTo(id);
  }, [refreshNeighborhood]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0c0c15]">
      <BrainCanvas ref={canvas} onSelectNode={handleSelect} onClearFocus={handleClear} />

      {trail.length > 0 && (
        <div className="absolute left-4 top-4 flex max-w-[38%] items-center gap-1 overflow-hidden rounded-lg border border-border/50 bg-background/80 px-3 py-1.5 text-xs backdrop-blur">
          {trail.length > LABEL.trailMax && <span className="text-muted-foreground">…</span>}
          {trail.slice(-LABEL.trailMax).map((n, i) => (
            <span key={`${n.id}-${i}`} className="flex items-center gap-1 whitespace-nowrap">
              {(i > 0 || trail.length > LABEL.trailMax) && <span className="text-muted-foreground">›</span>}
              <button
                className={i === Math.min(trail.length, LABEL.trailMax) - 1 ? 'font-semibold' : 'text-muted-foreground hover:text-foreground'}
                onClick={(e) => { e.currentTarget.blur(); canvas.current?.flyTo(n.id); setSelected(n); }}
                title={n.label}
              >
                {n.label.length > LABEL.trailStub ? n.label.slice(0, LABEL.trailStub - 1) + '\u2026' : n.label}
              </button>
            </span>
          ))}
          <button
            className="ml-2 shrink-0 text-primary hover:underline"
            onClick={(e) => { e.currentTarget.blur(); handleBack(); }}
          >
            ← back
          </button>
        </div>
      )}

      <div className="absolute right-4 top-4 flex gap-1.5">
        {LENSES.map((l) => (
          <button
            key={l}
            onClick={() => setLens(l)}
            className={`rounded-full border px-3 py-1 font-mono text-[11px] backdrop-blur transition-colors ${
              lens === l
                ? 'border-primary/60 bg-primary/15 text-foreground'
                : 'border-border/50 bg-background/70 text-muted-foreground hover:text-foreground'
            }`}
          >
            {LENS_LABEL[l]}
          </button>
        ))}
      </div>

      <CommandBar
        onPick={(id) => { canvas.current?.flyTo(id); }}
        onProspectAdded={handleProspectAdded}
      />

      <div className="absolute bottom-4 left-4 hidden max-w-[calc(100%-2rem)] flex-wrap gap-x-3 gap-y-1 rounded-lg border border-border/50 bg-background/80 px-3 py-2 text-[10px] text-muted-foreground backdrop-blur sm:flex">
        {LEGEND.map((item) => (
          <span className="inline-flex items-center gap-1.5" key={item.label}>
            <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>

      {selected && (
        <Inspector
          node={selected}
          onClose={handleClear}
          onPulse={(id) => canvas.current?.setPulse(id)}
          onDone={(id) => { void refreshNeighborhood(id); }}
        />
      )}

      {loading && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          Loading workspace knowledge…
        </div>
      )}
      {!loading && loadError && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div><p className="text-sm font-medium">The Brain could not load</p><p className="mt-1 text-xs text-muted-foreground">Refresh to try again.</p></div>
        </div>
      )}
      {!loading && !loadError && nodeCount === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div><p className="text-sm font-medium">The Brain is empty</p><p className="mt-1 text-xs text-muted-foreground">Add projects, research, topics, or prospects to build your knowledge map.</p></div>
        </div>
      )}
    </div>
  );
}
