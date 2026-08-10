'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Database, Network, Sparkles } from 'lucide-react';
import { BrainCanvas, type BrainCanvasHandle } from '@/packages/atlas/components/BrainCanvas';
import type { BrainGraph, BrainNode } from '@/packages/atlas/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const createdAt = '2026-07-22T00:00:00.000Z';

const NODES: BrainNode[] = [
  { id: 'topic-ai-ops', label: 'AI operations', type: 'topic', degree: 8, createdAt, meta: { coverage: 'Strong', evidenceCount: 23, freshness: 'Today', summary: 'Operating AI systems reliably with observable, controlled workflows.' } },
  { id: 'topic-reliability', label: 'Reliability', type: 'topic', degree: 5, createdAt, meta: { coverage: 'Strong', evidenceCount: 12, freshness: '2 days', relationship: 'Core operational requirement' } },
  { id: 'topic-approvals', label: 'Human approvals', type: 'topic', degree: 4, createdAt, meta: { coverage: 'Strong', evidenceCount: 8, freshness: 'Today', relationship: 'Controls consequential actions' } },
  { id: 'topic-observability', label: 'Observability', type: 'topic', degree: 4, createdAt, meta: { coverage: 'Growing', evidenceCount: 6, freshness: '4 days', relationship: 'Makes agent work inspectable' } },
  { id: 'topic-governance', label: 'Automation governance', type: 'topic', degree: 3, createdAt, meta: { coverage: 'Growing', evidenceCount: 5, freshness: '6 days', relationship: 'Defines policies and boundaries' } },
  { id: 'topic-recovery', label: 'Failure recovery', type: 'topic', degree: 2, createdAt, meta: { coverage: 'Gap', evidenceCount: 2, freshness: '18 days', relationship: 'Needs additional research' } },
  { id: 'research-approval', label: 'Approval gates in agent workflows', type: 'research-item', degree: 2, createdAt, meta: { source: 'Internal research', published: 'Today', priority: 'High', supports: 'Human approvals' } },
  { id: 'research-benchmarks', label: 'Operational reliability benchmarks', type: 'research-item', degree: 2, createdAt, meta: { source: 'Industry report', published: '2 days ago', priority: 'High', supports: 'Reliability' } },
  { id: 'research-observability', label: 'Tracing autonomous work', type: 'research-item', degree: 2, createdAt, meta: { source: 'Engineering analysis', published: '4 days ago', priority: 'Medium', supports: 'Observability' } },
  { id: 'project-taicho', label: 'Taicho runtime', type: 'project', degree: 3, createdAt, meta: { status: 'Active', relationship: 'Implements event-driven orchestration', proofCount: 4 } },
  { id: 'cap-event-stream', label: 'Semantic event stream', type: 'capability', degree: 3, createdAt, meta: { status: 'Specified', relationship: 'Drives generative UI state' } },
  { id: 'source-operator-survey', label: 'AI operator survey', type: 'source', degree: 1, createdAt, meta: { publisher: 'Operator study', freshness: '6 days', url: 'Source available' } },
];

const LINKS: BrainGraph['links'] = [
  { a: 'topic-ai-ops', b: 'topic-reliability', kind: 'REQUIRES' },
  { a: 'topic-ai-ops', b: 'topic-approvals', kind: 'CONTROLLED_BY' },
  { a: 'topic-ai-ops', b: 'topic-observability', kind: 'MEASURED_BY' },
  { a: 'topic-ai-ops', b: 'topic-governance', kind: 'GOVERNED_BY' },
  { a: 'topic-ai-ops', b: 'topic-recovery', kind: 'RECOVERS_WITH' },
  { a: 'topic-reliability', b: 'research-benchmarks', kind: 'SUPPORTED_BY' },
  { a: 'topic-approvals', b: 'research-approval', kind: 'SUPPORTED_BY' },
  { a: 'topic-observability', b: 'research-observability', kind: 'SUPPORTED_BY' },
  { a: 'topic-governance', b: 'source-operator-survey', kind: 'INFORMED_BY' },
  { a: 'topic-ai-ops', b: 'project-taicho', kind: 'IMPLEMENTED_IN' },
  { a: 'project-taicho', b: 'cap-event-stream', kind: 'USES' },
  { a: 'cap-event-stream', b: 'topic-observability', kind: 'ENABLES' },
];

