'use client';

import {
  BookOpenCheck,
  Check,
  Circle,
  ExternalLink,
  Loader2,
  PenLine,
  Save,
  Search,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StreamingText } from '@/components/genui';
import { cn } from '@/lib/utils';
import type { OutreachOutput } from '@/products/outreach/agent/generator';
import type { LeadResearchResult } from '@/products/outreach/domain/research-schema';
import {
  OUTREACH_MEDIUM_CONFIG,
  type OutreachMedium,
  type OutreachMessage,
} from '@/products/outreach/domain/types';

export type ResearchPreview = Partial<LeadResearchResult>;

export interface ResearchTopicProgress {
  topic: string;
  status: 'searching' | 'complete';
  query?: string;
  resultCount?: number;
}

export interface GenerationProgress {
  id: string;
  label: string;
  state: string;
}

const RESEARCH_TOPICS = [
  { id: 'company', label: 'Company' },
  { id: 'news', label: 'Recent news' },
  { id: 'ai', label: 'AI activity' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'industry', label: 'Market' },
] as const;

function StepIcon({ state }: { state: 'pending' | 'running' | 'complete' }) {
  if (state === 'complete') {
    return <Check className="size-3.5" />;
  }
  if (state === 'running') {
    return <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />;
  }
  return <Circle className="size-3.5" />;
}

