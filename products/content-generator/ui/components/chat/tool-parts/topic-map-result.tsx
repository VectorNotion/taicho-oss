'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BrainCircuit, Crosshair, Database, Network } from 'lucide-react';
import { BrainCanvas, type BrainCanvasHandle } from '@/packages/atlas/components/BrainCanvas';
import type { BrainGraph, BrainNode } from '@/packages/atlas/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface TopicMapResultProps {
  data: {
    query?: string | null;
    focusId?: string | null;
    focusLabel?: string | null;
    graph?: BrainGraph;
  };
}

const EMPTY_GRAPH: BrainGraph = { nodes: [], links: [] };

const TYPE_LABEL: Record<BrainNode['type'], string> = {
  project: 'Project', capability: 'Capability', topic: 'Topic', idea: 'Idea', draft: 'Draft',
  'research-item': 'Research', source: 'Source', prospect: 'Prospect', 'prospect-research': 'Prospect research',
  qualification: 'Qualification', persona: 'Persona', agent: 'Agent',
};

export function TopicMapResult({ data }: TopicMapResultProps) {
  const graph = useMemo(() => data.graph ?? EMPTY_GRAPH, [data.graph]);
  const canvas = useRef<BrainCanvasHandle>(null);
  const initial = graph.nodes.find((node) => node.id === data.focusId) ?? graph.nodes[0] ?? null;
  const [selected, setSelected] = useState<BrainNode | null>(initial);
  const byId = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      canvas.current?.setGraph(graph);
      if (data.focusId) canvas.current?.focus(data.focusId);
    }, 40);
    return () => window.clearTimeout(timer);
  }, [data.focusId, graph]);

  if (graph.nodes.length === 0) {
    return <div className="my-3 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No connected Brain nodes were found for this request.</div>;
  }

  const connected = selected
    ? graph.links
      .filter((link) => link.a === selected.id || link.b === selected.id)
      .map((link) => ({ link, node: byId.get(link.a === selected.id ? link.b : link.a) }))
      .filter((entry) => entry.node)
    : [];

  return (
    <div className="my-3 overflow-hidden rounded-2xl border bg-[#0c0c15] text-white animate-in fade-in zoom-in-95 duration-500" data-component="DATA-05 Topic Map" data-testid="chat-topic-map">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-black/20 px-4 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-300/10 text-amber-300"><Network className="size-4" /></span>
        <div className="min-w-0 flex-1"><p className="text-sm font-medium">{data.focusLabel ?? data.query ?? 'Workspace Brain'}</p><p className="mt-0.5 text-[10px] text-white/45">Interactive D3 force graph · evidence-backed relationships</p></div>
        <Badge variant="outline">{graph.nodes.length} nodes</Badge><Badge variant="outline">{graph.links.length} links</Badge>
      </div>
      <div className="grid md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="relative h-[350px] min-w-0" role="application" aria-label="Interactive Brain graph. Scroll to zoom, drag to pan, and select a node to inspect evidence.">
          <BrainCanvas onClearFocus={() => setSelected(initial)} onSelectNode={setSelected} ref={canvas} />
          <div className="pointer-events-none absolute bottom-3 left-3 flex gap-1.5 text-[9px] text-white/50"><span className="rounded bg-black/60 px-2 py-1">Zoom</span><span className="rounded bg-black/60 px-2 py-1">Pan</span><span className="rounded bg-black/60 px-2 py-1">Select</span></div>
          {data.focusId && <Button className="absolute right-3 top-3 border-white/15 bg-black/50 text-white hover:bg-black/70" onClick={() => canvas.current?.flyTo(data.focusId!)} size="sm" variant="outline"><Crosshair className="size-3.5" /> Focus</Button>}
        </div>
        <aside className="border-t border-white/10 bg-black/20 p-4 md:border-l md:border-t-0">
          {selected ? <>
            <div className="flex items-center justify-between gap-2"><Badge variant="outline">{TYPE_LABEL[selected.type]}</Badge><span className="text-[9px] text-white/40">{connected.length} connections</span></div>
            <h4 className="mt-3 text-sm font-semibold">{selected.label}</h4>
            <div className="mt-3 space-y-2 border-t border-white/10 pt-3">{Object.entries(selected.meta).filter(([, value]) => value !== null && value !== '').slice(0, 4).map(([key, value]) => <div className="flex items-start justify-between gap-2 text-[10px]" key={key}><span className="capitalize text-white/40">{key.replace(/([A-Z])/g, ' $1')}</span><span className="text-right text-white/75">{String(value)}</span></div>)}</div>
            <div className="mt-4 border-t border-white/10 pt-3"><p className="flex items-center gap-2 text-[10px] font-medium"><Database className="size-3 text-primary" />Connected evidence</p><div className="mt-2 space-y-1.5">{connected.slice(0, 4).map(({ link, node }) => <button className="flex w-full items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-left text-[10px] hover:bg-white/10" key={`${link.a}-${link.b}`} onClick={() => { setSelected(node!); canvas.current?.flyTo(node!.id); }} type="button"><BrainCircuit className="size-3 shrink-0 text-amber-300" /><span className="min-w-0 flex-1 truncate">{node!.label}</span></button>)}</div></div>
          </> : <p className="text-xs text-white/50">Select a node to inspect its context.</p>}
        </aside>
      </div>
    </div>
  );
}