const graph = (nodeIds: string[], links: BrainGraph['links']): BrainGraph => {
  const ids = new Set(nodeIds);
  return { nodes: NODES.filter((node) => ids.has(node.id)), links: links.filter((link) => ids.has(link.a) && ids.has(link.b)) };
};

const batch = (nodeIds: string[]): BrainGraph => {
  const ids = new Set(nodeIds);
  return {
    nodes: NODES.filter((node) => ids.has(node.id)),
    links: LINKS.filter((link) => ids.has(link.a) || ids.has(link.b)),
  };
};

const BASE = graph(['topic-ai-ops', 'topic-reliability', 'topic-approvals'], LINKS);
const TOPIC_BATCH = batch(['topic-observability', 'topic-governance', 'topic-recovery']);
const EVIDENCE_BATCH = batch(['research-approval', 'research-benchmarks', 'research-observability']);
const CONTEXT_BATCH = batch(['project-taicho', 'cap-event-stream', 'source-operator-survey']);
const FULL: BrainGraph = { nodes: NODES, links: LINKS };

const TYPE_LABEL: Record<BrainNode['type'], string> = {
  project: 'Project', capability: 'Capability', topic: 'Topic', idea: 'Idea', draft: 'Draft',
  'research-item': 'Research', source: 'Source', prospect: 'Prospect', 'prospect-research': 'Prospect research',
  qualification: 'Qualification', persona: 'Persona', agent: 'Agent',
};

