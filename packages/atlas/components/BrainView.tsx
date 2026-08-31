'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrainGraph, BrainNode } from '../types';
import { BrainCanvas, type BrainCanvasHandle } from './BrainCanvas';
import { Inspector } from './Inspector';
import { CommandBar } from './CommandBar';
import { LABEL } from '../physics/constants';

type Lens = 'everything' | 'content' | 'prospects' | 'recent';
type TrailMode = 'append' | 'truncate' | 'preserve';
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
  { label: 'Organizations & entities', color: '#8b7cf7' },
  { label: 'Claims', color: '#e6b566' },
  { label: 'Personas', color: '#e6e6f0' },
] as const;

async function loadNeighborhood(id: string): Promise<BrainGraph> {
  const response = await fetch(`/api/v1/brain/nodes/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('The node details could not be loaded. Try again.');
  const payload = await response.json() as { data?: { graph?: BrainGraph } };
  if (!payload.data?.graph) throw new Error('The node details returned an invalid response. Try again.');
  return payload.data.graph;
}

export function BrainView() {
  const canvas = useRef<BrainCanvasHandle>(null);
  const selectedRef = useRef<BrainNode | null>(null);
  const overviewRequest = useRef(0);
  const selectionRequest = useRef(0);
  const [selected, setSelected] = useState<BrainNode | null>(null);
  const [trail, setTrail] = useState<BrainNode[]>([]);
  const [lens, setLensState] = useState<Lens>('everything');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [nodeCount, setNodeCount] = useState<number | null>(null);

  const loadOverview = useCallback(async (): Promise<BrainGraph | null> => {
    const request = ++overviewRequest.current;
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetch('/api/v1/brain/overview', { cache: 'no-store' });
      if (!response.ok) throw new Error('Brain overview failed');
      const payload = await response.json() as { data?: { graph?: BrainGraph } };
      if (!payload.data?.graph) throw new Error('Brain overview returned an invalid response');
      if (request !== overviewRequest.current) return null;
      setNodeCount(payload.data.graph.nodes.length);
      canvas.current?.setGraph(payload.data.graph);
      return payload.data.graph;
    } catch {
      if (request === overviewRequest.current) setLoadError(true);
      return null;
    } finally {
      if (request === overviewRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  const commitSelection = useCallback((node: BrainNode, trailMode: TrailMode) => {
    selectedRef.current = node;
    setSelected(node);
    canvas.current?.focus(node.id);
    setTrail((current) => {
      if (trailMode === 'preserve') {
        return current.map((item) => item.id === node.id ? node : item);
      }
      if (trailMode === 'truncate') {
        const index = current.findIndex((item) => item.id === node.id);
        return index >= 0 ? [...current.slice(0, index), node] : [...current.slice(-7), node];
      }
      if (current[current.length - 1]?.id === node.id) {
        return current.map((item, index) => index === current.length - 1 ? node : item);
      }
      return [...current.slice(-7), node];
    });
  }, []);

  const removeUnavailable = useCallback((id: string) => {
    canvas.current?.remove(id);
    setTrail((current) => current.filter((node) => node.id !== id));
    if (selectedRef.current?.id === id) {
      selectedRef.current = null;
      setSelected(null);
      canvas.current?.focus(null);
    }
    setSelectionNotice('That node is no longer available. It was removed from this view.');
  }, []);

  const refreshNeighborhood = useCallback(async (id: string): Promise<BrainNode> => {
    const graph = await loadNeighborhood(id);
    const fresh = graph.nodes.find((node) => node.id === id);
    if (!fresh) {
      removeUnavailable(id);
      throw new Error('That node is no longer available. It was removed from this view.');
    }
    canvas.current?.mergeGraph(graph, id);
    setSelected((current) => {
      if (current?.id !== id) return current;
      selectedRef.current = fresh;
      return fresh;
    });
    setTrail((current) => current.map((node) => {
      const replacement = graph.nodes.find((candidate) => candidate.id === node.id);
      return replacement ?? node;
    }));
    return fresh;
  }, [removeUnavailable]);

  const selectNodeById = useCallback(async (
    id: string,
    optimisticNode?: BrainNode,
    trailMode: TrailMode = 'append',
  ) => {
    const request = ++selectionRequest.current;
    setSelectionBusy(true);
    setSelectionNotice(null);
    if (optimisticNode) commitSelection(optimisticNode, trailMode);
    try {
      const graph = await loadNeighborhood(id);
      if (request !== selectionRequest.current) return;
      const fresh = graph.nodes.find((node) => node.id === id);
      if (!fresh) {
        removeUnavailable(id);
        throw new Error('That node is no longer available. It was removed from this view.');
      }
      canvas.current?.mergeGraph(graph, id);
      canvas.current?.flyTo(id, false);
      commitSelection(fresh, trailMode);
    } catch (error) {
      if (request !== selectionRequest.current) return;
      const message = error instanceof Error ? error.message : 'The node details could not be loaded. Try again.';
      setSelectionNotice(message);
      throw new Error(message);
    } finally {
      if (request === selectionRequest.current) setSelectionBusy(false);
    }
  }, [commitSelection, removeUnavailable]);

  const handleSelect = useCallback((node: BrainNode) => {
    void selectNodeById(node.id, node).catch(() => undefined);
  }, [selectNodeById]);

  const handleClear = useCallback(() => {
    selectionRequest.current += 1;
    selectedRef.current = null;
    setSelected(null);
    setSelectionBusy(false);
    canvas.current?.focus(null);
  }, []);

  const handleBack = useCallback(() => {
    const next = trail.slice(0, -1);
    const previous = next[next.length - 1];
    setTrail(next);
    if (previous) void selectNodeById(previous.id, previous, 'preserve').catch(() => undefined);
    else handleClear();
  }, [handleClear, selectNodeById, trail]);

  const setLens = (nextLens: Lens) => {
    setLensState(nextLens);
    canvas.current?.setLens(nextLens);
  };

  const handleProspectAdded = useCallback(async ({ prospectId, brainNodeId }: { prospectId: string; brainNodeId: string | null }) => {
    if (!brainNodeId) {
      window.location.assign(`/outreach/prospects/${encodeURIComponent(prospectId)}`);
      return;
    }
    await loadOverview();
    await selectNodeById(brainNodeId);
  }, [loadOverview, selectNodeById]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0c0c15]">
      <BrainCanvas ref={canvas} onSelectNode={handleSelect} onClearFocus={handleClear} />

      {trail.length > 0 && (
        <div aria-label="Knowledge navigation trail" className="absolute left-4 top-16 flex max-w-[48%] items-center gap-1 overflow-hidden rounded-lg border border-border/50 bg-background/80 px-3 py-1.5 text-xs backdrop-blur xl:top-4 xl:max-w-[38%]">
          {trail.length > LABEL.trailMax && <span className="text-muted-foreground">…</span>}
          {trail.slice(-LABEL.trailMax).map((node, index) => (
            <span key={`${node.id}-${index}`} className="flex items-center gap-1 whitespace-nowrap">
              {(index > 0 || trail.length > LABEL.trailMax) && <span className="text-muted-foreground">›</span>}
              <button
                className={index === Math.min(trail.length, LABEL.trailMax) - 1 ? 'font-semibold' : 'text-muted-foreground hover:text-foreground'}
                onClick={(event) => {
                  event.currentTarget.blur();
                  void selectNodeById(node.id, undefined, 'truncate').catch(() => undefined);
                }}
                title={node.label}
              >
                {node.label.length > LABEL.trailStub ? node.label.slice(0, LABEL.trailStub - 1) + '\u2026' : node.label}
              </button>
            </span>
          ))}
          <button
            className="ml-2 shrink-0 text-primary hover:underline"
            onClick={(event) => { event.currentTarget.blur(); handleBack(); }}
          >
            ← back
          </button>
        </div>
      )}

      <div aria-label="Knowledge graph controls" className="absolute right-4 top-16 flex gap-1.5 xl:top-4">
        {LENSES.map((item) => (
          <button
            key={item}
            aria-pressed={lens === item}
            disabled={loading || loadError}
            onClick={() => setLens(item)}
            className={`rounded-full border px-3 py-1 font-mono text-[11px] backdrop-blur transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              lens === item
                ? 'border-primary/60 bg-primary/15 text-foreground'
                : 'border-border/50 bg-background/70 text-muted-foreground hover:text-foreground'
            }`}
          >
            {LENS_LABEL[item]}
          </button>
        ))}
        <a
          aria-label="Open Brain settings"
          className="grid size-7 shrink-0 place-items-center rounded-full border border-border/50 bg-background/70 text-muted-foreground backdrop-blur transition-colors hover:border-primary/40 hover:text-foreground"
          href="/ontology"
          title="Brain settings"
        >
          <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 24 24">
            <path
              d="M12 15.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Zm7.32-1.53.08-.22a7.5 7.5 0 0 0 0-3l-.08-.22 1.53-1.2-1.75-3.03-1.82.73-.18-.15a7.5 7.5 0 0 0-2.6-1.5l-.22-.08L14 3h-4l-.28 2.05-.22.08a7.5 7.5 0 0 0-2.6 1.5l-.18.15-1.82-.73-1.75 3.03 1.53 1.2-.08.22a7.5 7.5 0 0 0 0 3l.08.22-1.53 1.2 1.75 3.03 1.82-.73.18.15a7.5 7.5 0 0 0 2.6 1.5l.22.08L10 21h4l.28-2.05.22-.08a7.5 7.5 0 0 0 2.6-1.5l.18-.15 1.82.73 1.75-3.03-1.53-1.2Z"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
          </svg>
        </a>
      </div>

      <CommandBar
        disabled={loading || loadError}
        onPick={(id) => selectNodeById(id)}
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
          onDone={async (id, result) => {
            const graph = await loadOverview();
            await refreshNeighborhood(id).catch((error) => {
              setSelectionNotice(error instanceof Error ? error.message : 'The node details could not be loaded. Try again.');
            });
            const artifactId = typeof result?.draftId === 'string' ? result.draftId : null;
            if (!artifactId) return null;
            const artifact = graph?.nodes.find((node) => node.meta.productId === artifactId);
            if (!artifact) return 'missing';
            return graph?.links.some((link) => link.a === artifact.id || link.b === artifact.id)
              ? 'linked'
              : 'missing';
          }}
        />
      )}

      {selectionBusy && (
        <div role="status" className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-lg border border-border/60 bg-background/90 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
          Loading node details…
        </div>
      )}
      {selectionNotice && (
        <div role="alert" className="absolute bottom-16 left-1/2 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg border border-amber-500/30 bg-background/95 px-3 py-2 text-xs text-amber-100 backdrop-blur">
          <span>{selectionNotice}</span>
          <button className="shrink-0 text-primary hover:underline" onClick={() => setSelectionNotice(null)}>Dismiss</button>
        </div>
      )}

      {loading && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          Loading workspace knowledge…
        </div>
      )}
      {!loading && loadError && (
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-sm font-medium">The Brain could not load</p>
            <p className="mt-1 text-xs text-muted-foreground">The graph is unavailable. Retry when the connection recovers.</p>
            <button className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs hover:bg-muted/70" onClick={() => { void loadOverview(); }}>Retry</button>
          </div>
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
