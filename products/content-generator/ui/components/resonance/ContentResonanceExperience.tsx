"use client";

import * as React from "react";
import {
  ArrowRight,
  AlertTriangle,
  AudioWaveform,
  BarChart3,
  Check,
  Circle,
  Eye,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trophy,
  WandSparkles,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ErrorBar,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReasoningTicker } from "@/components/genui";
import { LiveDot } from "@/components/LiveDot";
import { useActionStream } from "@/hooks/use-action-stream";
import {
  audienceSliderScale,
  nearestSliderPosition,
} from "@content-automation/platform/resonance/audience-scale";
import type {
  ResonanceFrame,
  ResonanceRunProgress,
  ResonanceVoteSnapshot,
  RunResult,
} from "@content-automation/platform/resonance/types";
import { CELL_CAP } from "@content-automation/platform/resonance/payload";
import type { ContentDraft } from "../../../domain/content";
import { CONTENT_TYPE_CONFIG } from "../../../domain/content";
import { formatGeneratedContent } from "../../../domain/generated-content";
import {
  DEFAULT_RESONANCE_VARIATIONS,
  MAX_RESONANCE_VARIATIONS,
  MIN_RESONANCE_VARIATIONS,
  estimateExperiment,
  resonanceProfileFor,
  sourceCandidate,
  type ContentResonanceCandidate,
  type ContentResonanceExperimentResult,
} from "../../../domain/resonance-experiment";

type ExperienceState = "idle" | "generating" | "scoring" | "completed" | "failed";
type RunApiBody = {
  status: "queued" | "processing" | "completed" | "failed";
  result: RunResult | null;
  progress: ResonanceRunProgress | null;
  error?: string | null;
};

const DEFAULT_AUDIENCE = 5_000;
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 15_000;

function audienceFriendlyMessage(message: string): string {
  return message
    .replace(/\bshards\b/gi, "audience batches")
    .replace(/\bshard\b/gi, "audience batch");
}

const FRAME_LABELS: Record<string, string> = {
  scroll_stop: "Scroll stop",
  click: "Click",
  share: "Share",
  compelling: "Compelling",
};

