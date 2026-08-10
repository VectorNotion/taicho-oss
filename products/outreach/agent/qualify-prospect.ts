/**
 * Prospect qualification orchestrator (docs/icp-update-v2.md §3, §11, §14).
 *
 * Behind the existing `qualify_prospect` action id:
 *   account resolution → freshness-lapsed dimension research (full/refresh) →
 *   fit match evaluation → deterministic scoring → qualification decision →
 *   persistence + `prospect.qualified` event.
 *
 * Fit gates. Timing ranks. Agents are never on the hot path; every dependency
 * is injectable (`deps`) so the orchestration is unit-testable without a graph
 * or model API.
 */
import { randomUUID } from 'node:crypto';
import { createLogger, observeOperation } from '@content-automation/observability';
import { emitProductEventFromContext } from '@content-automation/platform/events/emit';
import type { StreamEmit } from '@content-automation/platform/agents/streaming';
import {
  getProspectById as getProspectByIdDefault,
  updateProspectPriorityByScore as updateProspectPriorityByScoreDefault,
} from '../data/prospect-repository';
import { resolveAccountForProspect as resolveAccountForProspectDefault } from '../data/account-repository';
import { getDimensionDefinitions as getDimensionDefinitionsDefault } from '../data/dimension-repository';
import {
  getObservations as getObservationsDefault,
  hasAnyResearchRun as hasAnyResearchRunDefault,
  recordResearchRun as recordResearchRunDefault,
  saveMatches as saveMatchesDefault,
  saveProspectQualification as saveProspectQualificationDefault,
  upsertObservation as upsertObservationDefault,
} from '../data/qualification-repository';
import { researchDimensions as researchDimensionsDefault, type ResearchEntity } from './dimension-research';
import { evaluateFitMatches as evaluateFitMatchesDefault } from './match-evaluator';
import {
  ageDays,
  applyConfidenceRouting,
  computeFitScore,
  computeTimingScore,
} from '../domain/scoring';
import {
  DEFAULT_THRESHOLDS,
  type AccountRecord,
  type DimensionDefinition,
  type DimensionMatch,
  type ObservationRecord,
  type ProspectQualificationResult,
  type QualificationThresholds,
} from '../domain/qualification';
import type { Prospect } from '../domain/types';

const log = createLogger('prospect-qualification');

type EntityRef = { kind: 'account' | 'prospect'; id: string };

export interface QualifyProspectDeps {
  getProspectById: (id: string) => Promise<Prospect | null>;
  resolveAccountForProspect: (prospect: { id: string; company?: string }) => Promise<AccountRecord | null>;
  getDimensionDefinitions: (opts?: { activeOnly?: boolean; seedIfEmpty?: boolean }) => Promise<DimensionDefinition[]>;
  getObservations: (entity: EntityRef) => Promise<ObservationRecord[]>;
  upsertObservation: (entity: EntityRef, obs: Omit<ObservationRecord, 'id'>) => Promise<ObservationRecord>;
  researchDimensions: (
    dims: DimensionDefinition[],
    entity: ResearchEntity,
    runId: string,
    now: Date,
  ) => Promise<Array<Omit<ObservationRecord, 'id'>>>;
  evaluateFitMatches: (
    dims: DimensionDefinition[],
    observations: ObservationRecord[],
    now: Date,
  ) => Promise<DimensionMatch[]>;
  saveMatches: (entity: EntityRef, matches: DimensionMatch[]) => Promise<void>;
  saveProspectQualification: (prospectId: string, result: ProspectQualificationResult) => Promise<void>;
  recordResearchRun: (
    accountId: string,
    run: { runType: 'full' | 'refresh'; refreshedDimensions: string[] },
  ) => Promise<unknown>;
  hasAnyResearchRun: (accountId: string) => Promise<boolean>;
  updateProspectPriorityByScore: (prospectId: string, score: number) => Promise<unknown>;
  now: () => Date;
  thresholds: QualificationThresholds;
  onProgress?: (label: string, state: 'running' | 'done') => void;
}

