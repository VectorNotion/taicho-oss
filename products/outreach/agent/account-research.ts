/**
 * Account (company) research operation (docs/icp-update-v2.md §4, §6, §14;
 * design 2026-08-10 §6). Researches the ICP dimensions — fit (structural) and
 * timing (dated signals) — and writes the account's ICP + timing scores,
 * independently of any prospect. Streams per-dimension progress.
 *
 * Fully injectable (`deps`) for unit testing without a graph or model API.
 */
import { randomUUID } from 'node:crypto';
import { createLogger, observeOperation } from '@content-automation/observability';
import {
  getAccountById as getAccountByIdDefault,
  getAccountProspects as getAccountProspectsDefault,
} from '../data/account-repository';
import { getDimensionDefinitions as getDimensionDefinitionsDefault } from '../data/dimension-repository';
import {
  getObservations as getObservationsDefault,
  hasAnyResearchRun as hasAnyResearchRunDefault,
  recordResearchRun as recordResearchRunDefault,
  saveAccountScore as saveAccountScoreDefault,
  saveMatches as saveMatchesDefault,
  upsertObservation as upsertObservationDefault,
  type AccountScoreRecord,
} from '../data/qualification-repository';
import { researchDimensions as researchDimensionsDefault } from './dimension-research';
import { evaluateFitMatches as evaluateFitMatchesDefault } from './match-evaluator';
import { streamingDimensionProgress, type DimensionProgress } from './dimension-progress';
import { ageDays, computeFitScore, computeTimingScore } from '../domain/scoring';
import {
  DEFAULT_THRESHOLDS,
  type DimensionDefinition,
  type DimensionMatch,
  type ObservationRecord,
  type QualificationThresholds,
  type TimingDimensionBreakdown,
} from '../domain/qualification';

const log = createLogger('account-research');

type EntityRef = { kind: 'account' | 'prospect'; id: string };

// Re-exported so the account research stream route can import both from here.
export { streamingDimensionProgress, type DimensionProgress };

export interface AccountResearchDeps {
  getAccountById: (id: string) => Promise<{ id: string; name: string } | null>;
  getDimensionDefinitions: (opts?: { activeOnly?: boolean; seedIfEmpty?: boolean }) => Promise<DimensionDefinition[]>;
  getObservations: (entity: EntityRef) => Promise<ObservationRecord[]>;
  upsertObservation: (entity: EntityRef, obs: Omit<ObservationRecord, 'id'>) => Promise<ObservationRecord>;
  researchDimensions: (
    dims: DimensionDefinition[],
    entity: { kind: 'account'; name: string },
    runId: string,
    now: Date,
  ) => Promise<Array<Omit<ObservationRecord, 'id'>>>;
  evaluateFitMatches: (dims: DimensionDefinition[], observations: ObservationRecord[], now: Date) => Promise<DimensionMatch[]>;
  saveMatches: (entity: EntityRef, matches: DimensionMatch[]) => Promise<void>;
  recordResearchRun: (accountId: string, run: { runType: 'full' | 'refresh'; refreshedDimensions: string[] }) => Promise<unknown>;
  hasAnyResearchRun: (accountId: string) => Promise<boolean>;
  saveAccountScore: (accountId: string, score: AccountScoreRecord) => Promise<void>;
  now: () => Date;
  thresholds: QualificationThresholds;
  onDimension?: (part: DimensionProgress) => void;
  /**
   * When not false, researching an account requalifies prospects that already
   * have Persona research and starts missing Persona research in the background.
   * A compact `onProspect` marker lets the account page show those background
   * runs. Cascaded prospect research uses `cascade: false` to avoid a loop.
   */
  cascade?: boolean;
  /** Explicit user-triggered research refreshes every account dimension. */
  forceRefresh?: boolean;
  getAccountProspects: (accountId: string) => Promise<string[]>;
  prospectHasResearch: (prospectId: string) => Promise<boolean>;
  researchProspect: (prospectId: string, opts: { cascade: boolean }) => void;
  /** Recompute an already-researched prospect against this account's new score. */
  qualifyProspect: (prospectId: string) => Promise<unknown>;
  onProspect?: (part: { prospectId: string; phase: 'researching' }) => void;
}

