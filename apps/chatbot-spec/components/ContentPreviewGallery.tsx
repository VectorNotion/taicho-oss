'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CalendarPlus,
  Check,
  Clock3,
  Copy,
  Globe2,
  Heart,
  MessageCircle,
  MessageSquareText,
  Music2,
  Pause,
  Pencil,
  Play,
  Repeat2,
  RotateCcw,
  Send,
  ThumbsUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ComponentTag, InferenceTicker, SectionHeading } from './spec-primitives';

const X_POST =
  'We simulated 412,000 impressions before publishing a single post. The resonance scorer reads P(Yes) at one token position instead of generating text — a thousand synthetic audience reads for $0.008. Harness goes open source this week.';

const LINKEDIN_POST =
  'Most creators publish, wait a week, and guess why a post worked. We inverted it: every hook is scored against a synthetic audience before it ships. The scorer steers a small model with random activation vectors — a paired design, so score differences come from the creative, not audience noise. Last week that meant killing our favorite hook before it cost us a launch.';

const YT_TITLE = 'I built a synthetic audience that scores my hooks before I publish';
const BLOG_TITLE = 'Scoring creative variants with activation-steered logprob readouts';
const SHORT_CAPTION = 'Your audience, simulated — 412k impressions before publishing';
const REEL_CAPTION = 'We score every hook against a synthetic audience before it ships. $0.008 per thousand reads.';

// Per-surface inference summaries — WORK-07 Inference Ticker, rendered in the
// exact space each draft will fill so the reveal happens in place. Long lines
// are expected: the ticker window keeps the newest text visible and fades the
// overflow out the top.
const THINKING = {
  x: [
    'Scanning run #48 — 24 frames, 412k simulated impressions, hook variants ranked',
    'Cutting to one number — 412k prospects the post, the thread carries the mechanism, and the price point holds for tweet two so the hook stays under 280 characters',
  ],
  li: [
    'Audience read: operators and founders — professional register, no hashtags',
    'Placing the fold — the inversion has to land before “…see more”, so the publish-and-guess pain opens and the paired-design mechanism follows the fold',
  ],
  yt: [
    'Search intent: “test content before publishing” — outcome phrasing wins',
    'Framing title — outcome first, mechanism teased, no clickbait tail',
  ],
  blog: [
    'Outline: problem → mechanism → cost — the dek carries the why',
    'Title needs the method named — activation steering and logprob readout are both searchable terms worth the length',
  ],
  short: [
    'Hook budget is two seconds — the 412k number renders on screen before a word is spoken',
    'Caption stays above the rail with the handle and runtime',
  ],
  reel: [
    'Instagram truncates at 125 characters — the price point must survive the cut',
    'Audio line credits original audio to the handle',
  ],
} as const;

const X_WORDS = X_POST.split(' ');
const LI_WORDS = LINKEDIN_POST.split(' ');
const LI_FOLD = 42;
const THINK_TICKS = 36;
const DRAFT_TICKS = Math.max(X_WORDS.length, LI_WORDS.length) + 10;
const MAX_TICK = THINK_TICKS + DRAFT_TICKS;

function PlatformFrame({ tag, name, purpose, children, className = '' }: { tag: string; name: string; purpose: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <ComponentTag id={tag} name={name} />
        <span className="text-[11px] text-muted-foreground">{purpose}</span>
      </div>
      {children}
    </div>
  );
}

function AvatarDot({ label, className = '' }: { label: string; className?: string }) {
  return <span className={`grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary ${className}`}>{label}</span>;
}

function useCopy() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  useEffect(() => {
    if (!copiedId) return;
    const t = setTimeout(() => setCopiedId(null), 1600);
    return () => clearTimeout(t);
  }, [copiedId]);
  const copy = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopiedId(id);
  };
  return { copiedId, copy };
}

function ActionRow({ id, text, copiedId, onCopy }: { id: string; text: string; copiedId: string | null; onCopy: (id: string, text: string) => void }) {
  const copied = copiedId === id;
  return (
    <div className="flex items-center gap-1 border-t pt-2">
      <Button className="h-7 text-xs" onClick={() => onCopy(id, text)} size="sm" variant="ghost">
        {copied ? <Check className="size-3 text-primary" /> : <Copy className="size-3" />} {copied ? 'Copied' : 'Copy'}
      </Button>
      <Button className="h-7 text-xs" size="sm" variant="ghost"><Pencil className="size-3" /> Edit draft</Button>
      <Button className="ml-auto h-7 text-xs" size="sm" variant="outline"><CalendarPlus className="size-3" /> Schedule</Button>
    </div>
  );
}

