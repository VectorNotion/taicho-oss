"use client";

import { AlertCircle, Ban, Check, Image as ImageIcon, Loader2, RotateCcw, Video } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyablePrompt } from "./CopyablePrompt";
import type { CreativeRunView, VisualBrief } from "./media-types";

function visualLabel(value: string): string {
  return value.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function generationStage(run?: CreativeRunView): {
  badge: string;
  title: string;
  description: string;
  promptDone: boolean;
  providerDone: boolean;
  mediaActive: boolean;
  terminal: "failed" | "cancelled" | null;
} {
  if (run?.status === "failed" || run?.status === "cancelled") {
    const failed = run.status === "failed";
    return {
      badge: failed ? "Failed" : "Cancelled",
      title: failed ? `${run.mediaKind === "image" ? "Image" : "Video"} generation failed` : "Generation cancelled",
      description: run.error || (failed
        ? "The media provider could not complete this generation."
        : "This generation was cancelled before an asset was created."),
      promptDone: Boolean(run.provenance.compiledPrompt.trim()),
      providerDone: Boolean(run.provenance.providerRequestId),
      mediaActive: false,
      terminal: run.status,
    };
  }
  if (!run || run.status === "preparing") {
    return {
      badge: "Preparing",
      title: "Directing the media prompt",
      description: "The visual director is turning your brief and Content Base into a production-ready prompt.",
      promptDone: false,
      providerDone: false,
      mediaActive: false,
      terminal: null,
    };
  }
  if (run.status === "queued") {
    return {
      badge: "Prompt ready",
      title: "Preparing the provider request",
      description: "The detailed prompt is ready and the media request is being prepared.",
      promptDone: true,
      providerDone: false,
      mediaActive: false,
      terminal: null,
    };
  }
  if (run.status === "submitted") {
    return {
      badge: "Queued",
      title: "Request accepted by the provider",
      description: "The prompt is ready and the provider has accepted the generation request.",
      promptDone: true,
      providerDone: true,
      mediaActive: true,
      terminal: null,
    };
  }
  if (run.progress >= 85) {
    return {
      badge: "Finalizing",
      title: "Saving media to the gallery",
      description: "The provider finished generating and Taicho is storing the resulting media and attribution.",
      promptDone: true,
      providerDone: true,
      mediaActive: true,
      terminal: null,
    };
  }
  return {
    badge: "Generating",
    title: `Generating the ${run.mediaKind}`,
    description: "The provider is creating the media from the directed prompt. This card will become the finished asset.",
    promptDone: true,
    providerDone: true,
    mediaActive: true,
    terminal: null,
  };
}

function Step(props: { done: boolean; active: boolean; children: ReactNode }) {
  return (
    <div className={props.done || props.active ? "flex items-center gap-2 text-foreground" : "flex items-center gap-2 text-muted-foreground"}>
      {props.done ? <Check className="size-3.5 text-primary" /> : props.active ? <Loader2 className="size-3.5 animate-spin text-primary" /> : <span className="ml-1 size-1.5 rounded-full bg-muted-foreground/40" />}
      <span>{props.children}</span>
    </div>
  );
}

export function MediaGenerationCard(props: {
  brief: VisualBrief;
  run?: CreativeRunView;
  aspect?: "square" | "video";
  cancelling?: boolean;
  onCancel?: () => void;
  onRetry?: () => void;
}) {
  const stage = generationStage(props.run);
  const Icon = props.brief.kind === "image" ? ImageIcon : Video;
  const prompt = props.run?.provenance.compiledPrompt.trim();
  const execution = props.run?.provenance.provider && props.run.provenance.deploymentId
    ? `${props.run.provenance.provider} · ${props.run.provenance.deploymentId}`
    : undefined;
  const progress = props.run?.progress;
  const terminal = stage.terminal !== null;
  const TerminalIcon = stage.terminal === "failed" ? AlertCircle : Ban;

  return (
    <article
      aria-label={`${visualLabel(props.brief.visualType)} generation ${stage.terminal ?? "in progress"}`}
      className="overflow-hidden rounded-xl border bg-card"
    >
      <div className={`relative overflow-hidden bg-muted/20 ${props.aspect === "video" ? "aspect-video" : "aspect-square"}`}>
        {terminal ? null : <Skeleton className="absolute inset-0 rounded-none" />}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          <div className="rounded-full border bg-background/80 p-3 shadow-sm backdrop-blur-sm">
            {terminal ? <TerminalIcon className={stage.terminal === "failed" ? "size-6 text-destructive" : "size-6 text-muted-foreground"} /> : <Icon className="size-6 text-muted-foreground" />}
          </div>
          <Badge className="gap-1.5 bg-background/85 shadow-sm backdrop-blur-sm" variant={stage.terminal === "failed" ? "destructive" : "outline"}>
            {terminal ? null : <Loader2 className="size-3 animate-spin text-primary" />}
            {stage.badge}
          </Badge>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">{visualLabel(props.brief.visualType)}</p>
            <p className="mt-1 text-xs font-medium text-foreground">{stage.title}</p>
          </div>
          <Badge variant="outline">{props.brief.kind}</Badge>
        </div>

        {terminal ? (
          <div className="space-y-1 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs">
            <p className="font-medium text-foreground">{stage.description}</p>
            <p className="text-muted-foreground">This failed attempt is kept in the gallery so it remains visible after refresh.</p>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">{stage.description}</p>
        )}

        {prompt ? (
          <CopyablePrompt label="Directed prompt" prompt={prompt} />
        ) : terminal ? (
          <p className="rounded-lg bg-muted/20 p-3 text-xs text-muted-foreground">No directed prompt was produced before generation stopped.</p>
        ) : (
          <div className="space-y-2 rounded-lg bg-muted/20 p-3" aria-label="Media prompt is being prepared">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        )}

        <div className="space-y-1.5 text-xs">
          <Step active={!terminal && !stage.promptDone} done={stage.promptDone}>Create the directed prompt</Step>
          <Step active={!terminal && stage.promptDone && !stage.providerDone} done={stage.providerDone}>Submit to the media provider</Step>
          <Step active={!terminal && stage.mediaActive} done={false}>Generate and store the media</Step>
        </div>

        {execution ? <p className="truncate text-[11px] text-muted-foreground">{execution}</p> : null}

        {terminal ? null : <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{progress === undefined ? "Preparing request" : stage.title}</span>
            {progress === undefined ? null : <span>{progress}%</span>}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            {progress === undefined ? (
              <div className="h-full w-full animate-pulse rounded-full bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
            ) : (
              <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.max(5, progress)}%` }} />
            )}
          </div>
        </div>}

        {terminal && props.onRetry ? (
          <Button className="w-full" onClick={props.onRetry} size="sm">
            <RotateCcw className="size-4" />
            Try again
          </Button>
        ) : null}

        {!terminal && props.onCancel && props.run ? (
          <Button className="w-full" disabled={props.cancelling} onClick={props.onCancel} size="sm" variant="outline">
            {props.cancelling ? <Loader2 className="size-4 animate-spin" /> : null}
            Cancel generation
          </Button>
        ) : null}
      </div>
    </article>
  );
}
