'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  Clock3,
  ExternalLink,
  FileText,
  Gauge,
  Globe2,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  Pause,
  Play,
  RefreshCw,
  Repeat2,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserRoundSearch,
  UsersRound,
  WandSparkles,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ControlDeckPrototype } from './ControlDeckPrototype';
import { DelegationRunwayPreview } from './DelegationRunwayPreview';
import { StreamingMessageBlock } from './StreamingMessageBlock';
import { ComponentTag, SectionHeading } from './spec-primitives';
import {
  COMPONENT_CATALOG,
  DECISIONS,
  DEMO_EVENT_SCRIPT,
  EVENT_CONTRACT,
  PERFORMANCE_BUDGETS,
  PHASES,
  SQUAD,
  SURFACES,
  TOOL_GROUPS,
  type ComponentCategory,
  type DemoPhase,
  type SurfaceSpec,
} from './spec-data';

const NAV_ITEMS = [
  ['control-deck', 'Control deck'],
  ['runtime', 'RLM runtime'],
  ['experience', 'Experience'],
  ['streaming', 'Streaming messages'],
  ['surfaces', 'UI inventory'],
  ['registry', 'Component names'],
  ['delegation', 'Delegation'],
  ['tools', 'Tools'],
  ['performance', 'Performance'],
  ['contract', 'Event contract'],
] as const;

const COMPONENT_CATEGORIES: Array<'All' | ComponentCategory> = ['All', 'Conversation', 'Work', 'Data', 'Delegation', 'Response', 'Action'];

function GlobalAnimationControls({
  looping,
  paused,
  onLoopChange,
  onPauseChange,
  onReplay,
}: {
  looping: boolean;
  paused: boolean;
  onLoopChange: (value: boolean) => void;
  onPauseChange: (value: boolean) => void;
  onReplay: () => void;
}) {
  return (
    <div className="fixed bottom-4 right-4 z-50 hidden flex-wrap items-center gap-2 rounded-2xl border border-primary/25 bg-background/95 p-2 shadow-2xl shadow-black/30 backdrop-blur 2xl:flex" aria-label="Global animation controls">
      <div className="flex items-center gap-2 px-2">
        <span className={`size-2 rounded-full ${paused ? 'bg-amber-300' : 'animate-pulse bg-emerald-300 motion-reduce:animate-none'}`} />
        <div><p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Preview motion</p><p className="text-xs font-medium">{paused ? 'Paused' : looping ? 'Looping all' : 'Ready'}</p></div>
      </div>
      <Button aria-pressed={looping} onClick={() => onLoopChange(!looping)} size="sm" variant={looping ? 'default' : 'outline'}>
        <Repeat2 className="size-3.5" /> {looping ? 'Loop on' : 'Loop off'}
      </Button>
      <Button onClick={onReplay} size="sm" variant="outline"><RotateCcw className="size-3.5" /> Replay all</Button>
      <Button onClick={() => onPauseChange(!paused)} size="sm" variant="outline">
        {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />} {paused ? 'Resume all' : 'Pause all'}
      </Button>
    </div>
  );
}

function StatusDot({ state }: { state: 'pending' | 'active' | 'done' | 'error' }) {
  if (state === 'done') {
    return <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"><Check className="size-3" /></span>;
  }
  if (state === 'error') {
    return <span className="grid size-5 shrink-0 place-items-center rounded-full bg-destructive/15 text-destructive"><X className="size-3" /></span>;
  }
  if (state === 'active') {
    return (
      <span className="relative grid size-5 shrink-0 place-items-center" aria-hidden>
        <span className="absolute size-4 animate-ping rounded-full bg-primary/20 motion-reduce:animate-none" />
        <span className="relative size-2 rounded-full bg-primary" />
      </span>
    );
  }
  return <span className="size-2 shrink-0 rounded-full bg-muted-foreground/35" />;
}