export interface AccountResearchResult {
  icpScore: number;
  timingScore: number;
  hardExcluded: boolean;
  icpMatches: DimensionMatch[];
  timingBreakdown: TimingDimensionBreakdown[];
}

const defaultDeps: AccountResearchDeps = {
  getAccountById: getAccountByIdDefault,
  getDimensionDefinitions: getDimensionDefinitionsDefault,
  getObservations: getObservationsDefault,
  upsertObservation: upsertObservationDefault,
  researchDimensions: researchDimensionsDefault,
  evaluateFitMatches: evaluateFitMatchesDefault,
  saveMatches: saveMatchesDefault,
  recordResearchRun: recordResearchRunDefault,
  hasAnyResearchRun: hasAnyResearchRunDefault,
  saveAccountScore: saveAccountScoreDefault,
  getAccountProspects: getAccountProspectsDefault,
  // "Researched" for a prospect = it has at least one observation.
  prospectHasResearch: async (prospectId) =>
    (await getObservationsDefault({ kind: 'prospect', id: prospectId })).length > 0,
  // Fire-and-forget; lazy import breaks the account-research <-> prospect-research cycle.
  researchProspect: (prospectId, opts) => {
    void import('./prospect-research').then(({ runProspectResearch }) =>
      runProspectResearch(prospectId, { cascade: opts.cascade }).catch((error) =>
        log.error('outreach.research.prospect_cascade_background_failed', error, { prospect_id: prospectId }),
      ),
    );
  },
  qualifyProspect: async (prospectId) => {
    const { runQualifyProspect } = await import('./qualify-prospect');
    return runQualifyProspect(prospectId);
  },
  now: () => new Date(),
  thresholds: DEFAULT_THRESHOLDS,
};

function lapsedDimensions(dims: DimensionDefinition[], observations: ObservationRecord[], now: Date): DimensionDefinition[] {
  const byKey = new Map(observations.map((o) => [o.dimensionKey, o]));
  return dims.filter((dim) => {
    const obs = byKey.get(dim.key);
    return !obs || ageDays(obs.researchedAt, now) > dim.freshnessWindowDays;
  });
}

/**
 * Research the account's ICP dimensions and write its ICP + timing scores.
 * @param accountId - the account to research
 * @param deps - optional overrides (testing / streaming progress)
 */