function VerticalRail({ items }: { items: Array<{ icon: React.ComponentType<{ className?: string }>; count: string }> }) {
  return (
    <div className="absolute bottom-16 right-2 flex flex-col items-center gap-3">
      {items.map(({ icon: Icon, count }) => (
        <span className="flex flex-col items-center gap-0.5 text-[10px] font-medium text-foreground/90" key={count}>
          <span className="grid size-8 place-items-center rounded-full bg-background/40 backdrop-blur-sm"><Icon className="size-4" /></span>
          {count}
        </span>
      ))}
    </div>
  );
}

export function ContentPreviewGallery() {
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const { copiedId, copy } = useCopy();

  const thinking = tick < THINK_TICKS;
  const draftTick = Math.max(0, tick - THINK_TICKS);
  const complete = tick >= MAX_TICK;
  const thinkLines = (lines: readonly string[]) => lines.slice(0, Math.min(lines.length, Math.floor(tick / 10) + 1)) as string[];

  useEffect(() => {
    if (paused) return;
    if (!complete) {
      const t = setTimeout(() => setTick((value) => value + 1), 70);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setTick(0), 6000);
    return () => clearTimeout(t);
  }, [tick, paused, complete]);

  const xText = useMemo(() => X_WORDS.slice(0, draftTick).join(' '), [draftTick]);
  const liText = useMemo(() => LI_WORDS.slice(0, Math.min(draftTick, LI_FOLD)).join(' '), [draftTick]);
  const xStreaming = draftTick > 0 && draftTick < X_WORDS.length;
  const liStreaming = draftTick > 0 && draftTick < LI_FOLD;
  const mediaReady = draftTick > 24;
  const settleCls = `transition-opacity duration-300 ${complete ? 'opacity-100' : 'pointer-events-none opacity-0'}`;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeading
          eyebrow="Content surfaces"
          title="Preview content the way the platform will render it"
          description="Generation is one atomic operation per surface: WORK-07 Inference Ticker thinks in the exact space the draft will fill, the draft replaces it in place, and the preview settles with its full action set — copy, edit, schedule."
        />
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs text-muted-foreground">
            {!complete && <span className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" aria-hidden />}
            {thinking ? 'Thinking' : complete ? 'Settled' : 'Drafting'}
          </span>
          <Button onClick={() => setTick(0)} size="sm" variant="outline"><RotateCcw className="size-3.5" /> Replay</Button>
          <Button onClick={() => setPaused((value) => !value)} size="sm" variant="outline">
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />} {paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <PlatformFrame tag="DATA-08" name="X Post Preview" purpose="The post as the timeline shows it, with thread position.">
          <Card className={`gap-0 py-0 transition-colors ${thinking || xStreaming ? 'border-primary/25' : ''}`}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <AvatarDot label="RS" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="font-semibold">Rajesh Sharma</span>
                    <span className="text-muted-foreground">@rajesh · now</span>
                    <Badge className="ml-auto" variant="outline">Thread 1/4</Badge>
                  </div>
                  <div className="mt-1.5 min-h-20 text-sm leading-6">
                    {thinking ? (
                      <InferenceTicker lines={thinkLines(THINKING.x)} windowClass="max-h-20" />
                    ) : (
                      <p>
                        {xText}
                        {xStreaming && <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-primary align-text-bottom motion-reduce:animate-none" aria-hidden />}
                      </p>
                    )}
                  </div>
                  <div className={`mt-3 flex items-center justify-between border-t py-2.5 text-xs text-muted-foreground ${settleCls}`}>
                    <span className="flex items-center gap-1.5"><MessageCircle className="size-3.5" /> 24</span>
                    <span className="flex items-center gap-1.5"><Repeat2 className="size-3.5" /> 61</span>
                    <span className="flex items-center gap-1.5"><Heart className="size-3.5" /> 348</span>
                    <span className="flex items-center gap-1.5"><BarChart3 className="size-3.5" /> 41K</span>
                  </div>
                  <div className={settleCls}>
                    <ActionRow copiedId={copiedId} id="x" onCopy={copy} text={X_POST} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </PlatformFrame>

        <PlatformFrame tag="DATA-09" name="LinkedIn Post Preview" purpose="The see-more fold sits exactly where readers will meet it.">
          <Card className={`gap-0 py-0 transition-colors ${thinking || liStreaming ? 'border-primary/25' : ''}`}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <AvatarDot label="RS" className="rounded-lg" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight">Rajesh Sharma</p>
                  <p className="text-xs text-muted-foreground">Building autonomous content systems</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">Now · <Globe2 className="size-3" /></p>
                </div>
              </div>
              <div className="mt-3 min-h-24 text-sm leading-6">
                {thinking ? (
                  <InferenceTicker lines={thinkLines(THINKING.li)} windowClass="max-h-24" />
                ) : (
                  <p>
                    {liText}
                    {liStreaming && <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-primary align-text-bottom motion-reduce:animate-none" aria-hidden />}
                    {draftTick >= LI_FOLD && <span className="text-muted-foreground"> …see more</span>}
                  </p>
                )}
              </div>
              <div className={`mt-3 flex items-center gap-2 border-t py-2.5 text-xs text-muted-foreground ${settleCls}`}>
                <span className="flex -space-x-1">
                  <span className="grid size-4 place-items-center rounded-full bg-primary/20 ring-2 ring-card"><ThumbsUp className="size-2.5 text-primary" /></span>
                  <span className="grid size-4 place-items-center rounded-full bg-primary/30 ring-2 ring-card"><Heart className="size-2.5 text-primary" /></span>
                </span>
                84 · 12 comments
              </div>
              <div className={settleCls}>
                <ActionRow copiedId={copiedId} id="li" onCopy={copy} text={LINKEDIN_POST} />
              </div>
            </CardContent>
          </Card>
        </PlatformFrame>

        <PlatformFrame tag="DATA-10" name="YouTube Video Card" purpose="Title and thumbnail framing checked before the cut is scheduled.">
          <Card className="gap-0 overflow-hidden py-0">
            <CardContent className="p-0">
              {mediaReady ? (
                <div className="relative aspect-video bg-gradient-to-br from-primary/25 via-background to-chart-1/15 animate-in fade-in duration-300 motion-reduce:animate-none">
                  <span className="absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-background/85"><Play className="ml-0.5 size-5" /></span>
                  <span className="absolute bottom-2 right-2 rounded bg-background/90 px-1.5 py-0.5 font-mono text-[10px]">12:41</span>
                </div>
              ) : (
                <Skeleton className="aspect-video rounded-none" />
              )}
              <div className="p-4">
                <div className="flex gap-3">
                  <AvatarDot label="VN" className="size-8 text-[10px]" />
                  <div className="min-w-0 flex-1">
                    {thinking ? (
                      <div className="min-h-9 pt-0.5"><InferenceTicker lines={thinkLines(THINKING.yt)} windowClass="max-h-10" /></div>
                    ) : mediaReady ? (
                      <div className="animate-in fade-in duration-300 motion-reduce:animate-none">
                        <p className="text-sm font-medium leading-snug">{YT_TITLE}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Vector Notion · 8.1K views · 2 days ago</p>
                      </div>
                    ) : (
                      <div className="min-h-9 w-full space-y-2 pt-0.5">
                        <Skeleton className="h-3.5 w-56 max-w-full" />
                        <Skeleton className="h-3 w-36" />
                      </div>
                    )}
                  </div>
                </div>
                <div className={`mt-3 ${settleCls}`}>
                  <ActionRow copiedId={copiedId} id="yt" onCopy={copy} text={YT_TITLE} />
                </div>
              </div>
            </CardContent>
          </Card>
        </PlatformFrame>

        <PlatformFrame tag="DATA-11" name="Blog Article Preview" purpose="The article hero as the blog renders it — category, dek, reading time.">
          <Card className="gap-0 overflow-hidden py-0">
            <CardContent className="p-0">
              {mediaReady ? (
                <div className="h-20 bg-gradient-to-r from-chart-3/25 via-primary/10 to-transparent animate-in fade-in duration-300 motion-reduce:animate-none" />
              ) : (
                <Skeleton className="h-20 rounded-none" />
              )}
              <div className="p-4">
                {thinking ? (
                  <div className="min-h-24"><InferenceTicker lines={thinkLines(THINKING.blog)} windowClass="max-h-20" /></div>
                ) : mediaReady ? (
                  <div className="min-h-24 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
                    <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-primary">Engineering</p>
                    <p className="mt-1.5 text-base font-semibold leading-snug">{BLOG_TITLE}</p>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">Why we stopped generating synthetic audience text and started reading a single token’s probability instead.</p>
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3.5" /> 9 min read · Jul 29, 2026</p>
                  </div>
                ) : (
                  <div className="min-h-24 space-y-2.5">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-4 w-72 max-w-full" />
                    <Skeleton className="h-3.5 w-60 max-w-full" />
                  </div>
                )}
                <div className={`mt-3 ${settleCls}`}>
                  <ActionRow copiedId={copiedId} id="blog" onCopy={copy} text={BLOG_TITLE} />
                </div>
              </div>
            </CardContent>
          </Card>
        </PlatformFrame>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Vertical · short-form</p>
          <span className="text-[11px] text-muted-foreground">The 9:16 cuts — cover framing, overlay copy, and action rail checked before scheduling.</span>
        </div>
        <div className="flex flex-wrap gap-5">
          <PlatformFrame className="w-full max-w-[250px]" tag="DATA-12" name="YouTube Short" purpose="Shorts anatomy.">
            <Card className="gap-0 overflow-hidden py-0">
              <CardContent className="p-0">
                {mediaReady ? (
                  <div className="relative aspect-[9/16] bg-gradient-to-b from-chart-2/25 via-background to-chart-5/20 animate-in fade-in duration-300 motion-reduce:animate-none">
                    <span className="absolute left-2 top-2 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide">Short</span>
                    <span className="absolute left-1/2 top-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-background/85"><Play className="ml-0.5 size-4" /></span>
                    <VerticalRail items={[{ icon: Heart, count: '2.4K' }, { icon: MessageCircle, count: '118' }, { icon: Send, count: 'Share' }]} />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/70 to-transparent p-3 pt-8">
                      <p className="text-xs font-medium leading-snug">{SHORT_CAPTION}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">@vectornotion · 0:48</p>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <Skeleton className="aspect-[9/16] rounded-none" />
                    {thinking && <div className="absolute inset-x-0 bottom-0 p-3"><InferenceTicker lines={thinkLines(THINKING.short)} windowClass="max-h-15" /></div>}
                  </div>
                )}
                <div className={`px-3 pb-2 pt-1 ${settleCls}`}>
                  <ActionRow copiedId={copiedId} id="short" onCopy={copy} text={SHORT_CAPTION} />
                </div>
              </CardContent>
            </Card>
          </PlatformFrame>

          <PlatformFrame className="w-full max-w-[250px]" tag="DATA-13" name="Instagram Reel" purpose="Reel anatomy.">
            <Card className="gap-0 overflow-hidden py-0">
              <CardContent className="p-0">
                {mediaReady ? (
                  <div className="relative aspect-[9/16] bg-gradient-to-b from-chart-3/25 via-background to-chart-1/15 animate-in fade-in duration-300 motion-reduce:animate-none">
                    <div className="absolute left-2 top-2 flex items-center gap-1.5">
                      <AvatarDot label="RS" className="size-6 text-[9px]" />
                      <span className="text-[11px] font-medium">rajesh.builds</span>
                    </div>
                    <VerticalRail items={[{ icon: Heart, count: '1.9K' }, { icon: MessageCircle, count: '86' }, { icon: Send, count: '212' }]} />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/70 to-transparent p-3 pt-8">
                      <p className="text-xs leading-snug">{REEL_CAPTION}</p>
                      <p className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground"><Music2 className="size-3" /> Original audio · rajesh.builds</p>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <Skeleton className="aspect-[9/16] rounded-none" />
                    {thinking && <div className="absolute inset-x-0 bottom-0 p-3"><InferenceTicker lines={thinkLines(THINKING.reel)} windowClass="max-h-15" /></div>}
                  </div>
                )}
                <div className={`px-3 pb-2 pt-1 ${settleCls}`}>
                  <ActionRow copiedId={copiedId} id="reel" onCopy={copy} text={REEL_CAPTION} />
                </div>
              </CardContent>
            </Card>
          </PlatformFrame>
        </div>
      </div>

      <div className="rounded-xl border bg-card/50 p-4 text-sm leading-6 text-muted-foreground">
        <MessageSquareText className="mb-2 size-4 text-primary" />
        These previews are conversation surfaces, not separate tools: when a draft targets a platform, the matching preview (DATA-08…13) renders inline in the assistant message. WORK-07 thinks in the space the draft will fill, the draft streams in place, and the surface settles with its action row — copy, edit, schedule. This page shows every platform draft for a piece of content side by side for review.
      </div>
    </div>
  );
}