const RESONANCE_CHART_CONFIG = {
  score: {
    label: "Resonance score",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

const AXIS_TICK = {
  fill: "var(--muted-foreground)",
  fontSize: 11,
};

function candidateById(
  candidates: ContentResonanceCandidate[],
  id: string | null,
): ContentResonanceCandidate | null {
  return id ? candidates.find((candidate) => candidate.id === id) ?? null : null;
}

function statusBadge(state: ExperienceState): { label: string; variant: "default" | "secondary" | "destructive" } {
  if (state === "completed") return { label: "Complete", variant: "default" };
  if (state === "failed") return { label: "Failed", variant: "destructive" };
  if (state === "generating") return { label: "Generating", variant: "secondary" };
  if (state === "scoring") return { label: "Simulating audience", variant: "secondary" };
  return { label: "Ready", variant: "secondary" };
}

function StageRow({
  state,
  label,
  detail,
}: {
  state: "waiting" | "running" | "done" | "failed";
  label: string;
  detail?: string;
}) {
  const Icon = state === "done" ? Check : state === "failed" ? AlertTriangle : Circle;
  return (
    <div className="flex min-w-0 items-start gap-3">
      {state === "running" ? (
        <LiveDot className="mt-1 shrink-0" />
      ) : (
        <Icon
          aria-hidden
          className={[
            "mt-0.5 size-4 shrink-0",
            state === "done" ? "text-primary" : "",
            state === "failed" ? "text-destructive" : "",
            state === "waiting" ? "text-muted-foreground" : "",
          ].join(" ")}
        />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  );
}

function RunMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

function LiveAudienceVotes({
  snapshot,
  candidates,
  frameLabels,
  live,
}: {
  snapshot: ResonanceVoteSnapshot | null;
  candidates: ContentResonanceCandidate[];
  frameLabels: Partial<Record<ResonanceFrame, string>>;
  live: boolean;
}) {
  const candidateLabels = new Map(candidates.map((candidate) => [candidate.id, candidate.label]));
  const tallies = snapshot?.tallies ?? [];
  const summaries = candidates.map((candidate) => {
    const candidateTallies = tallies.filter((tally) => tally.creativeId === candidate.id);
    const up = candidateTallies.reduce((sum, tally) => sum + tally.up, 0);
    const down = candidateTallies.reduce((sum, tally) => sum + tally.down, 0);
    const total = up + down;
    return { candidate, up, down, total, positiveRate: total ? Math.round((up / total) * 100) : 0 };
  }).filter((summary) => summary.total > 0);
  const recent = [...(snapshot?.recent ?? [])].reverse().slice(0, 12);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Live audience reactions</CardTitle>
              {live ? <LiveDot label="Streaming" className="text-xs text-primary" /> : null}
            </div>
            <CardDescription>
              Reactions refresh as each audience batch completes
            </CardDescription>
          </div>
          {snapshot ? (
            <Badge variant="outline">Update {snapshot.sequence.toLocaleString()}</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {summaries.length > 0 ? (
          <div className="grid divide-y border-b sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
            {summaries.map(({ candidate, up, down, positiveRate }) => (
              <div className="min-w-0 p-4" key={candidate.id}>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{candidate.label}</p>
                  <span className="font-mono text-xs tabular-nums">{positiveRate}% positive</span>
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs tabular-nums">
                  <span className="flex items-center gap-1.5 text-primary">
                    <ThumbsUp className="size-3.5" />
                    {up.toLocaleString()}
                  </span>
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <ThumbsDown className="size-3.5" />
                    {down.toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Recent anonymous reactions
          </p>
          {recent.length > 0 ? (
            <div className="mt-3 max-h-80 divide-y overflow-auto rounded-lg border">
              {recent.map((reaction) => {
                const positive = reaction.vote === "up";
                const Icon = positive ? ThumbsUp : ThumbsDown;
                const signalStrength = positive
                  ? reaction.yesProbability
                  : 1 - reaction.yesProbability;
                return (
                  <div className="flex min-w-0 items-center gap-3 px-3 py-2.5" key={reaction.id}>
                    <span className={[
                      "grid size-7 shrink-0 place-items-center rounded-full",
                      positive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    ].join(" ")}>
                      <Icon className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        Audience #{reaction.audienceMember.toLocaleString()}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {candidateLabels.get(reaction.creativeId) ?? reaction.creativeId}
                        {" · "}
                        {frameLabels[reaction.frame] ?? FRAME_LABELS[reaction.frame] ?? reaction.frame}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-medium">{positive ? "Thumbs up" : "Thumbs down"}</p>
                      <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
                        {Math.round(signalStrength * 100)}% signal
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 space-y-2 rounded-lg border p-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <p className="text-xs text-muted-foreground">
                Waiting for the first audience batch to respond.
              </p>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Thumbs summarize whether a completed synthetic judgment leans positive or negative.
            Final ranking uses the full probability signal, not the displayed binary threshold.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function CandidatePreview({
  candidate,
  content,
  state,
}: {
  candidate: ContentResonanceCandidate;
  content: string;
  state: "waiting" | "generating" | "ready";
}) {
  return (
    <Card
      className={[
        "gap-0 overflow-hidden py-0 transition-colors",
        state === "generating" ? "border-primary/35" : "",
      ].join(" ")}
    >
      <CardHeader className="border-b p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm">{candidate.label}</CardTitle>
            <CardDescription>{CONTENT_TYPE_CONFIG[candidate.contentType].label}</CardDescription>
          </div>
          <Badge variant={state === "ready" ? "outline" : "secondary"}>
            {state === "ready" ? "Ready" : state === "generating" ? "Generating" : "Waiting"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {content ? (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap p-4 font-sans text-sm leading-6">{content}</pre>
        ) : (
          <div className="space-y-3 p-4">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResonanceScoreChart({
  candidates,
  result,
}: {
  candidates: ContentResonanceCandidate[];
  result: RunResult;
}) {
  const scores = new Map(result.scores.map((score) => [score.creativeId, score]));
  const rows = candidates.map((candidate) => {
    const score = scores.get(candidate.id);
    const value = score?.score ?? 0;
    const error: [number, number] = score?.ci95
      ? [Math.max(0, value - score.ci95[0]), Math.max(0, score.ci95[1] - value)]
      : [0, 0];
    return {
      id: candidate.id,
      candidate: candidate.label,
      score: value,
      error,
      scorable: score?.score != null,
      winner: candidate.id === result.winner.creativeId,
    };
  });

  return (
    <ChartContainer
      className="w-full"
      config={RESONANCE_CHART_CONFIG}
      style={{ height: Math.max(220, rows.length * 48) }}
    >
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 32 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis
          axisLine={false}
          domain={[0, 100]}
          tick={AXIS_TICK}
          tickLine={false}
          type="number"
        />
        <YAxis
          axisLine={false}
          dataKey="candidate"
          tick={AXIS_TICK}
          tickLine={false}
          type="category"
          width={82}
        />
        <ChartTooltip
          content={<ChartTooltipContent hideLabel />}
          cursor={{ fill: "var(--muted)", opacity: 0.35 }}
        />
        <Bar barSize={18} dataKey="score" radius={[0, 4, 4, 0]}>
          {rows.map((row) => (
            <Cell
              fill={row.winner ? "var(--chart-2)" : "var(--chart-6)"}
              key={row.id}
              opacity={row.scorable ? 1 : 0.3}
            />
          ))}
          <LabelList
            dataKey="score"
            fill="var(--primary-foreground)"
            fontSize={11}
            fontWeight={600}
            formatter={(value: number) => value.toFixed(1)}
            position="insideRight"
          />
          <ErrorBar
            dataKey="error"
            direction="x"
            stroke="var(--muted-foreground)"
            strokeWidth={1.5}
            width={4}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function overallProgress(
  state: ExperienceState,
  completedVariations: number,
  variationCount: number,
  progress: ResonanceRunProgress | null,
): number {
  if (state === "completed") return 100;
  if (state === "failed") return 0;
  if (state === "generating") return 5 + (completedVariations / Math.max(1, variationCount)) * 35;
  if (state === "scoring") {
    if (progress?.stage === "ranking") return 97;
    const scored = progress?.cellsTotal ? progress.cellsDone / progress.cellsTotal : 0;
    return 40 + scored * 55;
  }
  return 0;
}

export function ContentResonanceExperience({
  draft,
  onDraftUpdated,
}: {
  draft: ContentDraft;
  onDraftUpdated?: () => void | Promise<void>;
}) {
  const [setupOpen, setSetupOpen] = React.useState(false);
  const [confirmApplyOpen, setConfirmApplyOpen] = React.useState(false);
  const [variationCount, setVariationCount] = React.useState(DEFAULT_RESONANCE_VARIATIONS);
  const [audiencePosition, setAudiencePosition] = React.useState(() => nearestSliderPosition(DEFAULT_AUDIENCE));
  const [activeRequest, setActiveRequest] = React.useState({
    variationCount: DEFAULT_RESONANCE_VARIATIONS,
    audienceSize: DEFAULT_AUDIENCE,
  });
  const [state, setState] = React.useState<ExperienceState>("idle");
  const [runProgress, setRunProgress] = React.useState<ResonanceRunProgress | null>(null);
  const [runResult, setRunResult] = React.useState<RunResult | null>(null);
  const [runError, setRunError] = React.useState<string | null>(null);
  const [pollWarning, setPollWarning] = React.useState<string | null>(null);
  const [recoveredExperiment, setRecoveredExperiment] = React.useState<ContentResonanceExperimentResult | null>(null);
  const [applying, setApplying] = React.useState(false);
  const workbenchRef = React.useRef<HTMLDivElement>(null);
  const startedRef = React.useRef(false);

  const stream = useActionStream<Record<string, unknown>, ContentResonanceExperimentResult>({
    api: `/api/content/drafts/${draft.id}/resonance/stream`,
  });

  const audienceSize = audienceSliderScale(audiencePosition);
  const profile = resonanceProfileFor(draft.type);
  const setupEstimate = estimateExperiment({ variationCount, audienceSize });
  const overCellCap = setupEstimate.resonanceCells > CELL_CAP;
  const progressRows = new Map(stream.progress.map((entry) => [entry.id, entry]));
  const experiment = stream.final ?? recoveredExperiment;
  const streamedCompletedVariations = Array.from(progressRows.values())
    .filter((entry) => entry.id.startsWith("variation-") && entry.state === "done").length;
  const completedVariations = experiment?.variationCount ?? streamedCompletedVariations;

  const streamedCandidates = stream.dataParts
    .filter((part) => part.type === "data-candidate")
    .map((part) => part.data as ContentResonanceCandidate);
  const candidates = experiment?.candidates
    ?? [sourceCandidate(draft), ...streamedCandidates];

  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("resonance") !== "setup") return;
    setSetupOpen(true);
    url.searchParams.delete("resonance");
    window.history.replaceState(window.history.state, "", url);
  }, []);

  React.useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const response = await fetch(`/api/content/drafts/${draft.id}/resonance/latest`);
        if (!active || startedRef.current || response.status === 204 || !response.ok) return;
        const body = await response.json() as { result?: ContentResonanceExperimentResult };
        if (body.result?.kind !== "content_resonance_experiment") return;
        setRecoveredExperiment(body.result);
        setActiveRequest({
          variationCount: body.result.variationCount,
          audienceSize: body.result.audienceSize,
        });
        setState("scoring");
      } catch {
        // Recovery is an enhancement; the draft and a new run remain usable.
      }
    };
    void restore();
    return () => { active = false; };
  }, [draft.id]);

  React.useEffect(() => {
    if (!experiment?.resonanceJobId) return;
    setState("scoring");
    setRunError(null);
    let active = true;
    let terminal = false;
    let failures = 0;
    let timer: number | null = null;

    const schedule = (delay: number) => {
      if (!active || terminal) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      if (terminal) return;
      try {
        const response = await fetch(`/api/resonance/runs/${experiment.resonanceJobId}`);
        if (response.status === 401) {
          throw new Error("Your session expired. The run is still safe; sign in again to resume live updates.");
        }
        if (response.status === 404) {
          terminal = true;
          setRunError("This audience run could not be found.");
          setState("failed");
          return;
        }
        if (!response.ok) throw new Error("Could not read audience progress.");
        const body = await response.json() as RunApiBody;
        if (!active) return;
        failures = 0;
        setPollWarning(null);
        if (body.progress) setRunProgress(body.progress);
        if (body.status === "completed" && body.result) {
          terminal = true;
          setRunResult(body.result);
          setState("completed");
          return;
        }
        if (body.status === "failed") {
          terminal = true;
          setRunError(body.error
            ? audienceFriendlyMessage(body.error)
            : "Audience simulation failed.");
          setState("failed");
        }
      } catch (error) {
        if (!active) return;
        failures += 1;
        const message = error instanceof Error ? error.message : "Live updates were interrupted.";
        setPollWarning(`${message} Retrying automatically…`);
      } finally {
        if (!active || terminal) return;
        const retryDelay = failures === 0
          ? POLL_INTERVAL_MS
          : Math.min(MAX_POLL_INTERVAL_MS, POLL_INTERVAL_MS * (2 ** Math.min(failures, 3)));
        schedule(retryDelay);
      }
    };

    const resumePolling = () => {
      if (!active || terminal || document.visibilityState === "hidden") return;
      schedule(0);
    };

    void poll();
    window.addEventListener("online", resumePolling);
    document.addEventListener("visibilitychange", resumePolling);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("online", resumePolling);
      document.removeEventListener("visibilitychange", resumePolling);
    };
  }, [experiment?.resonanceJobId]);

  React.useEffect(() => {
    if (!stream.error || state !== "generating") return;
    const message = audienceFriendlyMessage(stream.error);
    setRunError(message);
    setState("failed");
    toast.error(message);
  }, [stream.error, state]);

  React.useEffect(() => {
    if (state === "idle") return;
    workbenchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [state]);

  const startExperiment = () => {
    const next = { variationCount, audienceSize };
    startedRef.current = true;
    setRecoveredExperiment(null);
    setActiveRequest(next);
    setRunProgress(null);
    setRunResult(null);
    setRunError(null);
    setPollWarning(null);
    setState("generating");
    setSetupOpen(false);
    stream.start(next);
  };

  const winner = candidateById(candidates, runResult?.winner.creativeId ?? null);
  const scoreById = new Map((runResult?.scores ?? []).map((score) => [score.creativeId, score]));
  const rankedCandidates = [...candidates].sort((left, right) => {
    const leftScore = scoreById.get(left.id)?.score ?? Number.NEGATIVE_INFINITY;
    const rightScore = scoreById.get(right.id)?.score ?? Number.NEGATIVE_INFINITY;
    return rightScore - leftScore;
  });
  const activeVariationIndex = Math.min(completedVariations + 1, activeRequest.variationCount);
  const activeEventId = `variation-${activeVariationIndex}`;
  const activeReasoning = stream.reasoningById[activeEventId] ?? stream.reasoning;
  const badge = statusBadge(state);
  const percent = overallProgress(
    state,
    completedVariations,
    activeRequest.variationCount,
    runProgress,
  );
  const running = state === "generating" || state === "scoring";
  const runEstimate = estimateExperiment(activeRequest);
  const candidateTotal = activeRequest.variationCount + 1;
  const judgmentsDone = runProgress?.cellsDone ?? 0;
  const judgmentsTotal = runProgress?.cellsTotal ?? runEstimate.resonanceCells;
  const reportedJudgmentsDone = state === "completed"
    ? runResult?.cellsDone ?? judgmentsDone
    : judgmentsDone;
  const winnerScore = winner ? scoreById.get(winner.id)?.score ?? null : null;
  const voteSnapshot = runResult?.voteSnapshot ?? runProgress?.voteSnapshot ?? null;

  const applyWinner = async () => {
    if (!winner || winner.original) return;
    setApplying(true);
    try {
      const response = await fetch(`/api/content/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: winner.title, content: winner.content }),
      });
      if (!response.ok) throw new Error("Could not update the draft.");
      toast.success("Winning variation applied");
      setConfirmApplyOpen(false);
      await onDraftUpdated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply the winning variation.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base">Content</CardTitle>
              <CardDescription>
                Generated {profile.label.toLowerCase()} · ready for a format-aware audience comparison
              </CardDescription>
            </div>
            <Button
              className={state === "idle" ? "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10" : ""}
              disabled={running}
              onClick={() => setSetupOpen(true)}
              size="sm"
              variant="outline"
            >
              <AudioWaveform className="h-4 w-4" />
              {running ? "Test running" : state === "completed" ? "Test again" : "Test resonance"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[38rem] overflow-auto bg-muted/30 p-6">
            {draft.type === "blog_post" ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.content}</ReactMarkdown>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-sm leading-6">{draft.content}</pre>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test {profile.label} resonance</DialogTitle>
            <DialogDescription>
              Generate alternatives, then test the signals that matter for this template. {profile.description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-2">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">New variations</p>
                  <p className="text-xs text-muted-foreground">
                    The original is always included as the control.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    aria-label="Remove a variation"
                    disabled={variationCount <= MIN_RESONANCE_VARIATIONS}
                    onClick={() => setVariationCount((current) => Math.max(MIN_RESONANCE_VARIATIONS, current - 1))}
                    size="icon-sm"
                    variant="outline"
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="w-8 text-center text-lg font-semibold tabular-nums">{variationCount}</span>
                  <Button
                    aria-label="Add a variation"
                    disabled={variationCount >= MAX_RESONANCE_VARIATIONS}
                    onClick={() => setVariationCount((current) => Math.min(MAX_RESONANCE_VARIATIONS, current + 1))}
                    size="icon-sm"
                    variant="outline"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Audience size</p>
                  <p className="text-xs text-muted-foreground">More judgments produce a sharper comparison.</p>
                </div>
                <span className="text-sm font-medium tabular-nums">{audienceSize.toLocaleString()}</span>
              </div>
              <Slider
                max={100}
                min={0}
                onValueChange={(values) => setAudiencePosition(values[0] ?? audiencePosition)}
                step={1}
                thumbLabel="Audience size"
                value={[audiencePosition]}
              />
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Quick", value: 500 },
                  { label: "Standard", value: 5_000 },
                  { label: "Deep", value: 25_000 },
                ].map((preset) => (
                  <Button
                    key={preset.value}
                    onClick={() => setAudiencePosition(nearestSliderPosition(preset.value))}
                    size="sm"
                    variant={audienceSize === audienceSliderScale(nearestSliderPosition(preset.value)) ? "secondary" : "outline"}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Run brief
                </p>
                <Badge variant="outline">{profile.label}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span>Original</span>
                <ArrowRight className="size-3.5 text-muted-foreground" />
                <span>{variationCount} new variations</span>
                <ArrowRight className="size-3.5 text-muted-foreground" />
                <span>{setupEstimate.candidates} ranked candidates</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Signals: {profile.frames.map((frame) => profile.frameLabels[frame] ?? FRAME_LABELS[frame] ?? frame).join(" · ")}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                {setupEstimate.resonanceCells.toLocaleString()} audience judgments · approximately{" "}
                {setupEstimate.totalCredits.toLocaleString()} credits across generation and scoring
              </p>
              {overCellCap ? (
                <p className="mt-2 text-xs text-destructive">
                  This setup exceeds the {CELL_CAP.toLocaleString()}-judgment run limit. Lower the audience size or variations.
                </p>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setSetupOpen(false)} variant="outline">Cancel</Button>
            <Button disabled={overCellCap} onClick={startExperiment}>
              <WandSparkles className="h-4 w-4" />
              Generate and test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {state !== "idle" ? (
        <div className="scroll-mt-8 space-y-4" ref={workbenchRef}>
          <Card
            className={[
              "gap-0 overflow-hidden py-0 transition-colors",
              running ? "border-primary/25 bg-primary/5 shadow-lg shadow-primary/5" : "",
            ].join(" ")}
          >
            <CardHeader className="border-b p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                    <Sparkles className="size-4" />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">{profile.label} resonance</CardTitle>
                      {running ? <LiveDot label="Live" className="text-xs text-primary" /> : null}
                    </div>
                    <CardDescription>
                      {candidateTotal} candidates · {activeRequest.audienceSize.toLocaleString()} audience members
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm tabular-nums">{Math.round(percent)}%</span>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </div>
              </div>
              <Progress aria-label={`${profile.label} resonance progress`} value={percent} />
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid divide-y lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:divide-x lg:divide-y-0">
                <div className="space-y-4 p-5">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Run stages</p>
                  <StageRow label="Prepare source content" state="done" />
                  <StageRow
                    detail={`${completedVariations} of ${activeRequest.variationCount} variations ready`}
                    label="Generate variations"
                    state={state === "generating" ? "running" : completedVariations === activeRequest.variationCount ? "done" : state === "failed" ? "failed" : "done"}
                  />
                  <StageRow
                    detail={runProgress?.cellsTotal
                      ? `${runProgress.cellsDone.toLocaleString()} of ${runProgress.cellsTotal.toLocaleString()} judgments`
                      : state === "scoring" ? "Waiting for the first audience batch" : undefined}
                    label="Simulate audience"
                    state={state === "scoring" && runProgress?.stage !== "ranking"
                      ? "running"
                      : state === "completed" || runProgress?.stage === "ranking"
                        ? "done"
                        : state === "failed" && completedVariations === activeRequest.variationCount
                          ? "failed"
                          : "waiting"}
                  />
                  <StageRow
                    label="Rank candidates"
                    state={state === "completed"
                      ? "done"
                      : state === "failed" && runProgress?.stage === "ranking"
                          ? "failed"
                          : runProgress?.stage === "ranking"
                            ? "running"
                            : "waiting"}
                  />
                </div>
                <div className="min-w-0 p-5">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Current activity</p>
                  {state === "generating" ? (
                    <div className="mt-3">
                      <ReasoningTicker active={stream.isStreaming} text={activeReasoning || `Generating variation ${activeVariationIndex}…`} />
                    </div>
                  ) : state === "scoring" ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-sm leading-6">
                        {runProgress?.stage === "ranking"
                          ? "Comparing confidence intervals and selecting the strongest candidate."
                          : "Scoring candidate reactions across the selected audience."}
                      </p>
                      {runProgress?.shardsTotal ? (
                        <p className="font-mono text-xs text-muted-foreground tabular-nums">
                          {runProgress.shardsDone} of {runProgress.shardsTotal} audience batches completed
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Waiting for the first audience batch.</p>
                      )}
                      {pollWarning ? (
                        <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          <p className="text-xs text-muted-foreground">{pollWarning}</p>
                        </div>
                      ) : null}
                    </div>
                  ) : state === "completed" ? (
                    <p className="mt-3 text-sm leading-6">The evidence is settled. Review the score distribution and exact confidence intervals below.</p>
                  ) : (
                    <p className="mt-3 text-sm text-destructive">{runError ?? "The experiment stopped before completion."}</p>
                  )}
                </div>
              </div>
              <div className="grid divide-y border-t bg-background/40 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <RunMetric
                  label="Candidates ready"
                  value={`${Math.min(candidateTotal, completedVariations + 1)} / ${candidateTotal}`}
                />
                <RunMetric
                  label="Judgments"
                  value={`${reportedJudgmentsDone.toLocaleString()} / ${judgmentsTotal.toLocaleString()}`}
                />
                <RunMetric
                  label="Audience batches"
                  value={runProgress?.shardsTotal
                    ? `${runProgress.shardsDone} / ${runProgress.shardsTotal}`
                    : state === "completed" ? "Complete" : "Queued"}
                />
              </div>
            </CardContent>
          </Card>

          {state === "scoring" || (state === "completed" && voteSnapshot) ? (
            <LiveAudienceVotes
              candidates={candidates}
              frameLabels={profile.frameLabels}
              live={state === "scoring"}
              snapshot={voteSnapshot}
            />
          ) : null}

          {(state === "generating" || state === "scoring") ? (
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: activeRequest.variationCount + 1 }).map((_, index) => {
                if (index === 0) {
                  const original = sourceCandidate(draft);
                  return <CandidatePreview candidate={original} content={original.content} key={original.id} state="ready" />;
                }
                const id = `variation-${index}`;
                const complete = candidates.find((candidate) => candidate.id === id);
                const partial = stream.partialsById[id];
                const partialContent = partial ? formatGeneratedContent(draft.type, partial) : "";
                const candidate = complete ?? {
                  id,
                  label: `Variation ${index}`,
                  title: draft.title,
                  content: "",
                  contentType: draft.type,
                  original: false,
                };
                const row = progressRows.get(id);
                return (
                  <CandidatePreview
                    candidate={candidate}
                    content={complete?.content ?? partialContent}
                    key={id}
                    state={complete ? "ready" : row?.state === "running" ? "generating" : "waiting"}
                  />
                );
              })}
            </div>
          ) : null}

          {state === "failed" ? (
            <Card className="border-destructive/50">
              <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                <AlertTriangle className="h-8 w-8 text-destructive" />
                <p className="text-sm text-muted-foreground">{runError ?? "Audience resonance could not complete."}</p>
                <Button onClick={() => setSetupOpen(true)} variant="outline">
                  <RotateCcw className="h-4 w-4" />
                  Try again
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {state === "completed" && runResult ? (
            <>
              <Card className="animate-in border-primary/25 bg-primary/5 shadow-lg shadow-primary/5 fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none">
                <CardContent className="space-y-5 p-6">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <div className="flex items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                        {runResult.winner.tooCloseToCall
                          ? <AudioWaveform className="size-4" />
                          : <Trophy className="size-4" />}
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <CardTitle className="text-lg">
                            {winner
                              ? runResult.winner.tooCloseToCall
                                ? "No clear winner"
                                : `${winner.label} wins`
                              : "No candidate could be scored"}
                          </CardTitle>
                          {winner ? (
                            <Badge variant={runResult.winner.tooCloseToCall ? "secondary" : "tint"}>
                              {runResult.winner.tooCloseToCall ? `${winner.label} leads` : "Winner"}
                            </Badge>
                          ) : null}
                        </div>
                        <CardDescription className="mt-1 max-w-2xl">
                          {winner
                            ? runResult.winner.tooCloseToCall
                              ? `${winner.label} leads by ${runResult.winner.margin.toFixed(1)} points, but the evidence is too close to call confidently.`
                              : `${winner.label} leads by ${runResult.winner.margin.toFixed(1)} points across ${runResult.audienceSize.toLocaleString()} simulated audience members.`
                            : "Run the comparison again to collect a usable result."}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button onClick={() => setSetupOpen(true)} size="sm" variant="outline">
                        <RotateCcw className="h-4 w-4" />
                        Run again
                      </Button>
                      {winner && !winner.original ? (
                        <Button onClick={() => setConfirmApplyOpen(true)} size="sm">
                          <Check className="h-4 w-4" />
                          {runResult.winner.tooCloseToCall ? "Use leader" : "Use winner"}
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid divide-y rounded-lg border bg-background/50 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                    <RunMetric
                      label="Leading score"
                      value={winnerScore == null ? "No data" : winnerScore.toFixed(1)}
                    />
                    <RunMetric
                      label="Lead margin"
                      value={`${runResult.winner.margin.toFixed(1)} points`}
                    />
                    <RunMetric
                      label="Audience"
                      value={runResult.audienceSize.toLocaleString()}
                    />
                  </div>
                </CardContent>
              </Card>

              {runResult.partial ? (
                <Card className="bg-muted/20">
                  <CardContent className="flex items-start gap-3 p-4">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Some audience responses were unavailable</p>
                      <p className="text-xs text-muted-foreground">
                        {runResult.degradedReason
                          ? audienceFriendlyMessage(runResult.degradedReason)
                          : "The ranking uses the responses that completed successfully, so treat a close result with extra caution."}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              <Tabs className="space-y-4" defaultValue="comparison">
                <TabsList>
                  <TabsTrigger value="comparison">
                    <BarChart3 className="size-4" />
                    Comparison
                  </TabsTrigger>
                  <TabsTrigger value="candidates">
                    <Eye className="size-4" />
                    Candidate content
                  </TabsTrigger>
                </TabsList>

                <TabsContent className="space-y-4" value="comparison">
                  <Card className="gap-0 overflow-hidden py-0">
                    <CardHeader className="border-b p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base">{profile.label} score distribution</CardTitle>
                          <CardDescription>
                            {profile.frames.map((frame) => profile.frameLabels[frame] ?? FRAME_LABELS[frame] ?? frame).join(" · ")} · shared 0–100 scale with 95% confidence whiskers
                          </CardDescription>
                        </div>
                        {winner ? <Badge variant="tint">Leader: {winner.label}</Badge> : null}
                      </div>
                    </CardHeader>
                    <CardContent className="p-5">
                      <ResonanceScoreChart candidates={rankedCandidates} result={runResult} />
                    </CardContent>
                  </Card>

                  <Card className="gap-0 overflow-hidden py-0">
                    <CardHeader className="border-b p-5">
                      <CardTitle className="text-base">Exact comparison</CardTitle>
                      <CardDescription>
                        Format-specific relative signals for this run, not predicted real-world conversion rates
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table containerLabel="Audience resonance comparison">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-16">Rank</TableHead>
                            <TableHead>Candidate</TableHead>
                            <TableHead className="text-right">Score</TableHead>
                            <TableHead className="text-right">95% confidence</TableHead>
                            <TableHead>Signals</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rankedCandidates.map((candidate, index) => {
                            const score = scoreById.get(candidate.id);
                            return (
                              <TableRow key={candidate.id}>
                                <TableCell className="font-medium tabular-nums">#{index + 1}</TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{candidate.label}</span>
                                    {candidate.id === runResult.winner.creativeId ? (
                                      <Badge variant={runResult.winner.tooCloseToCall ? "secondary" : "tint"}>
                                        {runResult.winner.tooCloseToCall ? "Leading" : "Winner"}
                                      </Badge>
                                    ) : null}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right text-lg font-semibold tabular-nums">
                                  {score?.score == null ? "—" : score.score.toFixed(1)}
                                </TableCell>
                                <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                                  {score?.ci95 ? `${score.ci95[0].toFixed(1)}–${score.ci95[1].toFixed(1)}` : "No data"}
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1">
                                    {Object.entries(score?.perFrame ?? {}).map(([frame, value]) => (
                                      <Badge key={frame} variant="outline">
                                        {profile.frameLabels[frame as keyof typeof profile.frameLabels] ?? FRAME_LABELS[frame] ?? frame} {value.toFixed(0)}
                                      </Badge>
                                    ))}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="candidates">
                  <div className="grid gap-4 md:grid-cols-2">
                    {rankedCandidates.map((candidate) => (
                      <Card className="gap-0 overflow-hidden py-0" key={candidate.id}>
                        <CardHeader className="border-b p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <CardTitle className="text-sm">{candidate.label}</CardTitle>
                              <CardDescription>
                                {scoreById.get(candidate.id)?.score?.toFixed(1) ?? "No score"} {profile.label.toLowerCase()} resonance
                              </CardDescription>
                            </div>
                            {candidate.id === runResult.winner.creativeId ? (
                              <Badge variant={runResult.winner.tooCloseToCall ? "secondary" : "tint"}>
                                {runResult.winner.tooCloseToCall ? "Leader" : "Winner"}
                              </Badge>
                            ) : (
                              <Badge variant="outline">Candidate</Badge>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="p-0">
                          <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-4 font-sans text-sm leading-6">{candidate.content}</pre>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </>
          ) : null}
        </div>
      ) : null}

      <Dialog open={confirmApplyOpen} onOpenChange={setConfirmApplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Use {winner?.label.toLowerCase()}?</DialogTitle>
            <DialogDescription>
              This replaces the current draft content with the selected variation. Publishing status and history stay unchanged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={applying} onClick={() => setConfirmApplyOpen(false)} variant="outline">Cancel</Button>
            <Button disabled={applying} onClick={() => void applyWinner()}>
              {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Use selected variation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