export async function runAccountResearch(
  accountId: string,
  deps: Partial<AccountResearchDeps> = {},
): Promise<AccountResearchResult> {
  const d: AccountResearchDeps = { ...defaultDeps, ...deps };
  return observeOperation('outreach.account.research', { runId: accountId, attributes: { account_id: accountId } }, async () => {
    const account = await d.getAccountById(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);

    const now = d.now();
    const runId = randomUUID();
    const emit = d.onDimension ?? (() => undefined);

    const dims = await d.getDimensionDefinitions({ activeOnly: true, seedIfEmpty: true });
    const fitDims = dims.filter((x) => x.appliesTo === 'account' && x.dimensionType === 'fit');
    const timingDims = dims.filter((x) => x.appliesTo === 'account' && x.dimensionType === 'timing');
    const allAccountDims = [...fitDims, ...timingDims];
    const byKey = new Map(allAccountDims.map((dim) => [dim.key, dim]));

    const runType = (await d.hasAnyResearchRun(accountId)) ? 'refresh' : 'full';

    // ── Research lapsed dimensions (spec §14) ────────────────────────────
    const existing = await d.getObservations({ kind: 'account', id: accountId });
    const dimensionsToResearch = d.forceRefresh
      ? allAccountDims
      : lapsedDimensions(allAccountDims, existing, now);
    for (const dim of dimensionsToResearch) {
      emit({ dimensionKey: dim.key, name: dim.name, type: dim.dimensionType, phase: 'searching' });
    }
    if (dimensionsToResearch.length > 0) {
      const fresh = await d.researchDimensions(dimensionsToResearch, { kind: 'account', name: account.name }, runId, now);
      const returnedKeys = new Set(fresh.map((observation) => observation.dimensionKey));
      const missing = dimensionsToResearch.filter((dimension) => !returnedKeys.has(dimension.key));
      if (missing.length > 0) {
        throw new Error(`Company research returned no result for: ${missing.map((dimension) => dimension.name).join(', ')}.`);
      }
      for (const obs of fresh) await d.upsertObservation({ kind: 'account', id: accountId }, obs);
    }
    const observations = await d.getObservations({ kind: 'account', id: accountId });

    // Emit 'found' for every dimension that now has an observation.
    for (const obs of observations) {
      const dim = byKey.get(obs.dimensionKey);
      if (!dim) continue;
      emit({
        dimensionKey: dim.key, name: dim.name, type: dim.dimensionType, phase: 'found',
        observedValue: obs.observedValue, signals: obs.signals, evidence: obs.evidence,
      });
    }

    // ── Evaluate + score (spec §4, §6, §8) ───────────────────────────────
    const icpMatches = await d.evaluateFitMatches(fitDims, observations, now);
    await d.saveMatches({ kind: 'account', id: accountId }, icpMatches);
    for (const match of icpMatches) {
      const dim = byKey.get(match.dimensionKey);
      emit({
        dimensionKey: match.dimensionKey, name: dim?.name ?? match.dimensionKey, type: 'fit', phase: 'matched',
        matchScore: match.matchScore, classification: match.classification,
      });
    }

    const timing = computeTimingScore(timingDims, observations, now);
    for (const entry of timing.breakdown) {
      const dim = byKey.get(entry.dimensionKey);
      emit({ dimensionKey: entry.dimensionKey, name: dim?.name ?? entry.dimensionKey, type: 'timing', phase: 'matched', matchScore: entry.dimensionValue });
    }

    const icpScore = computeFitScore(icpMatches, fitDims);
    const icpScoreConfident = computeFitScore(
      icpMatches.filter((m) => m.confidence >= d.thresholds.lowConfidenceCutoff),
      fitDims,
    );
    const hardExcluded = icpMatches.some((m) => m.hardExclusion);

    await d.saveAccountScore(accountId, {
      icpScore, icpScoreConfident, timingScore: timing.score, hardExcluded,
      timingBreakdown: timing.breakdown, computedAt: now.toISOString(),
    });
    await d.recordResearchRun(accountId, {
      runType,
      refreshedDimensions: dimensionsToResearch.map((dimension) => dimension.key),
    });

    log.info('outreach.account_research.completed', {
      account_id: accountId, icp_score: icpScore, timing_score: timing.score, hard_excluded: hardExcluded,
    });

    // Cascade: requalify prospects whose Persona score already exists, and
    // research the rest in the background. A compact `onProspect` marker lets
    // the account page show background work. Never fails the account.
    if (d.cascade !== false) {
      try {
        const prospectIds = await d.getAccountProspects(accountId);
        for (const pid of prospectIds) {
          if (await d.prospectHasResearch(pid)) {
            // Account research changes the ICP/timing inputs of every attached
            // prospect's qualification, even when their Persona score is fresh.
            try {
              await d.qualifyProspect(pid);
            } catch (error) {
              log.error('outreach.research.prospect_requalification_failed', error, {
                account_id: accountId,
                prospect_id: pid,
              });
            }
          } else {
            d.onProspect?.({ prospectId: pid, phase: 'researching' });
            d.researchProspect(pid, { cascade: false });
          }
        }
      } catch (error) {
        log.error('outreach.research.prospect_cascade_failed', error, { account_id: accountId });
      }
    }

    return { icpScore, timingScore: timing.score, hardExcluded, icpMatches, timingBreakdown: timing.breakdown };
  });
}
