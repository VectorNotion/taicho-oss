import { Badge } from "../ui/badge";
import { ScoreRing } from "./ScoreRing";
import { SegmentMeter } from "./SegmentMeter";

type ScoreTileBand = {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
};

/**
 * A self-explanatory score tile shared by the account detail and the prospect
 * fit assessment: a ring (fill = value / 100) beside the metric name, an
 * "out of 100" scale, a qualitative band badge, and a plain-language meaning.
 * Presentational only — the caller supplies the band and the explanation.
 */
export function ScoreTile({
  label,
  score,
  band,
  explanation,
}: {
  label: string;
  score: number | null;
  band: ScoreTileBand;
  explanation: string;
}) {
  return (
    <div className="flex items-start gap-4 rounded-xl border bg-card p-4">
      <ScoreRing label="" score={score == null ? null : Math.round(score)} />
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">out of 100</span>
          <Badge variant={band.variant}>{band.label}</Badge>
        </div>
        <SegmentMeter
          excluded={band.variant === "destructive"}
          fraction={score == null ? null : Math.max(0, Math.min(100, score)) / 100}
        />
        <p className="text-xs leading-5 text-muted-foreground">{explanation}</p>
      </div>
    </div>
  );
}
