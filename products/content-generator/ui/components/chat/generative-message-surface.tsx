'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleAlert,
  Globe2,
  ListChecks,
  Search,
  Sparkles,
} from 'lucide-react';
import { ThreadPrimitive, useAssistantState } from '@assistant-ui/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type WorkStatus = 'queued' | 'running' | 'partial' | 'complete' | 'failed';
type WorkCategory = 'knowledge' | 'web' | 'synthesis' | 'action';

type ChatEvent =
  | {
      id: string;
      event: 'assistant.ack';
      at: number;
      intent: string;
      message: string;
    }
  | {
      id: string;
      event: 'activity.started' | 'activity.completed' | 'activity.failed';
      at: number;
      label: string;
      category: WorkCategory;
      detail?: string;
      owner?: string;
    }
  | {
      id: string;
      event: 'tool.progress';
      at: number;
      tool: string;
      label: string;
      status: WorkStatus;
      detail?: string;
      query?: string;
      resultCount?: number;
    };

type ActivityView = {
  id: string;
  label: string;
  category: WorkCategory;
  status: WorkStatus;
  detail?: string;
  tool?: string;
  resultCount?: number;
};

type AssistantPart = {
  type: string;
  name?: string;
  data?: unknown;
  toolName?: string;
  toolCallId?: string;
  status?: { type?: string };
  result?: unknown;
  isError?: boolean;
};

const TOOL_LABELS: Record<string, { label: string; category: WorkCategory }> = {
  searchknowledge: { label: 'Searching workspace knowledge', category: 'knowledge' },
  listprojects: { label: 'Loading projects', category: 'knowledge' },
  getproject: { label: 'Loading project context', category: 'knowledge' },
  listleads: { label: 'Searching leads', category: 'knowledge' },
  getlead: { label: 'Loading lead context', category: 'knowledge' },
  getresearch: { label: 'Searching workspace research', category: 'knowledge' },
  listtopics: { label: 'Loading topic coverage', category: 'knowledge' },
  tavilysearch: { label: 'Searching current sources', category: 'web' },
  runleadintelligence: { label: 'Running lead intelligence', category: 'action' },
  runoutreachintelligence: { label: 'Creating outreach artifact', category: 'action' },
};

function normalizeToolName(name: string): string {
  return name.replace(/tool$/i, '').replaceAll('-', '').toLowerCase();
}

function isChatEvent(value: unknown): value is ChatEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<ChatEvent>;
  return typeof event.id === 'string'
    && typeof event.event === 'string'
    && typeof event.at === 'number';
}

function statusFromPart(part: AssistantPart): WorkStatus {
  if (part.isError || part.status?.type === 'error' || part.status?.type === 'incomplete') {
    return 'failed';
  }
  if (part.status?.type === 'complete' || part.result !== undefined) return 'complete';
  return 'running';
}

function eventsFromParts(parts: AssistantPart[]): ChatEvent[] {
  const toolIds = new Map<string, string>();
  for (const part of parts) {
    if (part.type === 'tool-call' && part.toolName && part.toolCallId) {
      toolIds.set(normalizeToolName(part.toolName), part.toolCallId);
    }
  }
  const events: ChatEvent[] = [];
  for (const [index, part] of parts.entries()) {
    if (part.type === 'data' && part.name === 'taicho-event' && isChatEvent(part.data)) {
      events.push(part.data);
      continue;
    }
    if (part.type === 'tool-call' && part.toolName && part.toolCallId) {
      const normalized = normalizeToolName(part.toolName);
      const config = TOOL_LABELS[normalized]
        ?? { label: 'Using a workspace capability', category: 'knowledge' as const };
      events.push({
        id: part.toolCallId,
        event: 'tool.progress',
        at: index,
        tool: part.toolName,
        label: config.label,
        status: statusFromPart(part),
      });
      continue;
    }
    if (
      part.type !== 'data'
      || part.name !== 'tool-progress'
      || !part.data
      || typeof part.data !== 'object'
    ) continue;
    const data = part.data as {
      tool?: string;
      topic?: string;
      status?: string;
      message?: string;
      query?: string;
      resultCount?: number;
    };
    const tool = data.tool ?? (data.topic ? 'tavilySearch' : 'workspaceCapability');
    const normalized = normalizeToolName(tool);
    const config = TOOL_LABELS[normalized] ?? {
      label: data.message ?? 'Working with workspace context',
      category: data.topic ? 'web' as const : 'knowledge' as const,
    };
    events.push({
      id: toolIds.get(normalized) ?? `progress-${normalized}`,
      event: 'tool.progress',
      at: index,
      tool,
      label: data.message ?? config.label,
      status: data.status === 'complete'
        ? 'complete'
        : data.status === 'error'
          ? 'failed'
          : 'running',
      query: data.query,
      resultCount: data.resultCount,
    });
  }
  return events;
}

