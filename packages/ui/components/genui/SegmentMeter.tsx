import { cn } from "../../lib/utils";

/** Violet ramp, light → dark, one shade per segment. Filled segments deepen as
 * the value climbs, so more blocks AND darker blocks read as stronger. */
const SEGMENT_SHADES = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];

/**
 * A compact segmented meter shared across every score/weight surface so they
 * stay visually identical. `fraction` (0–1) fills that share of `segments`
 * blocks; each filled block takes an ever-darker shade of the brand violet,
 * empty blocks stay muted. `excluded` swaps the ramp for the destructive tone.
 * `null` renders an all-empty (not-yet-known) row.
 */
export function SegmentMeter({
  fraction,
  excluded = false,
  segments = 5,
  className,
}: {
  fraction: number | null;
  excluded?: boolean;
  segments?: number;
  className?: string;
}) {
  const clamped = fraction == null ? null : Math.max(0, Math.min(1, fraction));
  const filled = clamped == null ? 0 : Math.ceil(clamped * segments);
  return (
    <span aria-hidden className={cn("flex items-center gap-[3px]", className)}>
      {Array.from({ length: segments }).map((_, i) => {
        const on = i < filled;
        const tone = excluded
          ? on
            ? "bg-destructive"
            : "bg-destructive/25"
          : on
            ? SEGMENT_SHADES[Math.min(i, SEGMENT_SHADES.length - 1)]
            : "bg-muted";
        return <span className={`h-3.5 w-2 rounded-[2px] ${tone}`} key={i} />;
      })}
    </span>
  );
}
