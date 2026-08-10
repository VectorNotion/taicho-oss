'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bot, BrainCircuit, CheckCircle2, FileText, RefreshCw, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ComponentTag, InferenceTicker } from './spec-primitives';

type StreamPhase = 'starting' | 'thinking' | 'streaming' | 'complete' | 'error';

const PHASE_PILLS: Array<{ id: StreamPhase; label: string }> = [
  { id: 'starting', label: 'Starting' },
  { id: 'thinking', label: 'Thinking' },
  { id: 'streaming', label: 'Streaming' },
  { id: 'complete', label: 'Complete' },
  { id: 'error', label: 'Interrupted' },
];

const THINKING_STEPS = [
  'Reading run #48 — 24 frames, 412k simulated impressions',
  'Comparing hook variants across every audience frame — “ship fast” beats the cost angle by 31% overall, and the gap widens to 44% in the operator-heavy frames where most of the reach lives',
  'Checking the claim against the run report before quoting it',
  'Structuring: prospect with the number, close on the pull request',
];

const ANSWER =
  'Here is the launch post draft. Last week’s resonance run simulated 412,000 impressions across 24 audience frames — the “ship fast” hook outperformed the cost angle by 31%. The draft below prospects with that number, keeps your plain-spoken voice, and ends on the open-source pull request.';

const WORDS = ANSWER.split(' ');
const ERROR_CUTOFF = Math.floor(WORDS.length * 0.45);

const CONTRACT: Array<{ phase: StreamPhase; rule: string }> = [
  { phase: 'starting', rule: 'The block reserves its geometry and acknowledges within 250 ms. No spinner, no layout shift when inference begins.' },
  { phase: 'thinking', rule: 'A dim mono inference ticker occupies the exact space the answer will fill — summaries of live inference, never raw chain-of-thought. Long thoughts never grow the block: the window is bottom-anchored, the newest text stays visible, and overflow fades out the top.' },
  { phase: 'streaming', rule: 'The first tokens replace the ticker in place; the ticker compresses to a one-line receipt. Text streams behind a caret. Stop is always available.' },
  { phase: 'complete', rule: 'The caret disappears, work compresses to a receipt, sources attach, and suggested actions slide in — one settle motion, 300 ms.' },
  { phase: 'error', rule: 'The stream freezes in place. Everything already streamed is kept and selectable; the recovery strip offers one retry.' },
];