function viewFromEvents(events: ChatEvent[]) {
  let acknowledgement: Extract<ChatEvent, { event: 'assistant.ack' }> | null = null;
  const activities = new Map<string, ActivityView>();
  for (const event of events) {
    if (event.event === 'assistant.ack') {
      acknowledgement = event;
      continue;
    }
    if (event.event === 'tool.progress') {
      const normalized = normalizeToolName(event.tool);
      activities.set(event.id, {
        id: event.id,
        label: event.label,
        category: TOOL_LABELS[normalized]?.category ?? 'knowledge',
        status: event.status,
        detail: event.detail ?? event.query,
        tool: event.tool,
        resultCount: event.resultCount,
      });
      continue;
    }
    activities.set(event.id, {
      id: event.id,
      label: event.label,
      category: event.category,
      status: event.event === 'activity.completed'
        ? 'complete'
        : event.event === 'activity.failed'
          ? 'failed'
          : 'running',
      detail: event.detail,
    });
  }
  return { acknowledgement, activities: [...activities.values()] };
}

function ActivityIcon({ activity }: { activity: ActivityView }) {
  if (activity.status === 'complete') return <Check className="size-3.5" />;
  if (activity.status === 'failed') return <CircleAlert className="size-3.5" />;
  if (activity.category === 'web') return <Globe2 className="size-3.5" />;
  if (activity.category === 'action') return <Sparkles className="size-3.5" />;
  return <Search className="size-3.5" />;
}

function WorkReceipt({ activities, onExpand }: {
  activities: ActivityView[];
  onExpand: () => void;
}) {
  const results = activities.reduce((sum, activity) => sum + (activity.resultCount ?? 0), 0);
  const failed = activities.filter((activity) => activity.status === 'failed').length;
  return (
    <button
      className="flex w-full items-center gap-3 rounded-xl border bg-muted/20 px-3 py-2.5 text-left transition-colors hover:bg-muted/35"
      data-component="WORK-05 Work Receipt"
      onClick={onExpand}
      type="button"
    >
      <span className="grid size-7 place-items-center rounded-lg border bg-background text-muted-foreground">
        <ListChecks className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{failed ? 'Work needs attention' : 'Work complete'}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {activities.length} step{activities.length === 1 ? '' : 's'}
          {results ? ` · ${results} results` : ''}
        </p>
      </div>
      <span className="text-[10px] text-muted-foreground">View work</span>
      <ChevronDown className="size-3 text-muted-foreground" />
    </button>
  );
}

