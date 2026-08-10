'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  GitMerge,
  Route,
  ShieldCheck,
  Sparkles,
  UserRoundSearch,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const STEPS = [
  {
    key: 'scout', name: 'Scout', role: 'Prospect research', icon: UserRoundSearch,
    enter: 1, update: 2, complete: 3,
    activeCopy: 'Searching prospects, notes, and relationship history',
    updateCopy: 'One identity match. Loading two prior touchpoints.',
    completeCopy: 'Aisha confirmed · current role verified',
    stream: ['Searching workspace prospects for “Aisha Rahman”…', 'Match: Aisha Rahman · Northstar Labs', 'Relationship: 2 prior touchpoints · last reply 18 days ago', 'Current context: role confirmed from 3 sources'],
    accent: 'sky',
  },
  {
    key: 'gatekeeper', name: 'Gatekeeper', role: 'Fit assessment', icon: ShieldCheck,
    enter: 3, update: 4, complete: 5,
    activeCopy: 'Reading Scout’s evidence and active personas',
    updateCopy: 'Strong operator fit. Scoring pain, authority, and timing.',
    completeCopy: 'Qualified · 84/100 fit',
    stream: ['Loading Scout’s evidence packet…', 'Persona match: Operator · strong', 'Pain signal: approval workflow reliability', 'Qualification: 84/100 · recommend follow-up'],
    accent: 'amber',
  },
  {
    key: 'cartographer', name: 'Cartographer', role: 'Knowledge mapping', icon: BrainCircuit,
    enter: 5, update: 6, complete: 7,
    activeCopy: 'Connecting the prospect to topics and evidence',
    updateCopy: 'Four useful topic clusters. One evidence gap detected.',
    completeCopy: 'Context mapped · gap flagged',
    stream: ['Mapping prospect evidence into the Brain…', 'Connected: AI operations · human approvals · reliability', 'Evidence: 4 topic links · 3 current sources', 'Gap flagged: failure-recovery proof is thin'],
    accent: 'violet',
  },
] as const;

const EVENTS = [
  ['delegation.plan.created', 'Taicho', 'Three dependent tasks routed'],
  ['delegation.started', 'Scout', 'Searching workspace and current sources'],
  ['delegation.progress', 'Scout', 'Identity match found; history loading'],
  ['delegation.completed', 'Scout', 'Evidence packet handed to Gatekeeper'],
  ['delegation.progress', 'Gatekeeper', 'Fit score resolving against Operator persona'],
  ['delegation.completed', 'Gatekeeper', '84/100 qualification handed forward'],
  ['delegation.progress', 'Cartographer', 'Mapping topics, proof, and gaps'],
  ['delegation.completed', 'Cartographer', 'Context packet returned to Taicho'],
  ['synthesis.completed', 'Taicho', 'One evidence-grounded answer ready'],
] as const;

const TONES = {
  sky: { icon: 'text-sky-300', border: 'border-sky-300/25', glow: 'bg-sky-300', wash: 'bg-sky-300/5' },
  amber: { icon: 'text-amber-300', border: 'border-amber-300/25', glow: 'bg-amber-300', wash: 'bg-amber-300/5' },
  violet: { icon: 'text-violet-300', border: 'border-violet-300/25', glow: 'bg-violet-300', wash: 'bg-violet-300/5' },
} as const;

