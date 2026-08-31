'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCapabilityStream } from '@content-automation/ui/hooks/use-capability-stream';
import type { BrainNode, BrainProof } from '../types';
import { TYPE_COLOR, TYPE_WORD } from '../palette';

const DRAFT_TYPES = [
  ['blog_post', 'Blog post'], ['tweet_thread', 'Tweet thread'],
  ['linkedin_post', 'LinkedIn post'], ['video_script', 'Video script'],
] as const;

/** `api` is a stream-capability rest path under /api/v1, without /stream. */
type StreamAction = { label: string; api: string; body?: Record<string, unknown> };

export function actionsFor(node: BrainNode): { streams: StreamAction[]; open: string | null } {
  const productId = String(node.meta.productId ?? node.id);
  switch (node.type) {
    case 'project':
      return {
        streams: [{ label: 'Re-extract capabilities', api: `/content/projects/${productId}/ingest` }],
        open: `/content/projects/${productId}`,
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
          : [{ label: 'Refine', api: `/content/ideas/${productId}/refine` }],
        open: `/content/${productId}`,
      };
    case 'prospect':
      return {
        streams: [{ label: 'Re-score fit', api: `/outreach/prospects/${productId}/qualify` }],
        open: `/outreach/prospects/${productId}`,
      };
    case 'draft':
      return {
        streams: [],
        open: node.meta.ideaId
          ? `/content/${node.meta.ideaId}/posts/${productId}`
          : `/content/drafts/${productId}`,
      };
    case 'research-item':
      return { streams: [], open: '/content/research' };
    case 'persona':
      return { streams: [], open: '/personas' };
    case 'source':
    case 'evidence':
      return { streams: [], open: typeof node.meta.url === 'string' && /^https?:\/\//.test(node.meta.url) ? node.meta.url : null };
    default:
      return { streams: [], open: null };
  }
}

export function subtitle(node: BrainNode): string {
  const m = node.meta;
  switch (node.type) {
    case 'prospect': return [m.title, m.company && `@ ${m.company}`, m.status].filter(Boolean).join(' · ');
    case 'idea': return [m.status, m.priority && `${m.priority} priority`].filter(Boolean).join(' · ');
    case 'draft': return [m.type, m.status].filter(Boolean).join(' · ');
    case 'research-item': return [m.status, m.priority && `${m.priority} priority`].filter(Boolean).join(' · ');
    case 'topic': return String(m.status ?? '');
    case 'project': return m.processed === 'true' ? 'processed' : m.processed === 'false' ? 'not processed yet' : '';
    case 'qualification': return m.matchedPersonaName ? `matched ${m.matchedPersonaName}` : '';
    case 'fact': return [m.predicate, m.confidence !== null && `${Math.round(Number(m.confidence) * 100)}% confidence`].filter(Boolean).join(' · ');
    case 'source':
    case 'evidence': {
      try { return m.url ? new URL(String(m.url)).hostname.replace(/^www\./, '') : ''; } catch { return ''; }
    }
    default: return '';
  }
}

function ProofBlocks({ proofs }: { proofs: BrainProof[] }) {
  return (
    <div className="space-y-2">
      {proofs.map((proof) => {
        let domain = 'Original source';
        try { domain = new URL(proof.url).hostname.replace(/^www\./, ''); } catch { /* retain fallback */ }
        return (
          <div key={proof.id} className="rounded-lg border border-sky-400/25 bg-sky-400/[0.07] p-3">
            <blockquote className="text-[13px] leading-relaxed text-foreground/90">“{proof.excerpt}”</blockquote>
            <a
              href={proof.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex text-xs font-medium text-sky-300 hover:text-sky-200 hover:underline"
            >
              View original source · {domain} ↗
            </a>
          </div>
        );
      })}
    </div>
  );
}

function Proofs({ node }: { node: BrainNode }) {
  if (node.type !== 'fact' && node.type !== 'evidence') return null;
  const proofs = node.proofs ?? [];
  if (proofs.length === 0) {
    return (
      <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
        No source proof is attached to this claim.
      </div>
    );
  }
  return (
    <div className="mb-4 space-y-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Proof</div>
      <ProofBlocks proofs={proofs} />
    </div>
  );
}

function Knowledge({ node }: { node: BrainNode }) {
  if (!node.knowledge?.length) return null;
  return (
    <div className="mb-4 space-y-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Evidence-backed knowledge</div>
      {node.knowledge.map((item) => (
        <div key={item.id} className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="text-[13px] font-medium leading-relaxed">{item.statement}</div>
          <ProofBlocks proofs={item.proofs} />
        </div>
      ))}
    </div>
  );
}

/** Inner card keyed by node+action so useCapabilityStream binds a fresh capability per run. */
function InspectorCard({ node, onDone, onPulse, onClose }: {
  node: BrainNode;
  onDone: (id: string, result: Record<string, unknown>) => Promise<'linked' | 'missing' | null>;
  onPulse: (id: string | null) => void;
  onClose: () => void;
}) {
  const { streams, open } = useMemo(() => actionsFor(node), [node]);
  const [active, setActive] = useState<StreamAction | null>(null);
  const [completedAction, setCompletedAction] = useState<{
    label: string;
    relationship: 'linked' | 'missing' | null;
  } | null>(null);

  const color = TYPE_COLOR[node.type];
  return (
    <div className="absolute right-4 top-28 max-h-[calc(100vh-8rem)] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border/60 bg-background/90 p-4 backdrop-blur xl:top-16 xl:max-h-[calc(100vh-5rem)]">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color }}>
          {TYPE_WORD[node.type]}
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
      </div>
      <div className="mb-1 text-[15px] font-semibold leading-snug">{node.label}</div>
      <div className="mb-3 text-xs text-muted-foreground">{subtitle(node)}</div>

      <Proofs node={node} />
      <Knowledge node={node} />

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
          onDone={async (id, result) => {
            const relationship = await onDone(id, result);
            setCompletedAction({ label: active.label, relationship });
            setActive(null);
          }}
          onCancel={() => setActive(null)}
        />
      ) : (
        <div className="space-y-2">
          {completedAction?.relationship === 'missing' ? (
            <div role="alert" className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-2 text-xs text-amber-100">
              {completedAction.label} completed, but its artifact is not linked in the Brain. Open the product record to inspect it; do not rerun generation.
            </div>
          ) : completedAction ? (
            <div role="status" className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-2 text-xs text-emerald-100">
              {completedAction.label} completed. {completedAction.relationship === 'linked' ? 'Its artifact is linked in the refreshed Brain.' : 'The Brain has been refreshed.'}
            </div>
          ) : null}
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
                    api: `/content/ideas/${String(node.meta.productId ?? node.id)}/draft`,
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
          {streams.length === 0 && !open && node.type !== 'idea' && (
            <div className="text-xs text-muted-foreground">No actions are available for this node.</div>
          )}
          </div>
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
  onDone: (id: string, result: Record<string, unknown>) => void | Promise<void>;
  onCancel: () => void;
}) {
  const stream = useCapabilityStream({ api: action.api });
  const completed = useRef(false);

  useEffect(() => {
    stream.start(action.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire exactly once on mount
  }, []);
  useEffect(() => {
    onPulse(stream.isStreaming ? nodeId : null);
    return () => onPulse(null);
  }, [stream.isStreaming, nodeId, onPulse]);
  useEffect(() => {
    if (stream.final && !completed.current) {
      completed.current = true;
      void onDone(nodeId, stream.final as Record<string, unknown>);
    }
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
  onDone: (id: string, result: Record<string, unknown>) => Promise<'linked' | 'missing' | null>;
  onPulse: (id: string | null) => void;
  onClose: () => void;
}) {
  return <InspectorCard key={props.node.id} {...props} />;
}
