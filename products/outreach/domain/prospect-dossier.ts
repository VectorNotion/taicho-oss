import {
  DEFAULT_THRESHOLDS,
  type DimensionDefinition,
  type DimensionMatch,
  type ObservationRecord,
  type ProspectQualificationResult,
  type QualificationStatus,
  type QualificationThresholds,
  type TimingDimensionBreakdown,
} from "./qualification";
import type { LegacyQualification } from "./types";

export type ResearchFreshnessStatus = "missing" | "partial" | "stale" | "fresh";

export interface ResearchFreshness {
  status: ResearchFreshnessStatus;
  configuredDimensionCount: number;
  researchedDimensionCount: number;
  missingDimensionKeys: string[];
  staleDimensionKeys: string[];
  latestResearchedAt: string | null;
}

export interface DossierFitFinding {
  dimensionKey: string;
  observedValue?: string;
  evidence: string[];
  confidence: number;
  researchedAt: string;
  match: DimensionMatch | null;
}

export interface DossierTimingFinding {
  dimensionKey: string;
  signals: NonNullable<ObservationRecord["signals"]>;
  evidence: string[];
  confidence: number;
  researchedAt: string;
  dimensionValue: number | null;
  signalCount: number;
}

export interface ProspectDossier {
  snapshotAt: string;
  prospect: {
    id: string;
    name: string;
    companyName: string | null;
  };
  person: {
    personaScore: number | null;
    hardExcluded: boolean;
    reviewReason: string | null;
    computedAt: string | null;
    research: ResearchFreshness;
    findings: DossierFitFinding[];
  };
  account: {
    id: string;
    name: string;
    prospectCount: number;
    qualifiedCount: number;
    isTarget: boolean;
    icpScore: number | null;
    timingScore: number | null;
    hardExcluded: boolean;
    reviewReason: string | null;
    computedAt: string | null;
    research: ResearchFreshness;
    fitFindings: DossierFitFinding[];
    timingFindings: DossierTimingFinding[];
  } | null;
  accountResolution: {
    state: "resolved" | "available" | "unavailable";
    companyName: string | null;
  };
  qualification: {
    status: QualificationStatus | null;
    thresholds: QualificationThresholds;
    explanation: string;
    recommendedAction: string;
    computedAt: string | null;
    isStale: boolean;
    icpMatches: DimensionMatch[];
    personaMatches: DimensionMatch[];
    timingBreakdown: TimingDimensionBreakdown[];
    legacy: LegacyQualification | null;
  };
}

export function researchFreshness(
  dimensions: DimensionDefinition[],
  observations: ObservationRecord[],
  now: Date,
): ResearchFreshness {
  const relevantKeys = new Set(dimensions.map((dimension) => dimension.key));
  const byKey = new Map(
    observations
      .filter((observation) => relevantKeys.has(observation.dimensionKey))
      .map((observation) => [observation.dimensionKey, observation]),
  );
  const missingDimensionKeys = dimensions
    .filter((dimension) => !byKey.has(dimension.key))
    .map((dimension) => dimension.key);
  const staleDimensionKeys = dimensions
    .filter((dimension) => {
      const observation = byKey.get(dimension.key);
      if (!observation) return false;
      const researchedAt = Date.parse(observation.researchedAt);
      if (!Number.isFinite(researchedAt)) return true;
      return now.getTime() - researchedAt > dimension.freshnessWindowDays * 86_400_000;
    })
    .map((dimension) => dimension.key);
  const researchedDates = [...byKey.values()]
    .map((observation) => Date.parse(observation.researchedAt))
    .filter(Number.isFinite);
  const status: ResearchFreshnessStatus = byKey.size === 0
    ? "missing"
    : missingDimensionKeys.length > 0
      ? "partial"
      : staleDimensionKeys.length > 0
        ? "stale"
        : "fresh";

  return {
    status,
    configuredDimensionCount: dimensions.length,
    researchedDimensionCount: byKey.size,
    missingDimensionKeys,
    staleDimensionKeys,
    latestResearchedAt: researchedDates.length > 0
      ? new Date(Math.max(...researchedDates)).toISOString()
      : null,
  };
}

function score(value: number | null): string {
  return value == null ? "not scored" : `${Math.round(value)}/100`;
}

export function qualificationNarrative(input: {
  qualification: ProspectQualificationResult | null;
  icpScore: number | null;
  personaScore: number | null;
  timingScore: number | null;
  thresholds?: QualificationThresholds;
}): { explanation: string; recommendedAction: string } {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const gateSummary = `Company fit is ${score(input.icpScore)} (minimum ${thresholds.icpMinimum}) and person fit is ${score(input.personaScore)} (minimum ${thresholds.personaMinimum}); timing is ${score(input.timingScore)} and ranks urgency without changing the qualification gate.`;
  if (!input.qualification) {
    return {
      explanation: `No final decision has been computed yet; ${gateSummary}`,
      recommendedAction: "Research the missing scope, then score the combined dossier.",
    };
  }

  const reason = input.qualification.reviewReason
    ? ` ${input.qualification.reviewReason}.`
    : "";
  const actions: Record<QualificationStatus, string> = {
    QUALIFIED: "Continue outreach and use timing signals to prioritize the next touch.",
    UNQUALIFIED: "Pause person-level outreach and decide whether the account is still worth pursuing.",
    REVIEW: "Review the weak or low-confidence evidence before continuing outreach.",
    HARD_EXCLUDED: "Do not pursue this person under the current targeting policy.",
    CONTACT_DISCOVERY_REQUIRED: "Keep the account and research a better-matched person.",
  };
  return {
    explanation: `${gateSummary}${reason}`,
    recommendedAction: actions[input.qualification.status],
  };
}

export function qualificationIsStale(
  qualificationComputedAt: string | null | undefined,
  scoreComputedAt: Array<string | null | undefined>,
  targetingUpdatedAt: Array<string | null | undefined> = [],
): boolean {
  if (!qualificationComputedAt) return false;
  const parseStoredTimestamp = (value: string): number => Date.parse(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
      ? `${value}Z`
      : value,
  );
  const qualificationTime = parseStoredTimestamp(qualificationComputedAt);
  const scoreTimes = scoreComputedAt
    .filter((value): value is string => value != null)
    .map(parseStoredTimestamp)
    .filter(Number.isFinite);
  const targetingTimes = targetingUpdatedAt
    .filter((value): value is string => value != null)
    .map(parseStoredTimestamp)
    .filter(Number.isFinite);
  if (scoreTimes.some((value) => value > qualificationTime)) return true;
  if (targetingTimes.some((value) => value > qualificationTime)) return true;
  if (scoreTimes.length === 0 || targetingTimes.length === 0) return false;
  const oldestScore = Math.min(...scoreTimes);
  return targetingTimes.some((value) => value > oldestScore);
}