function TokenStreamLine({ text, streaming, paused }: { text: string; streaming: boolean; paused: boolean }) {
  const [visibleLength, setVisibleLength] = useState(streaming ? 0 : text.length);

  useEffect(() => {
    if (!streaming || paused || visibleLength >= text.length) return;
    const timer = window.setTimeout(() => setVisibleLength((current) => Math.min(text.length, current + 2)), 22);
    return () => window.clearTimeout(timer);
  }, [paused, streaming, text, visibleLength]);

  return <>{text.slice(0, visibleLength)}{streaming && visibleLength < text.length && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-current align-middle motion-reduce:animate-none" />}</>;
}

type DelegationStep = (typeof STEPS)[number];

function SpecialistStreamDrawer({ step, updating, complete, paused, stage }: { step: DelegationStep; updating: boolean; complete: boolean; paused: boolean; stage: number }) {
  const [expanded, setExpanded] = useState(false);
  const visibleLineCount = complete ? step.stream.length : updating ? Math.min(3, step.stream.length) : 1;
  const lines = step.stream.slice(0, visibleLineCount);
  const latestLine = lines.at(-1) ?? step.stream[0];

  return (
    <div className="border-t bg-black/10" data-component="AGENT-06 Specialist Stream Drawer">
      <button aria-expanded={expanded} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.025]" onClick={() => setExpanded((current) => !current)} type="button">
        <span className="relative flex size-2 shrink-0"><span className={`absolute inline-flex size-full rounded-full ${complete ? 'bg-emerald-300/40' : 'animate-ping bg-primary/50 motion-reduce:animate-none'}`} /><span className={`relative inline-flex size-2 rounded-full ${complete ? 'bg-emerald-300' : 'bg-primary'}`} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><code className="font-mono text-[9px] text-primary">delegation.output.delta</code><span className="text-[9px] text-muted-foreground">{visibleLineCount} update{visibleLineCount === 1 ? '' : 's'}</span></div>
          {!expanded && <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" key={`${step.key}-${stage}-${latestLine}`}><TokenStreamLine paused={paused} streaming={!complete} text={latestLine} /></p>}
        </div>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">{expanded ? 'Hide output' : 'View stream'}<ChevronDown className={`size-3 transition-transform ${expanded ? 'rotate-180' : ''}`} /></span>
      </button>
      <div className={`grid transition-[grid-template-rows] duration-300 ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="space-y-1 border-t border-dashed px-4 py-3 font-mono text-[10px] leading-5 text-muted-foreground">
            {lines.map((line, index) => {
              const isLatest = index === lines.length - 1;
              return <div className="flex items-start gap-2" key={line}><span className={`mt-[7px] size-1 shrink-0 rounded-full ${isLatest && !complete ? 'animate-pulse bg-primary motion-reduce:animate-none' : 'bg-muted-foreground/40'}`} /><span className={isLatest ? 'text-foreground/85' : ''}><TokenStreamLine key={`${line}-${stage}-${isLatest}`} paused={paused} streaming={isLatest && !complete} text={line} /></span></div>;
            })}
            <p className="pt-1 font-sans text-[10px] text-muted-foreground/60">Visible work output only · private chain-of-thought is never exposed</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DelegationRunwayPreview({ active, paused }: { active: boolean; paused: boolean }) {
  const [stage, setStage] = useState(active ? 0 : 8);

  useEffect(() => {
    if (!active || paused || stage >= 8) return;
    const timer = window.setTimeout(() => setStage((current) => Math.min(8, current + 1)), 850);
    return () => window.clearTimeout(timer);
  }, [active, paused, stage]);

  const latestEvent = Math.min(stage, EVENTS.length - 1);
  const activeOwner = stage < 3 ? 'Scout streaming' : stage < 5 ? 'Gatekeeper streaming' : stage < 7 ? 'Cartographer streaming' : stage < 8 ? 'Taicho synthesizing' : 'Synthesis ready';

  return (
    <div className="overflow-hidden rounded-2xl border border-primary/20 bg-[radial-gradient(circle_at_20%_0%,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_40%),var(--card)]" data-testid="delegation-runway">
      <div className="flex flex-col gap-3 border-b bg-background/45 px-5 py-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Route className="size-4" />
            {active && stage < 8 && !paused && <span className="absolute -right-1 -top-1 size-3 animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />}
          </span>
          <div><p className="text-sm font-semibold">Delegation runway</p><p className="mt-0.5 text-xs text-muted-foreground">Taicho routes dependent work and keeps one conversational voice</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Badge variant="outline">Linear plan</Badge>
          <Badge variant="outline">3 specialists</Badge>
          <Badge variant={stage >= 8 ? 'default' : 'secondary'}>{paused ? 'Paused' : activeOwner}</Badge>
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_310px]">
        <div className="relative p-5 sm:p-7">
          <div className="absolute bottom-9 left-[44px] top-10 w-px bg-border sm:left-[58px]">
            <span className="absolute inset-x-0 top-0 h-full bg-gradient-to-b from-primary/60 via-sky-300/30 to-emerald-300/50" />
          </div>

          <div className="relative mb-4 flex items-center gap-4">
            <span className="z-10 grid size-10 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary text-primary-foreground shadow-lg shadow-primary/15"><Bot className="size-4" /></span>
            <div className="min-w-0 flex-1 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">Taicho decomposes the request</p><Badge variant="outline">Coordinator</Badge></div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Find Aisha → verify the relationship → qualify the opportunity → map relevant context → synthesize one answer.</p>
            </div>
          </div>

          <div className="space-y-3">
            {STEPS.map((step, index) => {
              const visible = stage >= step.enter;
              const updating = stage >= step.update;
              const complete = stage >= step.complete;
              const isCurrent = visible && !complete && stage < step.complete;
              const tone = TONES[step.accent];
              const Icon = step.icon;
              return (
                <div
                  className={`relative flex origin-top items-start gap-4 overflow-hidden transition-[max-height,opacity,transform] duration-500 motion-reduce:transition-none ${visible ? 'max-h-64 translate-y-0 opacity-100' : 'max-h-0 -translate-y-4 opacity-0'}`}
                  data-component="AGENT-02 Specialist Status Row"
                  key={step.key}
                  style={{ transitionDelay: visible ? `${index * 80}ms` : '0ms' }}
                >
                  <span className={`z-10 grid size-10 shrink-0 place-items-center rounded-full border bg-background transition-all duration-500 ${complete ? `${tone.border} ${tone.icon}` : isCurrent ? `${tone.border} ${tone.icon} shadow-[0_0_24px_color-mix(in_oklab,currentColor_28%,transparent)]` : 'text-muted-foreground'}`}>
                    {complete ? <Check className="size-4" /> : <Icon className={`size-4 ${isCurrent ? 'animate-pulse motion-reduce:animate-none' : ''}`} />}
                  </span>
                  <div className={`min-w-0 flex-1 overflow-hidden rounded-xl border transition-colors duration-500 ${isCurrent ? `${tone.border} ${tone.wash}` : complete ? 'border-border bg-background/55' : 'border-border bg-muted/15'}`}>
                    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{step.name}</p><span className="text-xs text-muted-foreground">{step.role}</span></div>
                        <p className="mt-1 min-h-5 text-xs text-muted-foreground" key={`${step.key}-${stage}`}>{complete ? step.completeCopy : updating ? step.updateCopy : step.activeCopy}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {isCurrent && <Activity className={`size-3.5 animate-pulse ${tone.icon} motion-reduce:animate-none`} />}
                        <Badge variant={complete ? 'outline' : 'secondary'}>{complete ? 'Delivered' : 'Streaming'}</Badge>
                      </div>
                    </div>

                    {visible && <SpecialistStreamDrawer complete={complete} paused={paused} stage={stage} step={step} updating={updating} />}
                  </div>
                </div>
              );
            })}
          </div>

          <div className={`relative flex items-start gap-4 overflow-hidden transition-[max-height,margin,opacity,transform] duration-500 ${stage >= 7 ? 'mt-4 max-h-56 translate-y-0 opacity-100' : 'mt-0 max-h-0 -translate-y-3 opacity-0'}`} data-component="AGENT-04 Synthesis Handoff">
            <span className="z-10 grid size-10 shrink-0 place-items-center rounded-full border border-emerald-300/30 bg-emerald-300/10 text-emerald-300"><GitMerge className={`size-4 ${stage === 7 ? 'animate-pulse motion-reduce:animate-none' : ''}`} /></span>
            <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-emerald-300/25 bg-emerald-300/5">
              <div className="flex items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1"><p className="text-sm font-semibold">Taicho synthesis</p><p className="mt-1 text-xs text-muted-foreground">{stage >= 8 ? 'Three specialist packets resolved into one answer.' : 'Reconciling evidence, confidence, and the best next action.'}</p></div>{stage >= 8 ? <Badge>Ready</Badge> : <Sparkles className="size-4 animate-pulse text-emerald-300 motion-reduce:animate-none" />}</div>
              {stage >= 8 && <div className="animate-in fade-in slide-in-from-bottom-1 border-t px-4 py-3 text-xs leading-5 duration-500 motion-reduce:animate-none"><strong>Answer ready:</strong> Aisha is a qualified prospect with a strong AI-operations fit. Your last conversation concerned approval workflows; the best next step is a reliability-focused follow-up.</div>}
            </div>
          </div>
        </div>

        <aside className="border-t bg-background/35 p-4 xl:border-l xl:border-t-0">
          <div className="flex items-center justify-between"><div><p className="text-xs font-medium">Live coordination feed</p><p className="mt-0.5 text-[10px] text-muted-foreground">Semantic events from RLM and specialists</p></div><span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-50 motion-reduce:animate-none" /><span className="relative inline-flex size-2 rounded-full bg-primary" /></span></div>
          <div className="mt-4 space-y-2">
            {EVENTS.slice(0, latestEvent + 1).map(([event, owner, update], index) => {
              const latest = index === latestEvent;
              return (
                <div className={`animate-in fade-in slide-in-from-right-2 rounded-lg border px-3 py-2.5 duration-300 motion-reduce:animate-none ${latest ? 'border-primary/30 bg-primary/7' : 'bg-background/45'}`} key={`${event}-${index}`}>
                  <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate font-mono text-[9px] text-primary">{event}</code><span className="text-[9px] text-muted-foreground">{owner}</span></div>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{update}</p>
                </div>
              );
            })}
          </div>
          <div className={`mt-4 overflow-hidden rounded-lg border transition-colors ${stage >= 8 ? 'border-emerald-300/25 bg-emerald-300/5' : 'bg-muted/15'}`}>
            <div className="flex items-center gap-2 px-3 py-2"><ChevronDown className="size-3 text-muted-foreground" /><p className="text-[10px] font-medium">Contribution packet</p></div>
            <div className="grid grid-cols-3 border-t text-center text-[10px]">
              {STEPS.map((step) => <div className="border-r px-1 py-2 last:border-r-0" key={step.key}><p className="font-semibold tabular-nums">{stage >= step.complete ? '✓' : '—'}</p><p className="mt-0.5 text-muted-foreground">{step.name}</p></div>)}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