export function StreamingMessageBlock({ looping, paused }: { looping: boolean; paused: boolean }) {
  const [phase, setPhase] = useState<StreamPhase>('starting');
  const [thinkStep, setThinkStep] = useState(0);
  const [wordCount, setWordCount] = useState(0);

  useEffect(() => {
    if (paused) return;
    if (phase === 'starting') {
      const t = setTimeout(() => setPhase('thinking'), 600);
      return () => clearTimeout(t);
    }
    if (phase === 'thinking') {
      if (thinkStep >= THINKING_STEPS.length) {
        setPhase('streaming');
        return;
      }
      const t = setTimeout(() => setThinkStep((step) => step + 1), 850);
      return () => clearTimeout(t);
    }
    if (phase === 'streaming') {
      if (wordCount >= WORDS.length) {
        setPhase('complete');
        return;
      }
      const t = setTimeout(() => setWordCount((count) => count + 1), 60);
      return () => clearTimeout(t);
    }
    if (phase === 'complete' && looping) {
      const t = setTimeout(() => {
        setThinkStep(0);
        setWordCount(0);
        setPhase('starting');
      }, 4200);
      return () => clearTimeout(t);
    }
  }, [phase, thinkStep, wordCount, paused, looping]);

  const selectPhase = (next: StreamPhase) => {
    setPhase(next);
    if (next === 'starting' || next === 'thinking') {
      setThinkStep(0);
      setWordCount(0);
    }
    if (next === 'streaming') {
      setThinkStep(THINKING_STEPS.length);
      setWordCount(0);
    }
    if (next === 'complete') {
      setThinkStep(THINKING_STEPS.length);
      setWordCount(WORDS.length);
    }
    if (next === 'error') {
      setThinkStep(THINKING_STEPS.length);
      setWordCount(ERROR_CUTOFF);
    }
  };

  const replay = () => selectPhase('starting');

  const streamedText = useMemo(() => WORDS.slice(0, wordCount).join(' '), [wordCount]);
  const streaming = phase === 'streaming';
  const thinking = phase === 'thinking';
  const settled = phase === 'complete';
  const answering = streaming || settled || phase === 'error';

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="gap-0 overflow-hidden py-0">
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="flex justify-end">
            <div className="max-w-md space-y-1.5 text-right">
              <ComponentTag id="CHAT-03" name="User Message Bubble" />
              <div className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-left text-sm leading-6 text-primary-foreground">
                Draft the resonance scorer launch post and pull the numbers from last week’s run.
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <ComponentTag id="CHAT-04" name="Assistant Message Block" />
            <div className={`rounded-2xl rounded-bl-md border p-4 transition-colors ${streaming || thinking ? 'border-primary/25 bg-primary/5' : 'bg-background/70'}`}>
              <div className="flex items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><Bot className="size-3.5" /></span>
                {(phase === 'starting' || thinking) && (
                  <span className="relative flex size-2.5 items-center justify-center" aria-hidden>
                    <span className="absolute size-2.5 animate-ping rounded-full bg-primary/40 motion-reduce:animate-none" />
                    <span className="size-1.5 rounded-full bg-primary" />
                  </span>
                )}
                <p className="text-xs text-muted-foreground">
                  {phase === 'starting' ? 'Pulling last week’s resonance run…' : thinking ? 'Thinking' : streaming ? 'Writing from run evidence' : settled ? 'Answered from 3 sources' : 'Stream interrupted'}
                </p>
              </div>

              {/* One shared slot: the inference ticker and the answer occupy the SAME geometry —
                  the reveal happens in place, never in a second location. */}
              <div className="mt-3 min-h-28">
                {thinking && (
                  <div className="space-y-1.5 animate-in fade-in duration-200 motion-reduce:animate-none">
                    <ComponentTag id="WORK-07" name="Inference Ticker" />
                    <InferenceTicker lines={THINKING_STEPS.slice(0, Math.max(thinkStep, 1))} windowClass="max-h-16" />
                  </div>
                )}

                {answering && (
                  <div className="space-y-1.5 animate-in fade-in duration-200 motion-reduce:animate-none">
                    <button className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70 transition-colors hover:text-muted-foreground" type="button">
                      <BrainCircuit className="size-3" /> Thought for {THINKING_STEPS.length} steps · run #48
                    </button>
                    <ComponentTag id="RESP-01" name="Answer Stream" />
                    <p className="text-sm leading-6">
                      {streaming || phase === 'error' ? streamedText : ANSWER}
                      {streaming && <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-primary align-text-bottom motion-reduce:animate-none" aria-hidden />}
                    </p>
                  </div>
                )}
              </div>

              {phase === 'error' && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-2.5 animate-in fade-in duration-200 motion-reduce:animate-none">
                  <p className="flex items-center gap-2 text-xs"><TriangleAlert className="size-3.5 text-destructive" /> Stream interrupted — the draft so far is kept.</p>
                  <Button className="h-7 text-xs" onClick={() => setPhase('streaming')} size="sm" variant="outline"><RefreshCw className="size-3" /> Retry</Button>
                </div>
              )}

              {settled && (
                <div className="mt-4 space-y-3 border-t pt-3 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
                  <div className="flex flex-wrap items-center gap-2">
                    <ComponentTag id="WORK-05" name="Work Receipt" />
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="size-3.5 text-primary" /> 2 tools · 3 sources · resonance run #48</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ComponentTag id="DATA-06" name="Source Chip" />
                    <Badge variant="outline"><FileText className="size-3" /> Run #48 report</Badge>
                    <Badge variant="outline"><FileText className="size-3" /> Hook experiment</Badge>
                  </div>
                  <div className="space-y-1.5">
                    <ComponentTag id="RESP-02" name="Suggested Action Row" />
                    <div className="flex flex-wrap gap-2">
                      <Button className="h-7 text-xs" size="sm" variant="outline"><Sparkles className="size-3" /> Preview on the content page</Button>
                      <Button className="h-7 text-xs" size="sm" variant="ghost">Schedule for Thursday</Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <Card className="gap-0 py-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Message state</p>
              <Button className="h-7 text-xs" onClick={replay} size="sm" variant="outline"><RotateCcw className="size-3" /> Replay</Button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {PHASE_PILLS.map((pill) => (
                <button
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${phase === pill.id ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                  key={pill.id}
                  onClick={() => selectPhase(pill.id)}
                  type="button"
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="gap-0 py-0">
          <CardContent className="space-y-3 p-4">
            {CONTRACT.map((row) => (
              <div className={`rounded-lg border p-2.5 transition-colors ${phase === row.phase ? 'border-primary/30 bg-primary/5' : ''}`} key={row.phase}>
                <p className="text-xs font-semibold capitalize">{row.phase}</p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{row.rule}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