export function ResearchGenerationExperience({
  partial,
  topics,
  progress,
  isStreaming,
  error,
}: {
  partial: ResearchPreview | null;
  topics: ResearchTopicProgress[];
  progress: GenerationProgress[];
  isStreaming: boolean;
  error: string | null;
}) {
  const topicById = new Map(topics.map((item) => [item.topic, item]));
  const completedTopics = topics.filter((item) => item.status === 'complete').length;
  const activeTopic = topics.find((item) => item.status === 'searching');
  const synthesis = progress.find((item) => item.id === 'synthesis');
  const summary = typeof partial?.companySummary === 'string' ? partial.companySummary : '';
  const angle = typeof partial?.outreachAngle === 'string' ? partial.outreachAngle : '';
  const talkingPoints = Array.isArray(partial?.talkingPoints)
    ? partial.talkingPoints.filter((point): point is string => typeof point === 'string')
    : [];

  return (
    <div
      aria-busy={isStreaming}
      aria-live="polite"
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-cyan-500/10 shadow-sm',
        error ? 'border-destructive/40' : 'border-primary/25',
      )}
    >
      <div className="h-1 bg-gradient-to-r from-cyan-500 via-primary to-violet-500" />
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="size-4" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">Building the lead brief</p>
                <Badge variant={error ? 'destructive' : 'tint'}>
                  {error ? 'Stopped' : isStreaming ? 'Live' : 'Ready'}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {error
                  ? error
                  : synthesis?.state === 'running'
                    ? 'The evidence is in. Turning it into a useful point of view.'
                    : activeTopic?.query
                      ? activeTopic.query
                      : `${completedTopics} of ${RESEARCH_TOPICS.length} research lanes complete`}
              </p>
            </div>
          </div>
          {!error && isStreaming && (
            <span className="inline-flex items-center gap-2 text-xs font-medium text-primary">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-50 motion-reduce:animate-none" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              Streaming into this page
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {RESEARCH_TOPICS.map((topic) => {
            const current = topicById.get(topic.id);
            const state = current?.status === 'complete'
              ? 'complete'
              : current?.status === 'searching'
                ? 'running'
                : 'pending';
            return (
              <div
                className={cn(
                  'flex min-w-28 flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-all duration-300',
                  state === 'complete' && 'border-primary/20 bg-primary/10 text-primary',
                  state === 'running' && 'border-primary/40 bg-card shadow-sm',
                  state === 'pending' && 'border-border/60 bg-card/40 text-muted-foreground',
                )}
                key={topic.id}
              >
                <StepIcon state={state} />
                <span className="truncate">{topic.label}</span>
              </div>
            );
          })}
        </div>

        {(summary || angle || talkingPoints.length > 0) ? (
          <div className="grid gap-3">
            <div className="rounded-xl border bg-card/85 p-4 shadow-sm backdrop-blur">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <BookOpenCheck className="size-3.5" /> Live brief
              </div>
              {summary ? (
                <StreamingText text={summary} done={!isStreaming} />
              ) : (
                <p className="text-sm text-muted-foreground">Assembling the company narrative…</p>
              )}
            </div>
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-primary">
                Outreach direction
              </div>
              {angle ? (
                <StreamingText text={angle} done={!isStreaming} />
              ) : talkingPoints.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {talkingPoints.slice(0, 3).map((point, index) => (
                    <li className="flex gap-2" key={`${index}-${point}`}>
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Finding the strongest honest angle…</p>
              )}
            </div>
          </div>
        ) : !error ? (
          <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed bg-card/50 px-6 text-center">
            <div>
              <Search className="mx-auto mb-2 size-5 text-primary" />
              <p className="text-sm font-medium">Evidence will appear here as it becomes usable</p>
              <p className="mt-1 text-xs text-muted-foreground">The brief will take shape as each source comes back.</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const OUTREACH_STEPS = [
  { id: 'context', label: 'Grounding', icon: BookOpenCheck },
  { id: 'draft', label: 'Writing', icon: PenLine },
  { id: 'save', label: 'Saving', icon: Save },
] as const;

export function OutreachGenerationExperience({
  leadName,
  medium,
  partial,
  finalMessage,
  progress,
  isStreaming,
  error,
}: {
  leadName: string;
  medium: OutreachMedium | null;
  partial: Partial<OutreachOutput> | null;
  finalMessage: OutreachMessage | null;
  progress: GenerationProgress[];
  isStreaming: boolean;
  error: string | null;
}) {
  if (!isStreaming && !partial && !finalMessage && !error) return null;

  const progressById = new Map(progress.map((item) => [item.id, item]));
  const content = finalMessage?.content || (typeof partial?.content === 'string' ? partial.content : '');
  const subject = finalMessage?.subject || (typeof partial?.subject === 'string' ? partial.subject : '');
  const mediumLabel = medium ? OUTREACH_MEDIUM_CONFIG[medium].label : 'Outreach';
  const isDone = Boolean(finalMessage) && !isStreaming;

  return (
    <div
      aria-busy={isStreaming}
      aria-live="polite"
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-gradient-to-br from-violet-500/10 via-card to-primary/10 shadow-sm',
        error ? 'border-destructive/40' : 'border-primary/25',
      )}
    >
      <div className="h-1 bg-gradient-to-r from-violet-500 via-primary to-cyan-500" />
      <div className="grid gap-5 p-5 lg:grid-cols-[15rem_1fr]">
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="size-4" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{isDone ? 'Draft ready' : 'Creating outreach'}</p>
                <Badge variant={error ? 'destructive' : isDone ? 'secondary' : 'tint'}>
                  {error ? 'Stopped' : isDone ? 'Saved' : 'Live'}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {mediumLabel} for {leadName}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {OUTREACH_STEPS.map(({ id, label, icon: Icon }) => {
              const item = progressById.get(id);
              const state = item?.state === 'complete'
                ? 'complete'
                : item?.state === 'running'
                  ? 'running'
                  : 'pending';
              return (
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors',
                    state === 'running' && 'bg-card font-medium text-foreground shadow-sm',
                    state === 'complete' && 'text-primary',
                    state === 'pending' && 'text-muted-foreground',
                  )}
                  key={id}
                >
                  <StepIcon state={state} />
                  <Icon className="size-3.5" />
                  <span>{item?.label || label}</span>
                </div>
              );
            })}
          </div>

          {isDone && finalMessage && (
            <Button asChild size="sm" variant="outline">
              <a href={`#outreach-${finalMessage.id}`}>
                Review in drafts <ExternalLink className="size-3.5" />
              </a>
            </Button>
          )}
        </div>

        <div className="min-h-48 rounded-xl border bg-card/90 p-5 shadow-sm backdrop-blur">
          {error ? (
            <div className="grid min-h-36 place-items-center text-center">
              <div>
                <p className="font-medium text-destructive">Generation stopped</p>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              </div>
            </div>
          ) : content || subject ? (
            <div className="space-y-4">
              {subject && (
                <div className="border-b pb-3">
                  <span className="mr-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Subject</span>
                  <span className="text-sm font-medium">{subject}</span>
                </div>
              )}
              {content ? (
                <StreamingText text={content} done={!isStreaming} />
              ) : (
                <p className="text-sm text-muted-foreground">Starting the draft…</p>
              )}
            </div>
          ) : (
            <div className="grid min-h-36 place-items-center text-center">
              <div>
                <PenLine className="mx-auto mb-2 size-5 text-primary" />
                <p className="text-sm font-medium">The draft will write itself here</p>
                <p className="mt-1 text-xs text-muted-foreground">Grounding the message before the first words arrive.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