function ActivityRail({ activities, running }: {
  activities: ActivityView[];
  running: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasActive = activities.some((activity) => (
    activity.status === 'running'
    || activity.status === 'partial'
    || activity.status === 'queued'
  ));
  useEffect(() => {
    if (running || hasActive) return;
    const timer = window.setTimeout(() => setExpanded(false), 700);
    return () => window.clearTimeout(timer);
  }, [hasActive, running]);
  const displayExpanded = running || hasActive || expanded;
  if (activities.length === 0) return null;
  if (!displayExpanded) {
    return <WorkReceipt activities={activities} onExpand={() => setExpanded(true)} />;
  }
  return (
    <div className="mb-3 overflow-hidden rounded-xl border bg-card/70" data-component="WORK-02 Activity Rail">
      <button
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span className="relative grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
          <Activity className="size-3.5" />
          {hasActive ? <span className="absolute -right-0.5 -top-0.5 size-2 animate-pulse rounded-full bg-primary" /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">{hasActive ? 'Running workflow capabilities' : 'Work complete'}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Actions and artifacts stay visible; private reasoning stays private.</p>
        </div>
        <Badge variant={hasActive ? 'secondary' : 'outline'}>
          {hasActive ? 'Live' : `${activities.length} step${activities.length === 1 ? '' : 's'}`}
        </Badge>
      </button>
      <div className="space-y-1 border-t px-3 py-2.5">
        {activities.map((activity) => {
          const active = activity.status === 'running' || activity.status === 'partial';
          return (
            <div className="flex items-start gap-3 rounded-lg px-2 py-2" key={activity.id}>
              <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border ${activity.status === 'complete' ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-400' : activity.status === 'failed' ? 'border-destructive/25 bg-destructive/10 text-destructive' : 'border-primary/25 bg-primary/7 text-primary'}`}>
                <ActivityIcon activity={activity} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{activity.label}</p>
                {activity.detail ? <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{activity.detail}</p> : null}
              </div>
              <span className="mt-1 flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                {active ? <i className="size-1.5 animate-pulse rounded-full bg-primary" /> : null}
                {activity.status}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GenerativeMessageSurface() {
  const parts = useAssistantState(({ message }) => message.parts as AssistantPart[]);
  const status = useAssistantState(({ message }) => message.status?.type);
  const view = useMemo(() => viewFromEvents(eventsFromParts(parts)), [parts]);
  const running = status === 'running' || status === 'requires-action';
  if (!view.acknowledgement && view.activities.length === 0) return null;
  return (
    <div className="mb-3" data-component="CHAT-04 Assistant Message Block">
      {view.acknowledgement ? (
        <div className="mb-3 flex items-start gap-3">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="size-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-primary/80">{view.acknowledgement.intent}</p>
            <p className="mt-1 text-sm leading-6 text-foreground/90">{view.acknowledgement.message}</p>
          </div>
        </div>
      ) : null}
      <ActivityRail activities={view.activities} running={running} />
    </div>
  );
}

export function AssistantStartingState() {
  return (
    <div className="mb-3 flex items-center gap-3 py-2 text-sm text-muted-foreground">
      <span className="relative grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
        <Bot className="size-3.5" />
        <span className="absolute -right-0.5 -top-0.5 size-2 animate-ping rounded-full bg-primary/50" />
      </span>
      <span>Taicho is understanding the request…</span>
    </div>
  );
}

export function SafeReasoningIndicator() {
  return (
    <div className="my-2 flex items-center gap-2 text-[11px] text-muted-foreground" aria-label="Taicho is planning the response">
      <BrainCircuit className="size-3.5 animate-pulse text-primary" />
      <span>Choosing the next useful capability</span>
    </div>
  );
}

export function ContextualSuggestedActions() {
  const parts = useAssistantState(({ message }) => message.parts as AssistantPart[]);
  const status = useAssistantState(({ message }) => message.status?.type);
  const isLast = useAssistantState(({ message }) => message.isLast);
  const view = useMemo(() => viewFromEvents(eventsFromParts(parts)), [parts]);
  if (!isLast || status === 'running' || !view.acknowledgement) return null;
  const intent = view.acknowledgement.intent.toLowerCase();
  const suggestions = intent.includes('lead')
    ? [
        { label: 'Prepare outreach', prompt: 'Create a grounded outreach artifact for this lead. Do not send it.' },
        { label: 'Explain the score', prompt: 'Explain the qualification evidence and uncertainty.' },
      ]
    : [
        { label: 'Go one level deeper', prompt: 'Go one level deeper using the strongest available evidence.' },
        { label: 'Suggest the next workflow', prompt: 'Which fixed intelligence workflow should we run next?' },
      ];
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {suggestions.map((suggestion) => (
        <ThreadPrimitive.Suggestion asChild key={suggestion.label} prompt={suggestion.prompt} send>
          <Button className="h-8 rounded-full text-xs" size="sm" variant="outline">
            <Sparkles className="size-3" />
            {suggestion.label}
          </Button>
        </ThreadPrimitive.Suggestion>
      ))}
    </div>
  );
}
