'use client';

import {
  AlertCircle,
  BrainCircuit,
  Building2,
  Check,
  Circle,
  ExternalLink,
  Loader2,
  MessageSquareText,
  Newspaper,
  Sparkles,
  Target,
  TrendingUp,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { InsightCategory, ProspectResearch } from '@/products/outreach/domain/types';
import {
  RESEARCH_TOPIC_CONFIG,
  type ResearchRunState,
  type ResearchSourcePreview,
  type ResearchTopic,
} from './research-mastra';

const TOPIC_ICONS: Record<ResearchTopic, LucideIcon> = {
  company: Building2,
  news: Newspaper,
  ai: BrainCircuit,
  competitors: UsersRound,
  industry: TrendingUp,
};

const SOURCE_CATEGORIES: Partial<Record<ResearchTopic, InsightCategory[]>> = {
  company: ['overview', 'products', 'culture'],
  news: ['recent_news'],
  ai: ['ai_initiatives'],
};

interface ResearchLiveSurfaceProps {
  prospectName: string;
  research?: ProspectResearch | null;
  run?: ResearchRunState | null;
}

function finalTopicCopy(topic: ResearchTopic, research: ProspectResearch): string {
  const matchingInsight = research.companyInsights.find((insight) =>
    SOURCE_CATEGORIES[topic]?.includes(insight.category));
  if (matchingInsight) return matchingInsight.content;
  if (topic === 'company') return research.companySummary;
  if (topic === 'competitors') {
    return research.competitors.length > 0
      ? research.competitors.map((competitor) => competitor.name).join(', ')
      : 'No material competitors were identified in the retrieved evidence.';
  }
  if (topic === 'industry') return research.industry;
  return 'The retrieved evidence was considered in the final brief.';
}

function persistedSources(topic: ResearchTopic, research: ProspectResearch): ResearchSourcePreview[] {
  const categories = SOURCE_CATEGORIES[topic] ?? [];
  return research.companyInsights.flatMap((insight) => (
    categories.includes(insight.category) && insight.sourceUrl
      ? [{ title: insight.content, url: insight.sourceUrl }]
      : []
  ));
}

export function ResearchLiveSurface({ prospectName, research, run }: ResearchLiveSurfaceProps) {
  const isError = run?.phase === 'error';
  const isSynthesizing = run?.phase === 'synthesizing';
  const isComplete = Boolean(research) && (!run || run.phase === 'complete');
  const completed = isComplete
    ? RESEARCH_TOPIC_CONFIG.length
    : run?.topics.filter((topic) => topic.status === 'complete').length ?? 0;
  const progress = Math.round((completed / RESEARCH_TOPIC_CONFIG.length) * 100);

  return (
    <div
      aria-live="polite"
      className="overflow-hidden rounded-xl border bg-gradient-to-br from-primary/[0.07] via-background to-background"
      data-testid="research-live-surface"
    >
      <div className="border-b px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary">
              {isComplete ? <Check className="size-4" /> : <Sparkles className="size-4" />}
            </div>
            <div className="min-w-0">
              <p className="font-medium text-foreground">
                {isError
                  ? 'Research stopped'
                  : isComplete
                    ? `${prospectName}’s research brief`
                    : `Building ${prospectName}’s research brief`}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isError
                  ? run?.error
                  : isComplete
                    ? 'Evidence gathered, checked, and synthesized into an outreach point of view.'
                    : isSynthesizing
                      ? 'Cross-checking the retrieved evidence and composing the brief.'
                      : 'Searching independent evidence lanes in parallel.'}
              </p>
            </div>
          </div>
          <Badge
            className={isError
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : isComplete
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-primary/25 bg-primary/10 text-primary'}
            variant="outline"
          >
            {isError ? (
              <AlertCircle className="mr-1 size-3" />
            ) : isComplete ? (
              <Check className="mr-1 size-3" />
            ) : (
              <span className="mr-1.5 size-1.5 animate-pulse rounded-full bg-current" />
            )}
            {isError ? 'Needs attention' : isComplete ? 'Research complete' : 'Live stream'}
          </Badge>
        </div>

        {!isError && (
          <div className="mt-4 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={isComplete
                  ? 'h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out'
                  : 'h-full rounded-full bg-primary transition-[width] duration-500 ease-out'}
                style={{ width: `${isSynthesizing || isComplete ? 100 : progress}%` }}
              />
            </div>
            <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">
              {isComplete
                ? '5 lanes complete'
                : isSynthesizing
                  ? 'Synthesizing'
                  : `${completed} of 5 found`}
            </span>
          </div>
        )}
      </div>

      <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
        {RESEARCH_TOPIC_CONFIG.map(({ topic, label }) => {
          const liveItem = run?.topics.find((candidate) => candidate.topic === topic);
          const itemStatus = isComplete ? 'complete' : liveItem?.status ?? 'pending';
          const Icon = TOPIC_ICONS[topic];
          const topicIsComplete = itemStatus === 'complete';
          const isSearching = itemStatus === 'searching';
          const sources = isComplete && research
            ? (liveItem?.sources?.length ? liveItem.sources : persistedSources(topic, research))
            : liveItem?.sources ?? [];
          const detail = isComplete && research
            ? finalTopicCopy(topic, research)
            : liveItem?.query;
          const resultCount = liveItem?.resultCount ?? sources.length;

          return (
            <div className="min-w-0 bg-background/95 p-4" key={topic}>
              <div className="flex items-center gap-2">
                <div className={topicIsComplete
                  ? 'rounded-md bg-emerald-500/10 p-1.5 text-emerald-600 dark:text-emerald-400'
                  : isSearching
                    ? 'rounded-md bg-primary/10 p-1.5 text-primary'
                    : 'rounded-md bg-muted p-1.5 text-muted-foreground'}
                >
                  <Icon className="size-3.5" />
                </div>
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{label}</p>
                {topicIsComplete ? (
                  <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
                ) : isSearching ? (
                  <Loader2 className="size-4 animate-spin text-primary" />
                ) : (
                  <Circle className="size-3.5 text-muted-foreground/50" />
                )}
              </div>

              <p className="mt-2 line-clamp-3 min-h-12 text-xs leading-4 text-muted-foreground">
                {detail
                  ? detail
                  : isError
                    ? 'Not completed'
                    : 'Waiting for this evidence lane…'}
              </p>

              {topicIsComplete && (
                <div className="mt-3 border-t pt-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {isComplete
                      ? sources.length > 0 ? `${sources.length} cited sources` : 'Evidence synthesized'
                      : `${resultCount} sources retrieved`}
                  </p>
                  {sources.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {sources.slice(0, 2).map((source) => (
                        <a
                          className="group flex min-w-0 items-center gap-1.5 text-xs text-foreground/80 hover:text-primary"
                          href={source.url}
                          key={source.url}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          <span className="truncate">{source.title}</span>
                          <ExternalLink className="size-3 shrink-0 opacity-50 group-hover:opacity-100" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <div className="flex min-h-36 items-center gap-3 bg-primary/[0.06] p-4 sm:col-span-2 xl:col-span-1">
          <div className="relative rounded-full border border-primary/20 bg-background p-2.5 text-primary shadow-sm">
            <BrainCircuit className="size-4" />
            {!isComplete && !isError && (
              <span className="absolute -right-0.5 -top-0.5 size-2 animate-pulse rounded-full bg-primary" />
            )}
          </div>
          <div>
            <p className="text-sm font-medium">
              {isComplete ? 'Point of view ready' : isSynthesizing ? 'Generating the point of view' : 'Point of view comes next'}
            </p>
            <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
              {isComplete
                ? 'The same evidence now supports the talking points and outreach angle below.'
                : 'Retrieved sources will become grounded talking points and an outreach angle.'}
            </p>
          </div>
        </div>
      </div>

      <div className="border-t bg-background/95 p-4 sm:p-5">
        {isComplete && research ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.9fr)]">
            <div className="space-y-5">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Building2 className="size-3.5" /> Company brief
                </div>
                <p className="text-sm leading-6 text-foreground/90">{research.companySummary}</p>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <MessageSquareText className="size-3.5" /> Talking points
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {research.talkingPoints.map((point) => (
                    <div className="rounded-lg border bg-muted/20 px-3 py-2.5 text-sm leading-5" key={point}>
                      {point}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-primary/20 bg-primary/[0.07] p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
                  <Target className="size-3.5" /> Outreach angle
                </div>
                <p className="text-sm leading-6">{research.outreachAngle}</p>
              </div>
              {research.competitors.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Competitive context
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {research.competitors.map((competitor) => (
                      <Badge className="font-normal" key={competitor.name} variant="secondary">
                        {competitor.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : isError ? (
          <div className="flex items-center gap-3 py-2 text-sm text-muted-foreground">
            <AlertCircle className="size-4 text-destructive" />
            The brief was not replaced. Run research again to continue.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,0.55fr)]">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Building2 className="size-3.5" /> Company brief
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Skeleton className="h-12 rounded-lg" />
                <Skeleton className="h-12 rounded-lg" />
              </div>
            </div>
            <div className="rounded-xl border border-primary/15 bg-primary/[0.04] p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary/80">
                <Target className="size-3.5" /> Outreach angle
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-3/4" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