export interface QualifyProspectResult {
  status: 'success' | 'skipped';
  qualification?: ProspectQualificationResult;
  reason?: string;
}

const defaultDeps: QualifyProspectDeps = {
  getProspectById: getProspectByIdDefault,
  resolveAccountForProspect: resolveAccountForProspectDefault,
  getDimensionDefinitions: getDimensionDefinitionsDefault,
  getObservations: getObservationsDefault,
  upsertObservation: upsertObservationDefault,
  researchDimensions: researchDimensionsDefault,
  evaluateFitMatches: evaluateFitMatchesDefault,
  saveMatches: saveMatchesDefault,
  saveProspectQualification: saveProspectQualificationDefault,
  recordResearchRun: recordResearchRunDefault,
  hasAnyResearchRun: hasAnyResearchRunDefault,
  updateProspectPriorityByScore: updateProspectPriorityByScoreDefault,
  now: () => new Date(),
  thresholds: DEFAULT_THRESHOLDS,
};

/** Progress adapter for the qualify stream route. */
export function streamingQualifyProgress(emit: StreamEmit): NonNullable<QualifyProspectDeps['onProgress']> {
  return (label, state) =>
    emit({
      type: 'data-progress',
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      data: { label, state },
    });
}

/** Dimensions whose latest observation is missing or older than its freshness window (spec §14). */
function lapsedDimensions(
  dims: DimensionDefinition[],
  observations: ObservationRecord[],
  now: Date,
): DimensionDefinition[] {
  const byKey = new Map(observations.map((o) => [o.dimensionKey, o]));
  return dims.filter((dim) => {
    const obs = byKey.get(dim.key);
    return !obs || ageDays(obs.researchedAt, now) > dim.freshnessWindowDays;
  });
}

async function refreshEntityObservations(
  d: QualifyProspectDeps,
  entity: EntityRef & ResearchEntity,
  dims: DimensionDefinition[],
  runId: string,
  now: Date,
): Promise<{ observations: ObservationRecord[]; refreshed: string[] }> {
  const existing = await d.getObservations({ kind: entity.kind, id: entity.id });
  const lapsed = lapsedDimensions(dims, existing, now);
  if (lapsed.length === 0) return { observations: existing, refreshed: [] };

  const fresh = await d.researchDimensions(lapsed, entity, runId, now);
  for (const obs of fresh) {
    await d.upsertObservation({ kind: entity.kind, id: entity.id }, obs);
  }
  return {
    observations: await d.getObservations({ kind: entity.kind, id: entity.id }),
    refreshed: lapsed.map((dim) => dim.key),
  };
}

/**
 * Qualify a prospect through the dimension pipeline.
 *
 * @param prospectId - the prospect to qualify
 * @param deps - optional dependency overrides (for testing / streaming progress)
 */