function ActivityRow({
  icon: Icon,
  title,
  detail,
  state,
}: {
  icon: typeof Search;
  title: string;
  detail: string;
  state: 'pending' | 'active' | 'done' | 'error';
}) {
  return (
    <div
      className={`relative flex items-start gap-3 overflow-hidden rounded-lg px-3 py-2.5 transition-colors duration-300 ${
        state === 'active' ? 'bg-primary/8 text-foreground' : 'text-muted-foreground'
      }`}
      data-component="WORK-03 Activity Step"
    >
      {state === 'active' && (
        <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />
      )}
      <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border bg-background ${state === 'active' ? 'border-primary/40 text-primary' : ''}`}>
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          <span className="ml-auto font-mono text-[8px] text-muted-foreground/60">WORK-03</span>
          <StatusDot state={state} />
        </div>
        <p className="mt-0.5 truncate text-xs">{detail}</p>
      </div>
    </div>
  );
}

function PersonResult({ loading = false }: { loading?: boolean }) {
  if (loading) {
    return (
      <div className="space-y-1.5" data-component="DATA-01 Prospect Result Card">
        <ComponentTag id="DATA-01" name="Prospect Result Card" />
        <div className="grid gap-3 rounded-xl border bg-background/70 p-4 md:grid-cols-[auto_1fr_auto]" aria-label="Searching prospect results">
          <div className="size-10 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
          <div className="space-y-2">
            <div className="h-3 w-36 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <div className="h-2.5 w-52 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </div>
          <div className="h-6 w-20 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5" data-component="DATA-01 Prospect Result Card">
      <ComponentTag id="DATA-01" name="Prospect Result Card" />
      <div className="animate-in fade-in slide-in-from-bottom-1 rounded-xl border bg-background/80 p-4 duration-300 motion-reduce:animate-none">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/12 text-sm font-semibold text-primary">AR</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">Aisha Rahman</p>
              <Badge variant="secondary">Qualified prospect</Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">VP Operations · Northstar Labs</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span><strong className="text-foreground">2</strong> touchpoints</span>
            <span><strong className="text-foreground">18d</strong> ago</span>
          </div>
        </div>
        <div className="mt-3 grid gap-2 border-t pt-3 text-xs sm:grid-cols-2">
          <p><span className="text-muted-foreground">Last contact</span><br /><span className="text-foreground">Replied to workflow note</span></p>
          <p><span className="text-muted-foreground">Open thread</span><br /><span className="text-foreground">AI operations reliability</span></p>
        </div>
      </div>
    </div>
  );
}

function DelegationResult({ done }: { done: boolean }) {
  return (
    <div className="space-y-1.5" data-component={done ? 'AGENT-03 Specialist Receipt' : 'AGENT-01 Delegation Card'}>
      <ComponentTag id={done ? 'AGENT-03' : 'AGENT-01'} name={done ? 'Specialist Receipt' : 'Delegation Card'} />
      <div className="animate-in fade-in slide-in-from-bottom-1 rounded-xl border border-sky-400/20 bg-sky-400/5 p-3 duration-300 motion-reduce:animate-none">
        <div className="flex items-center gap-3">
          <span className="relative grid size-9 shrink-0 place-items-center rounded-full border border-sky-400/25 bg-background text-sky-300">
            <UserRoundSearch className="size-4" />
            {!done && <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-pulse rounded-full border-2 border-card bg-sky-300 motion-reduce:animate-none" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">Scout</p>
              <Badge variant="outline">Specialist</Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">{done ? 'Verified current company context from 3 sources' : 'Verifying current company context'}</p>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">{done ? '3 sources' : '00:04'}</span>
        </div>
        {done && (
          <p className="mt-3 animate-in fade-in border-t border-sky-400/15 pt-3 text-xs leading-5 text-muted-foreground duration-300 motion-reduce:animate-none">
            Still at Northstar Labs; now owns automation reliability and approval workflows. Last public update was 11 days ago.
          </p>
        )}
      </div>
    </div>
  );
}

function ExperienceDemo({ looping, paused }: { looping: boolean; paused: boolean }) {
  const [eventCursor, setEventCursor] = useState(1);
  const [playing, setPlaying] = useState(false);
  const demoRef = useRef<HTMLDivElement>(null);
  const autoPlayedRef = useRef(false);
  const currentEvent = DEMO_EVENT_SCRIPT[eventCursor];
  const phaseIndex = Math.max(0, PHASES.findIndex((item) => item.id === currentEvent.phase));
  const phase = PHASES[phaseIndex];
  const visibleEvents = DEMO_EVENT_SCRIPT.slice(0, eventCursor + 1);

  useEffect(() => {
    if (!playing || paused) return;
    if (eventCursor >= DEMO_EVENT_SCRIPT.length - 1) return;
    const timer = window.setTimeout(() => {
      const nextEvent = eventCursor + 1;
      setEventCursor(nextEvent);
      if (nextEvent === DEMO_EVENT_SCRIPT.length - 1) setPlaying(false);
    }, DEMO_EVENT_SCRIPT[eventCursor + 1]?.delayMs ?? 800);
    return () => window.clearTimeout(timer);
  }, [eventCursor, paused, playing]);

  const at = (id: DemoPhase) => phaseIndex >= PHASES.findIndex((item) => item.id === id);
  const exact = (id: DemoPhase) => phase.id === id;

  const replay = () => {
    setEventCursor(0);
    setPlaying(true);
  };

  useEffect(() => {
    if (!looping || paused || eventCursor !== DEMO_EVENT_SCRIPT.length - 1) return;
    const timer = window.setTimeout(() => {
      setEventCursor(0);
      setPlaying(true);
    }, 1_400);
    return () => window.clearTimeout(timer);
  }, [eventCursor, looping, paused]);

  const selectPhase = (selectedPhase: DemoPhase) => {
    const lastEventForPhase = DEMO_EVENT_SCRIPT.reduce((match, event, index) => event.phase === selectedPhase ? index : match, 0);
    setPlaying(false);
    setEventCursor(lastEventForPhase);
  };

  useEffect(() => {
    const node = demoRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || autoPlayedRef.current) return;
      autoPlayedRef.current = true;
      setEventCursor(0);
      setPlaying(true);
      observer.disconnect();
    }, { threshold: 0.3 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={demoRef}>
      <Card className="gap-0 overflow-hidden border-primary/20 bg-card/80 py-0 shadow-2xl shadow-primary/5" data-component="CHAT-01 Conversation Shell">
      <div className="flex flex-col gap-3 border-b bg-muted/20 px-4 py-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Bot className="size-4" /></span>
          <div>
            <p className="text-sm font-medium">Canonical flow · Find a person</p>
            <p className="text-xs text-muted-foreground">“Do I know this person?” from request to answer</p>
          </div>
          <ComponentTag className="ml-2 hidden sm:inline-flex" id="CHAT-01" name="Conversation Shell" />
        </div>
        <div className="flex flex-wrap gap-1 lg:ml-auto">
          {PHASES.map((item, index) => (
            <button
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${index === phaseIndex ? 'bg-primary text-primary-foreground' : index < phaseIndex ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
              key={item.id}
              onClick={() => selectPhase(item.id)}
              type="button"
            >
              {item.shortLabel}
            </button>
          ))}
        </div>
        <Button disabled={paused} onClick={() => playing ? setPlaying(false) : eventCursor === DEMO_EVENT_SCRIPT.length - 1 ? replay() : setPlaying(true)} size="sm" variant="outline">
          {playing && !paused ? <Pause className="size-3.5" /> : eventCursor === DEMO_EVENT_SCRIPT.length - 1 ? <RotateCcw className="size-3.5" /> : <Play className="size-3.5" />}
          {paused ? 'Paused globally' : playing ? 'Pause' : eventCursor === DEMO_EVENT_SCRIPT.length - 1 ? 'Replay events' : 'Play event stream'}
        </Button>
      </div>

      <div className="grid min-h-[680px] xl:grid-cols-[minmax(0,1fr)_310px]">
        <div className="flex min-w-0 flex-col bg-background/35">
          <div className="flex-1 space-y-5 p-4 sm:p-6 lg:p-8">
            <div className="ml-auto flex max-w-md flex-col items-end gap-1.5" data-component="CHAT-03 User Message Bubble">
              <ComponentTag id="CHAT-03" name="User Message Bubble" />
              <div className="rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm text-primary-foreground shadow-sm">
                Do I know Aisha Rahman? If so, what was our last conversation about?
              </div>
            </div>

            <div className="max-w-2xl space-y-4" data-component="CHAT-04 Assistant Message Block">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border bg-card"><Sparkles className="size-4 text-primary" /></span>
                <div className="min-w-0 flex-1">
                  <ComponentTag className="mb-1.5" id="WORK-01" name="Intent Acknowledgement" />
                  <p className="animate-in fade-in slide-in-from-bottom-1 text-sm leading-6 duration-200 motion-reduce:animate-none">
                    I’ll check your workspace first, then verify anything that may be out of date.
                  </p>
                </div>
              </div>

              {at('interpret') && (
                <div className="ml-0 animate-in fade-in slide-in-from-bottom-1 rounded-2xl border bg-card/80 p-3 duration-300 sm:ml-11 motion-reduce:animate-none" data-component="WORK-02 Activity Rail">
                  <ComponentTag className="mb-2 ml-2" id="WORK-02" name="Activity Rail" />
                  <div className="mb-2 flex items-center justify-between px-2">
                    <div className="flex items-center gap-2">
                      <Activity className={`size-3.5 ${phase.id === 'complete' ? 'text-muted-foreground' : 'text-primary'}`} />
                      <p className="text-xs font-medium">{phase.id === 'complete' ? 'Work complete' : 'Working on it'}</p>
                    </div>
                    <button className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground" data-component="WORK-06 Stop Control" type="button">
                      {phase.id === 'complete' ? '3 sources · 3 tools' : <><CircleStop className="size-3" /> Stop</>}
                    </button>
                  </div>
                  <div className="space-y-1">
                    <ActivityRow
                      icon={BrainCircuit}
                      title="Understand the request"
                      detail="Resolve identity, history, and freshness"
                      state={exact('interpret') ? 'active' : 'done'}
                    />
                    {at('search') && (
                      <ActivityRow
                        icon={Search}
                        title="Search prospects"
                        detail={exact('search') ? 'Matching “Aisha Rahman” across your workspace' : 'One matching prospect found'}
                        state={exact('search') ? 'active' : 'done'}
                      />
                    )}
                    {at('evidence') && (
                      <ActivityRow
                        icon={Layers3}
                        title="Load relationship context"
                        detail={exact('evidence') ? 'Notes, outreach, and nurture activity in parallel' : 'Two touchpoints and one active thread'}
                        state={exact('evidence') ? 'active' : 'done'}
                      />
                    )}
                    {at('delegate') && (
                      <ActivityRow
                        icon={UsersRound}
                        title="Verify current context"
                        detail={exact('delegate') ? 'Scout is checking recent public evidence' : 'Current role confirmed from three sources'}
                        state={exact('delegate') ? 'active' : 'done'}
                      />
                    )}
                    {at('synthesize') && (
                      <ActivityRow
                        icon={WandSparkles}
                        title="Prepare the answer"
                        detail={exact('synthesize') ? 'Combining history with current evidence' : 'Answer and next step ready'}
                        state={exact('synthesize') ? 'active' : 'done'}
                      />
                    )}
                  </div>
                </div>
              )}

              {at('search') && (
                <div className="space-y-3 sm:ml-11">
                  <PersonResult loading={exact('search')} />
                  {at('delegate') && <DelegationResult done={at('synthesize')} />}
                </div>
              )}

              {at('synthesize') && (
                <div className="flex animate-in items-start gap-3 fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none" data-component="RESP-01 Answer Stream">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border bg-card"><Bot className="size-4 text-primary" /></span>
                  <div className="min-w-0 flex-1 text-sm leading-6">
                    <ComponentTag className="mb-1.5" id="RESP-01" name="Answer Stream" />
                    {exact('synthesize') ? (
                      <p>Yes—you know Aisha. She’s already a qualified prospect in your workspace<span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary align-text-bottom motion-reduce:animate-none" /></p>
                    ) : (
                      <div className="space-y-3">
                        <p><strong>Yes—you know Aisha.</strong> She is a qualified prospect at Northstar Labs, with two prior touchpoints.</p>
                        <p>Your last exchange was about <strong>reliable AI operations and approval workflows</strong>. She replied positively 18 days ago, but no follow-up was sent. Scout also confirmed she still owns this area.</p>
                        <ComponentTag id="DATA-06" name="Source Chip" />
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline"><FileText className="mr-1 size-3" /> Prospect record</Badge>
                          <Badge variant="outline"><MessageSquareText className="mr-1 size-3" /> 2 touchpoints</Badge>
                          <Badge variant="outline"><Globe2 className="mr-1 size-3" /> 3 current sources</Badge>
                        </div>
                        <ComponentTag id="RESP-02" name="Suggested Action Row" />
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button size="sm"><Send className="size-3.5" /> Draft a follow-up</Button>
                          <Button size="sm" variant="outline">Open prospect</Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="border-t bg-background/90 p-4" data-component="CHAT-05 Composer">
            <div className="mx-auto mb-1.5 max-w-3xl"><ComponentTag id="CHAT-05" name="Composer" /></div>
            <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border bg-card px-4 py-3 shadow-sm">
              <p className="min-h-6 flex-1 text-sm text-muted-foreground">Ask Taicho anything…</p>
              <span className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground"><ArrowRight className="size-4" /></span>
            </div>
          </div>
        </div>

        <aside className="border-t bg-muted/15 p-5 xl:border-l xl:border-t-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Selected state</p>
          <div className="mt-4 flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/12 text-sm font-semibold text-primary">{phaseIndex + 1}</span>
            <div>
              <h3 className="font-semibold">{phase.label}</h3>
              <Badge className="mt-2" variant="outline"><Clock3 className="mr-1 size-3" /> {phase.target}</Badge>
            </div>
          </div>
          <div className="mt-5 space-y-5 text-sm">
            <div>
              <p className="text-xs font-medium text-muted-foreground">What Taicho communicates</p>
              <p className="mt-1.5 leading-6">“{phase.visibleCopy}”</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Motion contract</p>
              <p className="mt-1.5 leading-6">{phase.motion}</p>
            </div>
            <div className="rounded-lg border bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
              <strong className="text-foreground">Stable geometry:</strong> active work resolves in place. The answer never jumps because a tool card arrived late.
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Semantic event stream</p>
                <Badge variant="outline">Mock runtime</Badge>
              </div>
              <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg border bg-background/70 p-2" aria-live="polite">
                {visibleEvents.slice(-5).map((event, index, events) => (
                  <div className={`rounded-md px-2 py-1.5 transition-colors ${index === events.length - 1 ? 'bg-primary/10' : ''}`} key={event.id}>
                    <div className="flex items-center gap-2">
                      <span className={`size-1.5 rounded-full ${event.source === 'rlm' ? 'bg-primary' : event.source === 'tool' ? 'bg-sky-300' : event.source === 'specialist' ? 'bg-emerald-300' : 'bg-muted-foreground'}`} />
                      <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground">{event.event}</code>
                      <span className="font-mono text-[9px] uppercase text-muted-foreground">{event.source}</span>
                    </div>
                    <p className="mt-1 pl-3.5 text-[10px] leading-4 text-muted-foreground">{event.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
      </Card>
    </div>
  );
}

function MiniArticleBundle({ loading = false }: { loading?: boolean }) {
  return (
    <div className="space-y-2" data-component="DATA-03 Article Result Card">
      <ComponentTag id="DATA-03" name="Article Result Card" />
      {loading && [0, 1].map((item) => <div className="flex items-center gap-3 rounded-lg border bg-background/70 p-3" key={item}><span className="size-8 animate-pulse rounded-md bg-muted motion-reduce:animate-none" /><div className="flex-1 space-y-2"><span className="block h-2.5 w-4/5 animate-pulse rounded bg-muted motion-reduce:animate-none" /><span className="block h-2 w-2/5 animate-pulse rounded bg-muted motion-reduce:animate-none" /></div></div>)}
      {!loading && [
        ['AI workflows need explicit approval gates', 'Research · 4 min read'],
        ['Where autonomous operations still fail', 'Article · 8 min read'],
      ].map(([title, meta], index) => (
        <div className="animate-in fade-in slide-in-from-bottom-1 flex items-center gap-3 rounded-lg border bg-background/70 p-3 duration-300 motion-reduce:animate-none" key={title} style={{ animationDelay: `${index * 90}ms` }}>
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><FileText className="size-3.5" /></span>
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{title}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{meta}</p></div>
          <ExternalLink className="size-3 text-muted-foreground" />
        </div>
      ))}
    </div>
  );
}

function SurfacePreview({ surface, looping, paused }: { surface: SurfaceSpec; looping: boolean; paused: boolean }) {
  const Icon = surface.icon;
  const [surfaceState, setSurfaceState] = useState<'idle' | 'active' | 'settled'>('idle');
  const [run, setRun] = useState(0);
  const [inView, setInView] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const enteredRef = useRef(false);
  const active = surfaceState === 'active';

  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting);
      if (entry.isIntersecting && !enteredRef.current) {
        enteredRef.current = true;
        setRun((current) => current + 1);
        setSurfaceState('active');
      }
    }, { threshold: 0.3 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active || paused || !inView) return;
    if (surface.id.startsWith('ACTION-')) return;
    const timer = window.setTimeout(() => setSurfaceState('settled'), surface.id === 'AGENT-05' ? 7_900 : 2_600);
    return () => window.clearTimeout(timer);
  }, [active, inView, paused, run, surface.id]);

  useEffect(() => {
    if (!looping || paused || !inView || surfaceState === 'idle') return;
    if (surfaceState === 'settled') {
      const timer = window.setTimeout(() => {
        setRun((current) => current + 1);
        setSurfaceState('active');
      }, 1_100);
      return () => window.clearTimeout(timer);
    }
    if (surface.id.startsWith('ACTION-')) {
      const timer = window.setTimeout(() => setRun((current) => current + 1), 2_600);
      return () => window.clearTimeout(timer);
    }
  }, [inView, looping, paused, run, surface.id, surfaceState]);

  const replay = () => {
    setRun((current) => current + 1);
    setSurfaceState('active');
  };

  const preview = (() => {
    switch (surface.id) {
      case 'WORK-01':
        return <div className="space-y-2"><ComponentTag id="WORK-01" name="Intent Acknowledgement" /><div className="animate-in fade-in slide-in-from-bottom-1 rounded-xl border bg-background/70 p-3 text-xs leading-5 duration-200 motion-reduce:animate-none">I’ll check your workspace first, then verify what may be out of date.</div></div>;
      case 'WORK-02':
        return <div className="space-y-2"><ComponentTag id="WORK-02" name="Activity Rail" /><div className="rounded-xl border bg-background/60 p-2"><ActivityRow detail="Matching people and companies" icon={Search} state="done" title="Search prospects" /><ActivityRow detail={active ? 'Notes and outreach history' : 'Two touchpoints loaded'} icon={Layers3} state={active ? 'active' : 'done'} title="Load context" /></div></div>;
      case 'WORK-04':
        return <div className="space-y-2"><ComponentTag id="WORK-04" name="Tool Progress Card" /><div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3">{active ? <span className="relative size-3"><span className="absolute inset-0 animate-ping rounded-full bg-primary/25 motion-reduce:animate-none" /><span className="absolute inset-1 rounded-full bg-primary" /></span> : <CheckCircle2 className="size-3 text-primary" />}<div><p className="text-xs font-medium">Searching workspace</p><p className="text-[11px] text-muted-foreground">{active ? '2 of 4 sources complete' : '4 sources complete'}</p></div></div><MiniArticleBundle loading={active} /></div>;
      case 'DATA-01':
        return <PersonResult loading={active} />;
      case 'DATA-03':
        return <MiniArticleBundle loading={active} />;
      case 'AGENT-05':
        return <div className="space-y-2" data-component="AGENT-05 Delegation Runway"><ComponentTag id="AGENT-05" name="Delegation Runway" /><DelegationRunwayPreview active={active} paused={paused} /></div>;
      case 'RESP-01':
        return <div className="space-y-2"><ComponentTag id="RESP-01" name="Answer Stream" /><div className="rounded-xl border bg-background/70 p-3 text-xs leading-5">{active ? <>Yes—you know Aisha. She is already a qualified prospect<span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-primary align-text-bottom motion-reduce:animate-none" /></> : <>Yes—you know Aisha. She is a qualified prospect with two prior touchpoints. Your last exchange was about reliable AI operations.</>}</div></div>;
      case 'ACTION-01':
        return <div className="space-y-2" data-component="ACTION-01 Approval Gate"><ComponentTag id="ACTION-01" name="Approval Gate" /><div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3"><p className="text-xs font-medium">{active ? 'Send follow-up to Aisha?' : 'Follow-up approved'}</p><p className="mt-1 text-[11px] text-muted-foreground">Email · aisha@northstar.example</p>{active ? <div className="mt-3 flex gap-2"><Button className="h-7 text-xs" onClick={() => setSurfaceState('settled')} size="sm">Review and send</Button><Button className="h-7 text-xs" size="sm" variant="ghost">Cancel</Button></div> : <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-300"><CheckCircle2 className="size-3.5" /> Approval captured</div>}</div></div>;
      case 'ACTION-04':
        return <div className="space-y-2" data-component="ACTION-04 Recovery Card"><ComponentTag id="ACTION-04" name="Recovery Card" /><div className={`rounded-xl border p-3 ${active ? 'border-destructive/25 bg-destructive/5' : 'border-emerald-300/20 bg-emerald-300/5'}`}><p className="text-xs font-medium">{active ? 'One web source timed out' : 'Source recovered'}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{active ? 'Your workspace results and two verified sources are still available.' : 'The missing source was added without changing completed results.'}</p>{active && <Button className="mt-3 h-7 text-xs" onClick={() => setSurfaceState('settled')} size="sm" variant="outline"><RefreshCw className="size-3" /> Retry source</Button>}</div></div>;
      default:
        return null;
    }
  })();
  return (
    <div className={surface.id === 'AGENT-05' ? 'h-full md:col-span-2 xl:col-span-4' : 'h-full'} ref={cardRef}>
      <Card className="group h-full gap-0 overflow-hidden py-0 transition-colors hover:border-primary/30" data-component={`${surface.id} ${surface.title}`}>
      <CardHeader className="border-b bg-muted/15 p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg border bg-background text-primary"><Icon className="size-4" /></span>
          <div className="min-w-0"><ComponentTag className="mb-1.5" id={surface.id} name={surface.title} /><CardTitle className="text-sm">{surface.title}</CardTitle><CardDescription className="mt-1 text-xs">{surface.purpose}</CardDescription></div>
        </div>
      </CardHeader>
      <CardContent className="p-5">
        <div className="animate-in fade-in slide-in-from-bottom-1 mb-5 min-h-44 duration-500 motion-reduce:animate-none" key={`${run}-${surfaceState}`}>{preview}</div>
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border bg-muted/15 px-3 py-2">
          <div className="min-w-0"><p className="text-[10px] text-muted-foreground">Driven by</p><code className="block truncate font-mono text-[10px] text-primary">{surfaceState === 'idle' ? `waiting for ${surface.driver}` : active ? surface.driver : surface.settledDriver}</code></div>
          <div className="flex items-center gap-2"><Badge variant={active ? 'secondary' : 'outline'}>{surfaceState === 'idle' ? 'waiting' : active ? surface.activeState : surface.settledState}</Badge><Button aria-label={`Replay ${surface.title} animation`} className="h-7 px-2 text-[10px]" onClick={replay} size="sm" variant="outline"><RotateCcw className="size-3" /> Replay</Button></div>
        </div>
        <dl className="grid gap-3 border-t pt-4 text-xs">
          <div className="grid grid-cols-[64px_1fr] gap-2"><dt className="text-muted-foreground">Enters</dt><dd>{surface.enters}</dd></div>
          <div className="grid grid-cols-[64px_1fr] gap-2"><dt className="text-muted-foreground">Active</dt><dd>{surface.active}</dd></div>
          <div className="grid grid-cols-[64px_1fr] gap-2"><dt className="text-muted-foreground">Settles</dt><dd>{surface.settles}</dd></div>
        </dl>
      </CardContent>
      </Card>
    </div>
  );
}

function DelegationDiagram() {
  const [activeAgent, setActiveAgent] = useState('Scout');
  const [cancelled, setCancelled] = useState(false);
  const selected = SQUAD.find((agent) => agent.name === activeAgent) ?? SQUAD[0];
  const SelectedIcon = selected.icon;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_350px]">
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b bg-muted/15 p-5">
          <CardTitle className="text-base">One conversation, inspectable delegation</CardTitle>
          <CardDescription>Click a specialist to see how their bounded task appears in the thread.</CardDescription>
        </CardHeader>
        <CardContent className="p-5 sm:p-7">
          <div className="grid items-center gap-5 lg:grid-cols-[180px_44px_1fr_44px_180px]">
            <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 text-center">
              <span className="mx-auto grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground"><Bot className="size-5" /></span>
              <p className="mt-3 text-sm font-medium">Taicho</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Understands, routes, and owns the answer</p>
            </div>
            <div className="hidden items-center lg:flex"><span className="h-px flex-1 bg-border" /><ChevronRight className="size-4 text-muted-foreground" /></div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {SQUAD.map((agent) => {
                const Icon = agent.icon;
                const active = agent.name === activeAgent;
                return (
                  <button
                    className={`rounded-lg border p-3 text-left transition-all ${active ? 'border-primary/40 bg-primary/8 shadow-sm' : 'bg-card hover:bg-accent'}`}
                    key={agent.name}
                    onClick={() => {
                      setActiveAgent(agent.name);
                      setCancelled(false);
                    }}
                    type="button"
                  >
                    <Icon className={`size-4 ${agent.color}`} />
                    <p className="mt-2 text-xs font-medium">{agent.name}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{agent.task}</p>
                  </button>
                );
              })}
            </div>
            <div className="hidden items-center lg:flex"><span className="h-px flex-1 bg-border" /><ChevronRight className="size-4 text-muted-foreground" /></div>
            <div className="rounded-xl border bg-muted/20 p-4 text-center">
              <span className="mx-auto grid size-11 place-items-center rounded-xl border bg-background text-primary"><WandSparkles className="size-5" /></span>
              <p className="mt-3 text-sm font-medium">One synthesis</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Clear answer with named contributions</p>
            </div>
          </div>
          <div className="mt-6 rounded-xl border bg-background/70 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><SelectedIcon className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><p className="text-sm font-medium">{cancelled ? `${selected.name} delegation canceled` : `${selected.name} joined the work`}</p><Badge variant="outline">{cancelled ? 'Canceled safely' : 'Visible delegation'}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">{cancelled ? 'No specialist contribution will be included; Taicho keeps the conversation and any earlier evidence.' : `Task: ${selected.task}. The task, reason, elapsed time, and result remain inspectable.`}</p>
              </div>
              <Button disabled={cancelled} onClick={() => setCancelled(true)} size="sm" variant="ghost"><CircleStop className="size-3.5" /> {cancelled ? 'Canceled' : 'Cancel'}</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0">
        <CardHeader className="border-b p-5"><CardTitle className="text-base">Delegation rules</CardTitle><CardDescription>When a second model is worth the latency.</CardDescription></CardHeader>
        <CardContent className="space-y-4 p-5 text-sm">
          {[
            ['Do not delegate', 'Greetings, simple retrieval, navigation, known-record summaries.'],
            ['Delegate once', 'Research, qualification, mapping, strategy, drafting, or channel adaptation.'],
            ['Run in parallel', 'Independent reads or specialists whose inputs do not depend on each other.'],
            ['Keep Taicho in control', 'Specialists return evidence; Taicho resolves conflicts and speaks to the user.'],
            ['Expose accountability', 'Always show who was asked, why, current status, and what came back.'],
          ].map(([title, text]) => (
            <div className="flex gap-3" key={title}><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="font-medium">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div></div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ToolCatalog() {
  const [selectedId, setSelectedId] = useState(TOOL_GROUPS[0].id);
  const selected = TOOL_GROUPS.find((group) => group.id === selectedId) ?? TOOL_GROUPS[0];
  const Icon = selected.icon;
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid lg:grid-cols-[250px_minmax(0,1fr)]">
        <div className="border-b bg-muted/15 p-3 lg:border-b-0 lg:border-r">
          {TOOL_GROUPS.map((group) => {
            const GroupIcon = group.icon;
            return (
              <button
                className={`mb-1 flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors ${selectedId === group.id ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                key={group.id}
                onClick={() => setSelectedId(group.id)}
                type="button"
              >
                <GroupIcon className={`mt-0.5 size-4 shrink-0 ${group.tone}`} />
                <span><span className="block text-sm font-medium">{group.title}</span><span className="mt-0.5 block text-[11px] leading-4">{group.tools.length} tools</span></span>
              </button>
            );
          })}
        </div>
        <div className="p-5 sm:p-7">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border bg-muted/20"><Icon className={`size-4 ${selected.tone}`} /></span>
            <div><h3 className="font-semibold">{selected.title}</h3><p className="mt-1 text-sm text-muted-foreground">{selected.description}</p></div>
          </div>
          <div className="mt-6 divide-y rounded-xl border">
            {selected.tools.map((tool) => (
              <div className="grid gap-2 p-4 sm:grid-cols-[190px_minmax(0,1fr)_110px] sm:items-center" key={tool.name}>
                <code className="truncate font-mono text-xs text-primary">{tool.name}</code>
                <p className="text-xs leading-5 text-muted-foreground">{tool.purpose}</p>
                <Badge className="w-fit sm:justify-self-end" variant={tool.policy === 'confirmation' ? 'default' : tool.policy === 'conditional' ? 'secondary' : 'outline'}>{tool.policy}</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function ComponentRegistry() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'All' | ComponentCategory>('All');
  const normalizedQuery = query.trim().toLowerCase();
  const components = COMPONENT_CATALOG.filter((component) => {
    const matchesCategory = category === 'All' || component.category === category;
    const matchesQuery = !normalizedQuery || `${component.id} ${component.name} ${component.purpose} ${component.states.join(' ')}`.toLowerCase().includes(normalizedQuery);
    return matchesCategory && matchesQuery;
  });

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b bg-muted/15 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">Canonical component registry</CardTitle>
            <CardDescription className="mt-1">Refer to a component by its exact name or stable ID. IDs do not change when styling changes.</CardDescription>
          </div>
          <div className="relative w-full lg:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search chatbot components" className="pl-9" onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ID, or state…" value={query} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {COMPONENT_CATEGORIES.map((item) => (
            <button
              aria-pressed={category === item}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${category === item ? 'bg-primary text-primary-foreground' : 'border bg-background text-muted-foreground hover:bg-accent hover:text-foreground'}`}
              key={item}
              onClick={() => setCategory(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table containerLabel="Canonical component registry">
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Canonical name</TableHead>
              <TableHead>Family</TableHead>
              <TableHead>Purpose and states</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {components.map((component) => (
              <TableRow data-component-registry-id={component.id} key={component.id}>
                <TableCell><code className="font-mono text-xs font-medium text-primary">{component.id}</code></TableCell>
                <TableCell className="font-medium">{component.name}</TableCell>
                <TableCell><Badge className="w-fit" variant="outline">{component.category}</Badge></TableCell>
                <TableCell className="min-w-80">
                  <p className="text-xs leading-5 text-muted-foreground">{component.purpose}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {component.states.map((state) => <Badge key={state} variant="outline">{state}</Badge>)}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {components.length === 0 && (
              <TableRow>
                <TableCell className="h-24 text-center text-muted-foreground" colSpan={4}>
                  No components match that search.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PerformancePipeline() {
  const stages = [
    { label: 'Optimistic UI', time: '0–100 ms', width: 12 },
    { label: 'Acknowledge', time: '100–250 ms', width: 20 },
    { label: 'Route', time: '250–800 ms', width: 36 },
    { label: 'Local tools', time: '0.8–2.5 s', width: 64 },
    { label: 'Progressive answer', time: 'starts as soon as useful', width: 88 },
  ];
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b bg-muted/15 p-5"><CardTitle className="text-base">Fast-path pipeline</CardTitle><CardDescription>Bookkeeping never blocks the stream. Independent reads begin together.</CardDescription></CardHeader>
      <CardContent className="space-y-4 p-5 sm:p-7">
        {stages.map((stage, index) => (
          <div className="grid gap-2 sm:grid-cols-[145px_minmax(0,1fr)_150px] sm:items-center" key={stage.label}>
            <p className="text-xs font-medium">{stage.label}</p>
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary/75" style={{ width: `${stage.width}%`, opacity: 0.45 + index * 0.12 }} /></div>
            <p className="text-xs tabular-nums text-muted-foreground sm:text-right">{stage.time}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function ChatbotSpecSheet() {
  const [activeSection, setActiveSection] = useState('control-deck');
  const [animationRun, setAnimationRun] = useState(0);
  const [animationsLooping, setAnimationsLooping] = useState(true);
  const [animationsPaused, setAnimationsPaused] = useState(false);
  const completion = useMemo(() => 100, []);

  return (
    <div className="w-full min-w-0 space-y-20 pb-32">
      <header className="relative overflow-hidden rounded-3xl border bg-card px-5 py-10 sm:px-8 lg:px-12 lg:py-14">
        <div className="pointer-events-none absolute -right-24 -top-32 size-80 rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 size-52 rounded-full bg-chart-1/10 blur-3xl" />
        <div className="relative grid gap-10 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-end">
          <div className="max-w-4xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Interactive UI proposal</Badge>
              <Badge variant="outline">Prototype only</Badge>
              <span className="text-xs text-muted-foreground">Live chatbot unchanged</span>
            </div>
            <p className="mt-7 text-xs font-medium uppercase tracking-[0.22em] text-primary">Taicho conversational experience · v2</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em] sm:text-5xl lg:text-6xl">A chatbot that feels alive while it works.</h1>
            <p className="mt-6 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
              This sheet defines the voice, generative surfaces, state choreography, delegation model, tool access, safety boundaries, and speed contract for the rebuilt Taicho chatbot.
            </p>
          </div>
          <Card className="gap-0 border-primary/20 bg-background/70 py-0 backdrop-blur">
            <CardContent className="p-5">
              <div className="flex items-center justify-between"><p className="text-sm font-medium">Specification coverage</p><span className="text-sm font-semibold tabular-nums">{completion}%</span></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Specification coverage" aria-valuemax={100} aria-valuemin={0} aria-valuenow={completion}>
                <div className="h-full rounded-full bg-primary" style={{ width: `${completion}%` }} />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg border bg-card p-3"><p className="text-muted-foreground">Named components</p><p className="mt-1 text-lg font-semibold tabular-nums">{COMPONENT_CATALOG.length}</p></div>
                <div className="rounded-lg border bg-card p-3"><p className="text-muted-foreground">Live surfaces</p><p className="mt-1 text-lg font-semibold tabular-nums">{SURFACES.length}</p></div>
                <div className="rounded-lg border bg-card p-3"><p className="text-muted-foreground">Tool families</p><p className="mt-1 text-lg font-semibold tabular-nums">{TOOL_GROUPS.length}</p></div>
                <div className="rounded-lg border bg-card p-3"><p className="text-muted-foreground">Perf budgets</p><p className="mt-1 text-lg font-semibold tabular-nums">{PERFORMANCE_BUDGETS.length}</p></div>
              </div>
            </CardContent>
          </Card>
        </div>
      </header>

      <nav className="sticky top-[72px] z-20 -mx-1 overflow-x-auto rounded-xl border bg-background/90 p-1 shadow-sm backdrop-blur md:top-4" aria-label="Chatbot specification sections">
        <div className="flex min-w-max items-center gap-1">
          {NAV_ITEMS.map(([id, label]) => (
            <a
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${activeSection === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
              href={`#${id}`}
              key={id}
              onClick={() => setActiveSection(id)}
            >
              {label}
            </a>
          ))}
          <span className="ml-auto flex items-center gap-1.5 px-3 text-xs text-muted-foreground"><LockKeyhole className="size-3" /> Approval gate before implementation</span>
        </div>
      </nav>

      <section className="scroll-mt-28 space-y-7" id="control-deck">
        <SectionHeading
          eyebrow="Interactive control surface"
          title="The composer finally reflects what Taicho can do"
          description="Open every control, change the operating policy, attach context, launch a service-aware starter, and inspect the working, approval, and completion states. This is a UI-only prototype; no production tools are invoked."
        />
        <ControlDeckPrototype />
      </section>

      <section className="space-y-7" aria-labelledby="decisions-heading">
        <SectionHeading eyebrow="Product decisions" title="The non-negotiable experience" description="Six decisions keep the chatbot coherent even when many models, tools, and data sources are working underneath it." />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {DECISIONS.map((decision) => {
            const Icon = decision.icon;
            return (
              <Card className="gap-0 py-0" key={decision.title}><CardContent className="flex gap-4 p-5"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span><div><p className="text-sm font-medium">{decision.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{decision.text}</p></div></CardContent></Card>
            );
          })}
        </div>
      </section>

      <section className="scroll-mt-28 space-y-7" id="runtime">
        <SectionHeading eyebrow="Generative runtime" title="The cards are renderers; the RLM drives the experience" description="No result card appears because a timer guessed that it should. In production, the RLM and tools emit schema-validated semantic events. Those events select a named component and advance its state; the UI runtime performs the corresponding motion immediately and consistently." />
        <Card className="gap-0 overflow-hidden border-primary/20 py-0">
          <CardHeader className="border-b bg-primary/5 p-5 sm:p-6"><CardTitle className="text-base">Runtime event pipeline</CardTitle><CardDescription>Generated meaning flows left to right. Presentation never waits for the RLM to invent markup or CSS.</CardDescription></CardHeader>
          <CardContent className="p-5 sm:p-7">
            <div className="grid gap-2 lg:grid-cols-[1fr_28px_1fr_28px_1fr_28px_1fr_28px_1fr] lg:items-center">
              {[
                ['RLM decision', 'intent, tool, delegate, answer', BrainCircuit],
                ['Semantic event', 'typed name + validated payload', Zap],
                ['State reducer', 'current state → next state', Workflow],
                ['Named renderer', 'DATA-01 · Prospect Result Card', Layers3],
                ['Motion preset', 'enter → active → settle', Activity],
              ].map(([title, text, Icon], index) => (
                <div className="contents" key={String(title)}>
                  <div className="h-full rounded-xl border bg-background/70 p-4">
                    <Icon className="size-4 text-primary" />
                    <p className="mt-3 text-sm font-medium">{String(title)}</p>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{String(text)}</p>
                  </div>
                  {index < 4 && <ChevronRight className="mx-auto hidden size-4 text-muted-foreground lg:block" />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <div className="grid gap-4 lg:grid-cols-4">
          {[
            ['RLM owns', 'Intent, plan, tool choice, delegation, wording, synthesis, uncertainty, and suggested next actions.', BrainCircuit],
            ['Tools own', 'Factual progress, partial records, search matches, source retrieval, execution results, and errors.', Search],
            ['UI runtime owns', 'Component selection from the event schema, state reduction, animation curves, layout stability, and accessibility.', WandSparkles],
            ['Policy owns', 'Permissions, schema validation, confirmation boundaries, redaction, cancellation, and audit records.', ShieldCheck],
          ].map(([title, text, Icon]) => <Card className="gap-0 py-0" key={String(title)}><CardContent className="p-5"><Icon className="size-4 text-primary" /><p className="mt-3 text-sm font-medium">{String(title)}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{String(text)}</p></CardContent></Card>)}
        </div>
        <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm leading-6">
          <strong>Important:</strong> this standalone sheet uses a mock semantic event script so the flow is reviewable without touching the production chatbot. The approved implementation replaces the mock emitter with the real RLM/tool stream; the event reducer and named renderers remain the same.
        </div>
      </section>

      <section className="scroll-mt-28 space-y-7" id="experience">
        <SectionHeading eyebrow="Canonical experience" title="No blank wait, no mysterious spinner" description="Play the mock RLM event stream or select any state. Each semantic event advances named components, with user-facing copy, a performance target, and a deterministic motion contract." />
        <ExperienceDemo key={`experience-${animationRun}`} looping={animationsLooping} paused={animationsPaused} />
      </section>

      <section className="scroll-mt-28 space-y-7" id="streaming">
        <SectionHeading
          eyebrow="Message lifecycle"
          title="One atomic operation: thinking becomes the answer, in place"
          description="CHAT-04 Assistant Message Block treats inference and writing as one operation in one place. WORK-07 Inference Ticker shows a dim summary of live thinking in the exact space the answer will fill; the first tokens replace it in place — no jump, no second location. Then the block settles into a durable record: receipt, sources, next actions. Select a state or let it play."
        />
        <StreamingMessageBlock key={`streaming-${animationRun}`} looping={animationsLooping} paused={animationsPaused} />
      </section>

      <section className="space-y-7">
        <SectionHeading eyebrow="Saying and thinking" title="Show useful reasoning, protect private reasoning" description="The interface should make Taicho legible without dumping raw chain-of-thought, hidden prompts, or internal tokens into the conversation." />
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="gap-0 py-0"><CardHeader className="border-b p-5"><div className="flex items-center gap-2"><MessageSquareText className="size-4 text-primary" /><CardTitle className="text-base">What Taicho says</CardTitle></div></CardHeader><CardContent className="space-y-3 p-5 text-sm leading-6"><p>“I’ll check your workspace first.”</p><p>“I found one matching prospect.”</p><p>“Scout is verifying the current company context.”</p><p className="text-muted-foreground">Short, natural, outcome-oriented language.</p></CardContent></Card>
          <Card className="gap-0 border-primary/20 py-0"><CardHeader className="border-b bg-primary/5 p-5"><div className="flex items-center gap-2"><BrainCircuit className="size-4 text-primary" /><CardTitle className="text-base">Visible reasoning summary</CardTitle></div></CardHeader><CardContent className="space-y-3 p-5 text-sm leading-6"><p>Intent and scope</p><p>Plan and active step</p><p>Tools, sources, and delegated owner</p><p>Evidence quality, uncertainty, and conflicts</p><p className="text-muted-foreground">Enough to trust and steer the work.</p></CardContent></Card>
          <Card className="gap-0 py-0"><CardHeader className="border-b p-5"><div className="flex items-center gap-2"><LockKeyhole className="size-4 text-muted-foreground" /><CardTitle className="text-base">What stays private</CardTitle></div></CardHeader><CardContent className="space-y-3 p-5 text-sm leading-6"><p>Raw chain-of-thought</p><p>Hidden system and specialist prompts</p><p>Credentials, internal identifiers, and security rules</p><p>Verbose token-by-token deliberation</p><p className="text-muted-foreground">Privacy improves clarity as well as safety.</p></CardContent></Card>
        </div>
      </section>

      <section className="scroll-mt-28 space-y-7" id="surfaces">
        <SectionHeading eyebrow="Generative UI inventory" title="The surfaces the chatbot can compose" description="These are not decorative cards. Each surface has a clear job, appears only when useful, animates during work, and settles into a compact conversational record." />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {SURFACES.map((surface) => <SurfacePreview key={`${surface.id}-${animationRun}`} looping={animationsLooping} paused={animationsPaused} surface={surface} />)}
        </div>
      </section>

      <section className="scroll-mt-28 space-y-7" id="registry">
        <SectionHeading eyebrow="Naming system" title="Every component has one canonical name" description="Use the exact name or ID in feedback—for example, “make WORK-02 Activity Rail quieter” or “refine DATA-03 Article Result Card.” The registry also defines every supported state so feedback stays precise." />
        <ComponentRegistry />
      </section>

      <section className="scroll-mt-28 space-y-7" id="delegation">
        <SectionHeading eyebrow="Delegation model" title="Specialists join the work, not the conversation" description="The user never has to manage six chatbots. Taicho delegates bounded tasks, exposes who is working and why, then synthesizes one answer." />
        <DelegationDiagram />
      </section>

      <section className="scroll-mt-28 space-y-7" id="tools">
        <SectionHeading eyebrow="Tool exposure" title="A deliberate tool belt, not a grab bag" description="Read tools are fast and automatic. Current-web tools are conditional. Consequential workspace actions always show a preview and wait for confirmation." />
        <ToolCatalog />
      </section>

      <section className="scroll-mt-28 space-y-7" id="performance">
        <SectionHeading eyebrow="Peak performance" title="Speed is part of the interface contract" description="The rebuild should optimize time-to-useful-state, not only total completion time. Routing, data access, model work, and bookkeeping are measured separately." />
        <PerformancePipeline />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PERFORMANCE_BUDGETS.map((budget) => (
            <Card className="gap-0 py-0" key={budget.metric}><CardContent className="p-5"><div className="flex items-center justify-between gap-3"><p className="text-xs font-medium text-muted-foreground">{budget.metric}</p><Gauge className="size-4 text-primary" /></div><p className="mt-3 text-lg font-semibold tracking-tight tabular-nums">{budget.target}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{budget.meaning}</p></CardContent></Card>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="gap-0 py-0"><CardHeader className="border-b p-5"><CardTitle className="text-base">Runtime rules</CardTitle><CardDescription>How the system earns those budgets.</CardDescription></CardHeader><CardContent className="grid gap-3 p-5 text-sm sm:grid-cols-2">{[
            'Return the stream before billing settlement and analytics writes.',
            'Use a fast router for intent and simple tool selection.',
            'Run independent read tools concurrently.',
            'Render partial results instead of awaiting a full bundle.',
            'Use selective context plus a conversation summary, not an unbounded transcript.',
            'Skip specialist models for direct retrieval and simple summaries.',
            'Cache stable entity summaries and tool schemas.',
            'Propagate cancellation through models, tools, and delegates.',
          ].map((rule) => <div className="flex gap-2" key={rule}><Zap className="mt-0.5 size-3.5 shrink-0 text-primary" /><p className="text-xs leading-5 text-muted-foreground">{rule}</p></div>)}</CardContent></Card>
          <Card className="gap-0 py-0"><CardHeader className="border-b p-5"><CardTitle className="text-base">Observability gates</CardTitle><CardDescription>Ship only when the experience can be measured.</CardDescription></CardHeader><CardContent className="space-y-3 p-5">{[
            ['TTACK', 'request → visible acknowledgement'],
            ['TTFT', 'request → first model text or tool call'],
            ['TTLR', 'request → first usable local result'],
            ['TTWA', 'request → first web article/source'],
            ['Delegation tax', 'router result → specialist first signal'],
            ['Dead-air windows', 'any interval with no useful visible change'],
          ].map(([metric, meaning]) => <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2" key={metric}><code className="font-mono text-xs text-primary">{metric}</code><p className="text-right text-xs text-muted-foreground">{meaning}</p></div>)}</CardContent></Card>
        </div>
      </section>

      <section className="space-y-7">
        <SectionHeading eyebrow="Failure and interruption" title="Partial success survives failure" description="A failed source should not erase useful work. Recovery happens at the failed segment, and the user can interrupt, redirect, or cancel at any point." />
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="gap-0 py-0"><CardContent className="p-5"><div className="flex items-center gap-2"><CircleStop className="size-4 text-primary" /><p className="text-sm font-medium">User stops work</p></div><p className="mt-3 text-xs leading-5 text-muted-foreground">Cancel returns in under 150 ms, keeps results already received, and offers “Continue from here”.</p></CardContent></Card>
          <Card className="gap-0 py-0"><CardContent className="p-5"><div className="flex items-center gap-2"><RefreshCw className="size-4 text-amber-300" /><p className="text-sm font-medium">One tool fails</p></div><p className="mt-3 text-xs leading-5 text-muted-foreground">The failed row names the dependency. Other results remain visible; retry affects only that row.</p></CardContent></Card>
          <Card className="gap-0 py-0"><CardContent className="p-5"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-emerald-300" /><p className="text-sm font-medium">Action needs approval</p></div><p className="mt-3 text-xs leading-5 text-muted-foreground">The chatbot pauses with an exact preview, destination, consequence, and editable fields before executing.</p></CardContent></Card>
        </div>
      </section>

      <section className="scroll-mt-28 space-y-7" id="contract">
        <SectionHeading eyebrow="Implementation contract" title="A stream of semantic events, not UI-shaped strings" description="The frontend renders stable event types. Models and tools emit meaning; components own presentation and animation." />
        <Card className="gap-0 overflow-hidden py-0">
          <Table className="min-w-[760px]" containerLabel="Semantic event contract">
            <TableHeader>
              <TableRow><TableHead>Event</TableHead><TableHead>Payload</TableHead><TableHead>Renderer</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {EVENT_CONTRACT.map((row) => (
                <TableRow key={row.event}>
                  <TableCell><code className="font-mono text-xs text-primary">{row.event}</code></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.payload}</TableCell>
                  <TableCell className="text-xs">{row.renderer}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>

      <section className="space-y-7">
        <SectionHeading eyebrow="Motion and accessibility" title="Fluid does not mean frantic" description="Motion explains state change. It never delays content, shifts the reading position, or becomes the only way status is communicated." />
        <div className="grid gap-4 lg:grid-cols-4">
          {[
            ['Entry', '160–220 ms fade with at most 4 px vertical travel.'],
            ['Progress', 'Soft pulse or scan only on the single active element.'],
            ['Settlement', 'Active state resolves in place; completed work compresses.'],
            ['Reduced motion', 'No travel, ping, pulse, or auto-play when the OS requests reduction.'],
            ['Screen readers', 'Polite announcements for progress; assertive only for blocking errors.'],
            ['Keyboard', 'Composer keeps focus; every card action and disclosure is reachable.'],
            ['Contrast', 'Status always pairs color with icon, label, or explicit text.'],
            ['Stability', 'Reserve geometry for cards; cumulative layout shift target < 0.05.'],
          ].map(([title, text]) => <Card className="gap-0 py-0" key={title}><CardContent className="p-5"><p className="text-sm font-medium">{title}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{text}</p></CardContent></Card>)}
        </div>
      </section>

      <footer className="rounded-2xl border border-primary/25 bg-primary/5 p-6 sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><Workflow className="size-5" /></span>
          <div className="min-w-0 flex-1"><p className="text-lg font-semibold">UI review checkpoint</p><p className="mt-1 text-sm leading-6 text-muted-foreground">The complete control surface is interactive in this standalone specification. The production chatbot runtime, tools, prompts, and permissions remain unchanged until this UI is approved.</p></div>
          <Badge variant="outline">UI prototype ready</Badge>
        </div>
      </footer>

      <GlobalAnimationControls
        looping={animationsLooping}
        onLoopChange={setAnimationsLooping}
        onPauseChange={setAnimationsPaused}
        onReplay={() => {
          setAnimationsPaused(false);
          setAnimationRun((current) => current + 1);
        }}
        paused={animationsPaused}
      />
    </div>
  );
}
