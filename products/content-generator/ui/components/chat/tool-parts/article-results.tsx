'use client';

import { useState } from 'react';
import { BookOpenText, ChevronDown, ExternalLink, Globe2, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ArticleResult {
  title: string;
  url: string;
  content: string;
  publishedDate?: string | null;
  score?: number;
}

function sourceName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Web';
  }
}

function readingTime(content: string): string {
  return `${Math.max(1, Math.ceil(content.trim().split(/\s+/).length / 200))} min read`;
}

export function ArticleResults({ query, topic, results }: { query?: string; topic?: string; results: ArticleResult[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? results : results.slice(0, 3);
  return (
    <div className="my-3 overflow-hidden rounded-2xl border bg-card animate-in fade-in slide-in-from-bottom-2 duration-500" data-component="DATA-04 Research Result List">
      <div className="flex flex-wrap items-center gap-3 border-b bg-muted/20 px-4 py-3">
        <span className="grid size-8 place-items-center rounded-lg bg-cyan-400/10 text-cyan-400"><Globe2 className="size-4" /></span>
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold">Current evidence</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{query ?? topic ?? 'Web research'} · ranked by relevance</p></div>
        <Badge variant="outline">{results.length} source{results.length === 1 ? '' : 's'}</Badge>
      </div>
      {results.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground" data-component="DATA-07 Empty Result">No current sources matched this search.</div> : <div className="divide-y">
        {visible.map((article, index) => (
          <article className="group p-4 transition-colors hover:bg-muted/15" data-component="DATA-03 Article Result Card" key={`${article.url}-${index}`}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border bg-background text-muted-foreground group-hover:text-cyan-400"><BookOpenText className="size-3.5" /></span>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="min-w-0 flex-1 text-sm font-medium leading-5">{article.title}</h4><span className="inline-flex max-w-44 items-center gap-1 truncate rounded-full border bg-background px-2 py-0.5 text-[9px] text-muted-foreground" data-component="DATA-06 Source Chip"><Globe2 className="size-2.5 shrink-0" />{sourceName(article.url)}</span></div><div className="mt-1 flex flex-wrap gap-2 text-[9px] text-muted-foreground/75"><span>{readingTime(article.content)}</span>{article.publishedDate && <span>{article.publishedDate.slice(0, 10)}</span>}</div><p className="mt-1.5 line-clamp-3 text-xs leading-5 text-muted-foreground">{article.content}</p><a className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline" href={article.url} rel="noopener noreferrer" target="_blank">Open source <ExternalLink className="size-3" /></a></div>
            </div>
          </article>
        ))}
      </div>}
      {results.length > 3 && <button className="flex w-full items-center justify-center gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground" onClick={() => setShowAll((current) => !current)} type="button"><Sparkles className="size-3" />{showAll ? 'Show strongest sources' : `Show ${results.length - 3} more`}<ChevronDown className={`size-3 transition-transform ${showAll ? 'rotate-180' : ''}`} /></button>}
    </div>
  );
}