export function TopicMapPreview({ active }: { active: boolean }) {
  const canvasRef = useRef<BrainCanvasHandle>(null);
  const [selected, setSelected] = useState<BrainNode>(NODES[0]);
  const [visibleCount, setVisibleCount] = useState(active ? BASE.nodes.length : FULL.nodes.length);
  const [visibleLinkCount, setVisibleLinkCount] = useState(active ? BASE.links.length : FULL.links.length);
  const nodeById = useMemo(() => new Map(NODES.map((node) => [node.id, node])), []);

  useEffect(() => {
    const timers: number[] = [];
    const schedule = (callback: () => void, delay: number) => {
      timers.push(window.setTimeout(callback, delay));
    };

    schedule(() => {
      setSelected(NODES[0]);
      if (!active) {
        canvasRef.current?.setGraph(FULL);
        canvasRef.current?.focus(null);
        setVisibleCount(FULL.nodes.length);
        setVisibleLinkCount(FULL.links.length);
        return;
      }
      canvasRef.current?.setGraph(BASE);
      canvasRef.current?.focus(null);
      setVisibleCount(BASE.nodes.length);
      setVisibleLinkCount(BASE.links.length);
      schedule(() => { canvasRef.current?.mergeGraph(TOPIC_BATCH, 'topic-ai-ops'); setVisibleCount(6); setVisibleLinkCount(5); }, 450);
      schedule(() => { canvasRef.current?.mergeGraph(EVIDENCE_BATCH, 'topic-ai-ops'); setVisibleCount(9); setVisibleLinkCount(8); }, 950);
      schedule(() => { canvasRef.current?.mergeGraph(CONTEXT_BATCH, 'topic-ai-ops'); setVisibleCount(FULL.nodes.length); setVisibleLinkCount(FULL.links.length); }, 1_450);
    }, 60);

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [active]);

  const selectedLinks = LINKS.filter((link) => link.a === selected.id || link.b === selected.id);

  return (
    <div className="overflow-hidden rounded-xl border bg-[#0c0c15]" data-testid="d3-topic-map">
      <div className="flex flex-col gap-3 border-b border-white/10 bg-black/20 px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-300/10 text-amber-300"><Network className="size-4" /></span>
          <div className="min-w-0"><p className="text-sm font-medium text-white">AI operations coverage</p><p className="text-[11px] text-white/50">D3 force graph · evidence-backed relationships</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Badge variant="outline">{visibleCount} nodes</Badge>
          <Badge variant="outline">{visibleLinkCount} relationships</Badge>
          <Badge variant={active ? 'secondary' : 'outline'}>{active ? 'Streaming graph' : 'Graph complete'}</Badge>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="relative h-[430px] min-w-0" role="application" aria-label="Interactive topic coverage graph. Scroll to zoom, drag empty space to pan, drag nodes to reposition, and select a node for evidence.">
          <BrainCanvas onClearFocus={() => setSelected(NODES[0])} onSelectNode={setSelected} ref={canvasRef} />
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2 text-[10px] text-white/55">
            <span className="rounded bg-black/55 px-2 py-1">Scroll to zoom</span><span className="rounded bg-black/55 px-2 py-1">Drag to pan</span><span className="rounded bg-black/55 px-2 py-1">Click for evidence</span>
          </div>
          <div className="absolute right-3 top-3"><Button className="border-white/15 bg-black/45 text-white hover:bg-black/70" onClick={() => canvasRef.current?.flyTo('topic-ai-ops')} size="sm" variant="outline"><Crosshair className="size-3.5" /> Focus topic</Button></div>
        </div>

        <aside className="border-t border-white/10 bg-black/20 p-4 text-white lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between gap-2"><Badge variant="outline">{TYPE_LABEL[selected.type]}</Badge><span className="text-[10px] text-white/45">{selected.degree} connections</span></div>
          <h4 className="mt-3 text-base font-semibold">{selected.label}</h4>
          <p className="mt-2 text-xs leading-5 text-white/55">{String(selected.meta.summary ?? selected.meta.relationship ?? 'Evidence connected to the selected topic.')}</p>
          <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
            {Object.entries(selected.meta).filter(([key]) => key !== 'summary' && key !== 'relationship').slice(0, 5).map(([key, value]) => (
              <div className="flex items-start justify-between gap-3 text-xs" key={key}><span className="capitalize text-white/45">{key.replace(/([A-Z])/g, ' $1')}</span><span className="text-right text-white/80">{String(value)}</span></div>
            ))}
          </div>
          <div className="mt-4 border-t border-white/10 pt-4">
            <div className="flex items-center gap-2 text-xs font-medium"><Database className="size-3.5 text-primary" /> Connected evidence</div>
            <div className="mt-2 space-y-1.5">
              {selectedLinks.slice(0, 4).map((link) => {
                const otherId = link.a === selected.id ? link.b : link.a;
                const other = nodeById.get(otherId);
                return <button className="flex w-full items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-2 text-left text-[11px] transition-colors hover:bg-white/10" key={`${link.a}-${link.b}`} onClick={() => { if (other) { setSelected(other); canvasRef.current?.flyTo(other.id); } }} type="button"><Sparkles className="size-3 shrink-0 text-amber-300" /><span className="min-w-0 flex-1 truncate">{other?.label}</span><span className="text-[9px] text-white/35">{link.kind.replaceAll('_', ' ')}</span></button>;
              })}
            </div>
          </div>
        </aside>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 bg-black/20 px-4 py-2.5 text-[10px] text-white/50">
        <span><i className="mr-1.5 inline-block size-2 rounded-full bg-[#d9a15c]" />Topics & research</span>
        <span><i className="mr-1.5 inline-block size-2 rounded-full bg-[#8b7cf7]" />Projects</span>
        <span><i className="mr-1.5 inline-block size-2 rounded-full bg-[#5fd4d0]" />Capabilities</span>
        <span className="ml-auto">Node size = connectivity · ring = source · selection = evidence neighborhood</span>
      </div>

      <ul className="sr-only">{NODES.map((node) => <li key={node.id}>{TYPE_LABEL[node.type]}: {node.label}</li>)}</ul>
    </div>
  );
}