export async function runQualifyProspect(
  prospectId: string,
  deps: Partial<QualifyProspectDeps> = {},
): Promise<QualifyProspectResult> {
  const d: QualifyProspectDeps = { ...defaultDeps, ...deps };
  return observeOperation('outreach.prospect.qualify', { runId: prospectId, attributes: { prospect_id: prospectId } }, async () => {
    const prospect = await d.getProspectById(prospectId);
    if (!prospect) {
      throw new Error(`Prospect not found: ${prospectId}`);
    }

    const now = d.now();
    const runId = randomUUID();
    const progress = d.onProgress ?? (() => undefined);

    const dims = await d.getDimensionDefinitions({ activeOnly: true, seedIfEmpty: true });
    if (dims.length === 0) {
      log.info('outreach.qualification.skipped', { prospect_id: prospectId, reason: 'no_dimensions' });
      return { status: 'skipped', reason: 'no active dimension definitions' };
    }
    const accountFitDims = dims.filter((x) => x.appliesTo === 'account' && x.dimensionType === 'fit');
    const accountTimingDims = dims.filter((x) => x.appliesTo === 'account' && x.dimensionType === 'timing');
    const prospectFitDims = dims.filter((x) => x.appliesTo === 'prospect' && x.dimensionType === 'fit');

    progress('Resolving account', 'running');
    const account = await d.resolveAccountForProspect(prospect);
    progress('Resolving account', 'done');

    // ── Research (freshness-driven, spec §14) ──────────────────────────
    let accountObservations: ObservationRecord[] = [];
    let icpMatches: DimensionMatch[] = [];
    let timing: ReturnType<typeof computeTimingScore> = { score: 0, breakdown: [] };

    let refreshedAccountDims: string[] = [];
    if (account) {
      progress('Researching account', 'running');
      const runType = (await d.hasAnyResearchRun(account.id)) ? 'refresh' : 'full';
      const accountEntity = { kind: 'account' as const, id: account.id, name: account.name };
      const refreshed = await refreshEntityObservations(
        d,
        accountEntity,
        [...accountFitDims, ...accountTimingDims],
        runId,
        now,
      );
      accountObservations = refreshed.observations;
      refreshedAccountDims = refreshed.refreshed;
      await d.recordResearchRun(account.id, { runType, refreshedDimensions: refreshed.refreshed });
      progress('Researching account', 'done');

      progress('Evaluating company fit', 'running');
      icpMatches = await d.evaluateFitMatches(accountFitDims, accountObservations, now);
      await d.saveMatches({ kind: 'account', id: account.id }, icpMatches);
      progress('Evaluating company fit', 'done');

      timing = computeTimingScore(accountTimingDims, accountObservations, now);
    }

    progress('Researching prospect', 'running');
    const prospectEntity = {
      kind: 'prospect' as const,
      id: prospect.id,
      name: prospect.name,
      company: prospect.company,
      title: prospect.title,
    };
    const prospectRefreshed = await refreshEntityObservations(d, prospectEntity, prospectFitDims, runId, now);
    progress('Researching prospect', 'done');

    progress('Evaluating persona fit', 'running');
    const personaMatches = await d.evaluateFitMatches(prospectFitDims, prospectRefreshed.observations, now);
    await d.saveMatches({ kind: 'prospect', id: prospect.id }, personaMatches);
    progress('Evaluating persona fit', 'done');

    // ── Deterministic scoring + decision (spec §7, §8, §11) ────────────
    const icpScore = computeFitScore(icpMatches, accountFitDims);
    const personaScore = computeFitScore(personaMatches, prospectFitDims);
    const hardExcluded = [...icpMatches, ...personaMatches].some((m) => m.hardExclusion);

    let status: ProspectQualificationResult['status'];
    let reviewReason: string | undefined;
    if (!account) {
      // No company → account fit is unknowable; a human decides (spec §3 account resolution).
      status = 'REVIEW';
      reviewReason = 'prospect has no company; account fit is unknown';
    } else {
      const routed = applyConfidenceRouting({
        icpMatches,
        personaMatches,
        icpDims: accountFitDims,
        personaDims: prospectFitDims,
        hardExcluded,
        thresholds: d.thresholds,
      });
      status = routed.status;
      reviewReason = routed.reviewReason;
    }

    const qualification: ProspectQualificationResult = {
      status,
      icpScore,
      personaScore,
      timingScore: timing.score,
      icpMatches,
      personaMatches,
      timingBreakdown: timing.breakdown,
      reviewReason,
      computedAt: now.toISOString(),
    };

    await d.saveProspectQualification(prospectId, qualification);
    await d.updateProspectPriorityByScore(prospectId, Math.round(icpScore));

    emitProductEventFromContext({
      name: 'prospect.qualified',
      refs: { prospectId },
      payload: {
        status,
        icpScore,
        personaScore,
        timingScore: timing.score,
        refreshedDimensions: [...refreshedAccountDims, ...prospectRefreshed.refreshed],
      },
    });

    log.info('outreach.qualification.completed', {
      prospect_id: prospectId,
      status,
      icp_score: icpScore,
      persona_score: personaScore,
      timing_score: timing.score,
    });

    return { status: 'success', qualification };
  });
}
