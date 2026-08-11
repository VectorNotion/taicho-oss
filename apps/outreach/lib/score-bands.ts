/**
 * Qualitative bands for the two account scores. Single source of truth so the
 * accounts list, the account detail page, and anything else that renders a
 * score agree on where "strong" ends and "weak" begins.
 *
 * The design system's chart palette is a single violet hue (no green/amber), so
 * strong-vs-weak is encoded on-brand: a segmented meter whose filled blocks
 * deepen through the violet ramp as the score climbs (more blocks + darker
 * shades = stronger), with red reserved for the hard-excluded state.
 */
export type BandVariant = "default" | "secondary" | "outline" | "destructive";

export type ScoreBand = { label: string; variant: BandVariant };

export function icpBand(score: number | null, hardExcluded: boolean): ScoreBand {
  if (hardExcluded) return { label: "Hard excluded", variant: "destructive" };
  if (score == null) return { label: "Not researched", variant: "secondary" };
  if (score >= 70) return { label: "Strong fit · target", variant: "default" };
  if (score >= 50) return { label: "Partial fit", variant: "secondary" };
  return { label: "Weak fit", variant: "outline" };
}

/** Persona (person-fit) band — same fit thresholds as ICP, worded for a person. */
export function personaBand(score: number | null, hardExcluded: boolean): ScoreBand {
  if (hardExcluded) return { label: "Excluded", variant: "destructive" };
  if (score == null) return { label: "Not researched", variant: "secondary" };
  if (score >= 70) return { label: "Strong fit", variant: "default" };
  if (score >= 50) return { label: "Partial fit", variant: "secondary" };
  return { label: "Weak fit", variant: "outline" };
}

export function timingBand(score: number | null): ScoreBand {
  if (score == null) return { label: "No signal yet", variant: "secondary" };
  if (score >= 66) return { label: "Hot", variant: "default" };
  if (score >= 33) return { label: "Warming", variant: "secondary" };
  if (score > 0) return { label: "Cool", variant: "outline" };
  return { label: "Cold", variant: "outline" };
}
