'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCapabilityStream } from '@content-automation/ui/hooks/use-capability-stream';
import type { BrainNode } from '../types';
import { TYPE_COLOR, TYPE_WORD } from '../palette';

const DRAFT_TYPES = [
  ['blog_post', 'Blog post'], ['tweet_thread', 'Tweet thread'],
  ['linkedin_post', 'LinkedIn post'], ['video_script', 'Video script'],
] as const;

/** `api` is a stream-capability rest path under /api/v1, without /stream. */
type StreamAction = { label: string; api: string; body?: Record<string, unknown> };

function actionsFor(node: BrainNode): { streams: StreamAction[]; open: string | null } {
  switch (node.type) {
    case 'project':
      return {
        streams: [{ label: 'Re-extract capabilities', api: `/content/projects/${node.id}/ingest` }],
        open: `/content/projects/${node.id}`,
      };
    case 'topic':
      return {
        streams: [{ label: 'Generate ideas', api: '/content/ideas/generate', body: { count: 5 } }],
        open: '/content/topics',
      };
    case 'idea':
      return {
        streams: node.meta.status === 'refined'
          ? []
          : [{ label: 'Refine', api: `/content/ideas/${node.id}/refine` }],
        open: `/content/${node.id}`,
      };
    case 'prospect':
      return {
        streams: [{ label: 'Re-score fit', api: `/outreach/prospects/${node.id}/qualify` }],
        open: `/outreach/pipeline/${node.id}`,
      };
    case 'draft':
      return {
        streams: [],
        open: node.meta.ideaId
          ? `/content/${node.meta.ideaId}/posts/${node.id}`
          : `/content/drafts/${node.id}`,
      };
    case 'persona':
      return { streams: [], open: '/personas' };
    default:
      return { streams: [], open: null };
  }
}

function subtitle(node: BrainNode): string {
  const m = node.meta;
  switch (node.type) {
    case 'prospect': return [m.title, m.company && `@ ${m.company}`, m.status].filter(Boolean).join(' · ');
    case 'idea': return [m.status, m.priority && `${m.priority} priority`].filter(Boolean).join(' · ');
    case 'draft': return [m.type, m.status].filter(Boolean).join(' · ');
    case 'topic': return String(m.status ?? '');
    case 'project': return m.processed === 'true' ? 'processed' : 'not processed yet';
    case 'qualification': return m.matchedPersonaName ? `matched ${m.matchedPersonaName}` : '';
    default: return '';
  }
}

/** Inner card keyed by node+action so useCapabilityStream binds a fresh capability per run. */
function InspectorCard({ node, onDone, onPulse, onClose }: {
  node: BrainNode;
  onDone: (id: string) => void;
  onPulse: (id: string | null) => void;
  onClose: () => void;
}) {
  const { streams, open } = useMemo(() => actionsFor(node), [node]);
  const [active, setActive] = useState<StreamAction | null>(null);

  const color = TYPE_COLOR[node.type];
  return (
    <div className="absolute right-4 top-16 w-72 rounded-xl border border-border/60 bg-background/90 p-4 backdrop-blur">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color }}>
          {TYPE_WORD[node.type]}
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
      </div>
      <div className="mb-1 text-[15px] font-semibold leading-snug">{node.label}</div>
      <div className="mb-3 text-xs text-muted-foreground">{subtitle(node)}</div>

      {node.type === 'qualification' && node.meta.score !== null && (
        <div className="mb-3 text-2xl font-bold tabular-nums">
          {node.meta.score}<span className="text-sm text-muted-foreground">/100</span>
        </div>
      )}

      {active ? (
        <RunningAction
          key={`${node.id}:${active.api}`}
          action={active}
          nodeId={node.id}
          onPulse={onPulse}
          onDone={(id) => { onDone(id); setActive(null); }}
          onCancel={() => setActive(null)}
        />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {streams.map((a) => (
            <button
              key={a.label}
              onClick={() => setActive(a)}
              className="rounded-lg border border-primary/50 bg-primary/15 px-3 py-1.5 text-xs hover:bg-primary/25"
            >
              {a.label}
            </button>
          ))}
          {node.type === 'idea' && node.meta.status === 'refined' && (
            <select
              className="rounded-lg border border-primary/50 bg-primary/15 px-2 py-1.5 text-xs"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  setActive({
                    label: 'Post',
                    api: `/content/ideas/${node.id}/draft`,
                    body: { contentType: e.target.value },
                  });
                }
              }}
            >
              <option value="" disabled>Post as…</option>
              {DRAFT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
          {open && (
            <a href={open} className="rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs hover:bg-muted/70">
              Open
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** Mounted only while an action runs — fires once on mount. */
function RunningAction({ action, nodeId, onPulse, onDone, onCancel }: {
  action: StreamAction;
  nodeId: string;
  onPulse: (id: string | null) => void;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const stream = useCapabilityStream({ api: action.api });

  useEffect(() => {
    stream.start(action.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire exactly once on mount
  }, []);
  useEffect(() => {
    onPulse(stream.isStreaming ? nodeId : null);
    return () => onPulse(null);
  }, [stream.isStreaming, nodeId, onPulse]);
  useEffect(() => {
    if (stream.final) onDone(nodeId);
  }, [stream.final, nodeId, onDone]);

  return (
    <div>
      <div className="mb-2 truncate rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
        {stream.error
          ? stream.error
          : stream.reasoning
            ? stream.reasoning.slice(-90)
            : `${action.label} — working…`}
      </div>
      {stream.error && (
        <button onClick={onCancel} className="rounded-lg border border-border px-3 py-1.5 text-xs">
          Dismiss
        </button>
      )}
    </div>
  );
}

export function Inspector(props: {
  node: BrainNode;
  onDone: (id: string) => void;
  onPulse: (id: string | null) => void;
  onClose: () => void;
}) {
  return <InspectorCard key={props.node.id} {...props} />;
}
