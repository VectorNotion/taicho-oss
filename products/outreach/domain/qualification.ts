/**
 * Prospect Qualification & Scoring domain types (docs/icp-update-v2.md).
 *
 * ICP, Persona and Timing are all expressed as sets of DimensionDefinitions:
 *   ICP     = appliesTo 'account'  × dimensionType 'fit'
 *   Timing  = appliesTo 'account'  × dimensionType 'timing'
 *   Persona = appliesTo 'prospect' × dimensionType 'fit'
 *
 * Fit gates. Timing ranks. Timing Score never gates qualification (spec §11).
 */

export type DimensionType = 'fit' | 'timing';
export type DimensionAppliesTo = 'account' | 'prospect';

export interface DimensionDefinition {
  id: string;
  /** Stable snake_case key, e.g. 'internal_ai_capability'. */
  key: string;
  name: string;
  dimensionType: DimensionType;
  appliesTo: DimensionAppliesTo;
  /** What the research system should investigate (spec §2). */
  researchInstruction: string;
  /** What a strong match looks like. Fit dimensions only. */
  idealValue?: string;
  /** Relative weight inside its (appliesTo × dimensionType) group. */
  weight: number;
  /** Exponential-decay half-life in days. Timing dimensions only (spec §7). */
  halfLifeDays?: number;
  /** Days before an observation lapses and is re-researched (spec §14). */
  freshnessWindowDays: number;
  /** Deterministic pass/fail policy text; evaluator flags, policy gates (spec §12). */
  hardExclusionRule?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export type CreateDimensionInput = Omit<DimensionDefinition, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateDimensionInput = Partial<CreateDimensionInput>;

/** A single dated event inside a timing Observation (spec §2, Shape B). */
export interface TimingSignal {
  signal: string;
  /** ISO date (yyyy-mm-dd). The LLM extracts it; the decay formula judges it. */
  date: string;
  evidence: string[];
  confidence: number;
}

/** What research found for one dimension of one entity (spec §2). */
export interface ObservationRecord {
  id: string;
  dimensionKey: string;
  shape: 'prose' | 'signals';
  /** Shape A prose. Fit dimensions. */
  observedValue?: string;
  /** Shape B signal list. Timing dimensions. */
  signals?: TimingSignal[];
  evidence: string[];
  confidence: number;
  researchedAt: string;
  runId: string;
}

export type MatchClassification = 'strong_match' | 'partial_match' | 'weak_match' | 'mismatch';

/** How well an Observation matches a Dimension's ideal value (spec §2). */
export interface DimensionMatch {
  dimensionKey: string;
  /** Semantic match 0..1. */
  matchScore: number;
  /** matchScore × confidence (spec §8). */
  effectiveMatch: number;
  classification: MatchClassification;
  hardExclusion: boolean;
  /** Freshness-decayed observation confidence at evaluation time. */
  confidence: number;
}

export type QualificationStatus =
  | 'QUALIFIED'
  | 'UNQUALIFIED'
  | 'REVIEW'
  | 'HARD_EXCLUDED'
  | 'CONTACT_DISCOVERY_REQUIRED';

export interface QualificationThresholds {
  icpMinimum: number;
  personaMinimum: number;
  /** Observations below this effective confidence trigger REVIEW when decisive (spec §8). */
  lowConfidenceCutoff: number;
}

export const DEFAULT_THRESHOLDS: QualificationThresholds = {
  icpMinimum: 70,
  personaMinimum: 65,
  lowConfidenceCutoff: 0.5,
};

export interface TimingDimensionBreakdown {
  dimensionKey: string;
  /** Capped decayed signal mass, 0..1. */
  dimensionValue: number;
  signalCount: number;
}

export interface ProspectQualificationResult {
  status: QualificationStatus;
  icpScore: number;
  personaScore: number;
  timingScore: number;
  icpMatches: DimensionMatch[];
  personaMatches: DimensionMatch[];
  timingBreakdown: TimingDimensionBreakdown[];
  reviewReason?: string;
  computedAt: string;
}

export interface ResearchRunRecord {
  id: string;
  runType: 'full' | 'refresh';
  refreshedDimensions: string[];
  createdAt: string;
}

export interface AccountRecord {
  id: string;
  name: string;
  normalizedName: string;
  createdAt: string;
}
