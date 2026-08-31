'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiMutate } from '@content-automation/platform/network/api-client';
import type { BrainSearchResult } from '../types';
import { TYPE_COLOR } from '../palette';

/** Parse "+ Name[, Title][ @ Company]" → prospect fields. */
export function parseAddProspect(input: string): { name: string; title?: string; company?: string } | null {
  const m = input.replace(/^\+\s*/, '').trim();
  if (!m) return null;
  if ((m.match(/@/g) ?? []).length > 1 || (m.match(/,/g) ?? []).length > 1) return null;
  const [beforeAt, company] = m.split('@').map((s) => s.trim());
  const [name, title] = beforeAt.split(',').map((s) => s.trim());
  if (!name || (m.includes(',') && !title) || (m.includes('@') && !company)) return null;
  return { name, title: title || undefined, company: company || undefined };
}

export function CommandBar({ onPick, onProspectAdded, disabled = false }: {
  onPick: (id: string) => void | Promise<void>;
  onProspectAdded: (input: { prospectId: string; brainNodeId: string | null }) => void | Promise<void>;
  disabled?: boolean;
}) {
  const [openBar, setOpenBar] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<BrainSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [retry, setRetry] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isAdd = q.startsWith('+');

  const close = useCallback(() => {
    setOpenBar(false);
    setQ('');
    setResults([]);
    setSearchState('idle');
    setActionError(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (!disabled) { setOpenBar(true); setTimeout(() => inputRef.current?.focus(), 0); }
      }
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, disabled]);

  useEffect(() => {
    const query = q.trim();
    setActionError(null);
    if (disabled || isAdd || query.length < 2) {
      setResults([]);
      setSearchState('idle');
      return;
    }
    const controller = new AbortController();
    setResults([]);
    setSearchState('loading');
    const t = setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/brain/search?query=${encodeURIComponent(query)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Brain search failed');
        const payload = await response.json() as { data?: { results?: BrainSearchResult[] } };
        setResults(payload.data?.results ?? []);
        setSearchState('ready');
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') return;
        setResults([]);
        setSearchState('error');
      }
    }, 180);
    return () => { clearTimeout(t); controller.abort(); };
  }, [disabled, isAdd, q, retry]);

  const submitPick = useCallback(async (id: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await onPick(id);
      close();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'That result could not be opened. Try again.');
    } finally {
      setBusy(false);
    }
  }, [close, onPick]);

  const submitAdd = useCallback(async () => {
    const prospect = parseAddProspect(q);
    if (!prospect) return;
    setBusy(true);
    setActionError(null);
    let created: { id?: string } | undefined;
    let brainNodeId: string | null = null;
    try {
      // Contract: outreach.prospect.create capability (POST /api/v1/outreach/prospects) —
      // requires name + source and returns both product and canonical graph IDs.
      const { data } = await apiMutate<{
        prospect: { id?: string };
        brainNodeId: string | null;
        knowledgeStatus: 'projected' | 'pending';
      }>(
        'POST',
        '/outreach/prospects',
        { ...prospect, source: 'manual', triggerResearch: true },
      );
      created = data.prospect;
      brainNodeId = data.brainNodeId;
    } catch {
      setActionError('The prospect could not be added. Your input is still here; try again.');
      setBusy(false);
      return;
    }
    if (!created?.id) {
      setActionError('The prospect was added, but its record identity was not returned. Open the pipeline to confirm it.');
      setBusy(false);
      return;
    }
    const prospectId = String(created.id);
    close();
    try {
      await onProspectAdded({ prospectId, brainNodeId });
    } catch {
      window.location.assign(`/outreach/prospects/${encodeURIComponent(prospectId)}`);
    } finally {
      setBusy(false);
    }
  }, [close, q, onProspectAdded]);

  if (!openBar) {
    return (
      <button
        aria-expanded="false"
        disabled={disabled}
        onClick={() => { setOpenBar(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        className="absolute left-1/2 top-4 -translate-x-1/2 rounded-lg border border-border/50 bg-background/80 px-4 py-1.5 text-xs text-muted-foreground backdrop-blur hover:text-foreground disabled:cursor-wait disabled:opacity-70"
      >
        {disabled ? 'Loading workspace knowledge…' : '⌘K — find anything · “+ name” to add a prospect'}
      </button>
    );
  }

  return (
    <div role="dialog" aria-label="Find workspace knowledge" className="absolute left-1/2 top-4 z-10 w-[420px] max-w-[90%] -translate-x-1/2 rounded-xl border border-border/60 bg-background/95 p-2 backdrop-blur">
      <input
        ref={inputRef}
        value={q}
        aria-label="Find workspace knowledge"
        aria-busy={searchState === 'loading' || busy}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (isAdd) void submitAdd();
            else if (results[0]) void submitPick(results[0].id);
          }
        }}
        disabled={busy}
        placeholder="Find anything… or “+ Sarah Chen, CTO @ Linear”"
        className="w-full bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
      />
      {isAdd && (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          {busy ? 'adding — the brain will research them…' : (() => {
            const p = parseAddProspect(q);
            return p
              ? `↵ add ${p.name}${p.title ? `, ${p.title}` : ''}${p.company ? ` @ ${p.company}` : ''}`
              : q.replace(/^\+\s*/, '').trim()
                ? 'Use “+ Name, Title @ Company”. Keep commas and @ to one each.'
                : 'type a name';
          })()}
        </div>
      )}
      {!isAdd && results.length > 0 && (
        <ul className="max-h-64 overflow-y-auto">
          {results.map((r) => (
            <li key={r.id}>
              <button
                disabled={busy}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
                onClick={() => { void submitPick(r.id); }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLOR[r.type] }} />
                <span>{r.label}</span>
                <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">{r.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!isAdd && searchState === 'loading' && (
        <div role="status" className="px-2 py-2 text-xs text-muted-foreground">Searching workspace knowledge…</div>
      )}
      {!isAdd && searchState === 'ready' && results.length === 0 && (
        <div role="status" className="px-2 py-2 text-xs text-muted-foreground">No results for “{q.trim()}”. Try another name or phrase.</div>
      )}
      {!isAdd && searchState === 'error' && (
        <div role="alert" className="flex items-center justify-between gap-3 px-2 py-2 text-xs text-amber-100">
          <span>Search is unavailable. Your query is still here.</span>
          <button className="shrink-0 text-primary hover:underline" onClick={() => setRetry((value) => value + 1)}>Retry search</button>
        </div>
      )}
      {actionError && <div role="alert" className="px-2 py-2 text-xs text-amber-100">{actionError}</div>}
    </div>
  );
}
