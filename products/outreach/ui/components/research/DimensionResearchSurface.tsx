"use client";

import { CheckCircle2, ExternalLink, Loader2, Search } from "lucide-react";
import type { DimensionLane } from "./useDimensionResearch";

function LiveDot() {
  return (
    <span className="relative flex size-2">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75 motion-reduce:hidden" />
      <span className="relative inline-flex size-2 rounded-full bg-primary" />
    </span>
  );
}

function formatDimensionKey(key: string): string {
  return key.replaceAll("_", " ");
}

function LanePhase({ lane }: { lane: DimensionLane }) {
  if (lane.phase === "searching") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Searching
      </span>
    );
  }
  if (lane.phase === "found") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Search className="size-3" /> Evidence gathered
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-chart-2">
      <CheckCircle2 className="size-3" />
      {lane.matchScore != null
        ? lane.type === "timing"
          ? `${Math.round(lane.matchScore * 100)}% heat`
          : `${Math.round(lane.matchScore * 100)}% match`
        : "Scored"}
    </span>
  );
}

function LaneEvidence({ urls }: { urls: string[] }) {
  const unique = [...new Set(urls)].slice(0, 3);
  if (unique.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {unique.map((url) => (
        <a
          key={url}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
          href={url}
          rel="noopener noreferrer"
          target="_blank"
        >
          <ExternalLink className="size-3" />
          {(() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "source"; } })()}
        </a>
      ))}
    </div>
  );
}

/**
 * Streaming research surface: one lane per dimension, showing the raw
 * observation the researcher found + evidence, and the match once scored
 * (design 2026-08-10 §5–7). Pure render — driven by `useDimensionResearch`.
 */
export function DimensionResearchSurface({
  entityName,
  dimensions,
  isStreaming,
}: {
  entityName: string;
  dimensions: DimensionLane[];
  isStreaming: boolean;
}) {
  if (dimensions.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Starting research for {entityName}…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {isStreaming ? <LiveDot /> : <CheckCircle2 className="size-4 text-chart-2" />}
        {isStreaming ? `Researching ${entityName}` : `Research complete for ${entityName}`}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {dimensions.map((lane) => (
          <div key={lane.dimensionKey} className="animate-enter rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium capitalize">{formatDimensionKey(lane.name || lane.dimensionKey)}</span>
              <LanePhase lane={lane} />
            </div>
            {lane.observedValue ? (
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{lane.observedValue}</p>
            ) : null}
            {lane.signals && lane.signals.length > 0 ? (
              <ul className="mt-1.5 space-y-1">
                {lane.signals.slice(0, 4).map((signal, index) => (
                  <li key={index} className="flex items-baseline justify-between gap-2 text-sm text-muted-foreground">
                    <span className="truncate">{signal.signal}</span>
                    <span className="shrink-0 text-xs tabular-nums">{signal.date}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <LaneEvidence urls={lane.evidence ?? lane.signals?.flatMap((s) => s.evidence) ?? []} />
          </div>
        ))}
      </div>
    </div>
  );
}
