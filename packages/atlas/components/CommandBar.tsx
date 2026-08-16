'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiMutate } from '@content-automation/platform/network/api-client';
import type { BrainSearchResult } from '../types';
import { TYPE_COLOR } from '../palette';

/** Parse "+ Name[, Title][ @ Company]" → prospect fields. */
export function parseAddProspect(input: string): { name: string; title?: string; company?: string } | null {
  const m = input.replace(/^\+\s*/, '').trim();
  if (!m) return null;
  const [beforeAt, company] = m.split('@').map((s) => s.trim());
  const [name, title] = beforeAt.split(',').map((s) => s.trim());
  if (!name) return null;
  return { name, title: title || undefined, company: company || undefined };
}

export function CommandBar({ onPick, onProspectAdded }: {
  onPick: (id: string) => void;
  onProspectAdded: (id: string) => void;
}) {
  const [openBar, setOpenBar] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<BrainSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isAdd = q.startsWith('+');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setOpenBar(true); setTimeout(() => inputRef.current?.focus(), 0);
      }
      if (e.key === 'Escape') { setOpenBar(false); setQ(''); setResults([]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (isAdd || q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/v1/brain/search?query=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setResults(d.data?.results ?? []))
        .catch(() => setResults([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q, isAdd]);

  const submitAdd = useCallback(async () => {
    const prospect = parseAddProspect(q);
    if (!prospect) return;
    setBusy(true);
    try {
      // Contract: outreach.prospect.create capability (POST /api/v1/outreach/prospects) —
      // requires name + source; returns { prospect, deduplicated }.
      const { data } = await apiMutate<{ prospect: { id?: string } }>(
        'POST',
        '/outreach/prospects',
        { ...prospect, source: 'manual', triggerResearch: true },
      );
      const created = data.prospect;
      if (created?.id) { onProspectAdded(String(created.id)); setOpenBar(false); setQ(''); }
    } catch {
      // The add is best-effort from the command bar; the input stays for retry.
    } finally { setBusy(false); }
  }, [q, onProspectAdded]);

  if (!openBar) {
    return (
      <button
        onClick={() => { setOpenBar(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        className="absolute left-1/2 top-4 -translate-x-1/2 rounded-lg border border-border/50 bg-background/80 px-4 py-1.5 text-xs text-muted-foreground backdrop-blur hover:text-foreground"
      >
        ⌘K — find anything · “+ name” to add a prospect
      </button>
    );
  }

  return (
    <div className="absolute left-1/2 top-4 z-10 w-[420px] max-w-[90%] -translate-x-1/2 rounded-xl border border-border/60 bg-background/95 p-2 backdrop-blur">
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (isAdd) void submitAdd();
            else if (results[0]) { onPick(results[0].id); setOpenBar(false); setQ(''); }
          }
        }}
        placeholder="Find anything… or “+ Sarah Chen, CTO @ Linear”"
        className="w-full bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
      />
      {isAdd && (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          {busy ? 'adding — the brain will research them…' : (() => {
            const p = parseAddProspect(q);
            return p ? `↵ add ${p.name}${p.title ? `, ${p.title}` : ''}${p.company ? ` @ ${p.company}` : ''}` : 'type a name';
          })()}
        </div>
      )}
      {!isAdd && results.length > 0 && (
        <ul className="max-h-64 overflow-y-auto">
          {results.map((r) => (
            <li key={r.id}>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
                onClick={() => { onPick(r.id); setOpenBar(false); setQ(''); }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLOR[r.type] }} />
                <span>{r.label}</span>
                <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">{r.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
