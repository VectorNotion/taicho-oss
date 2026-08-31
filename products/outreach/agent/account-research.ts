/**
 * Account (company) research operation (docs/icp-update-v2.md §4, §6, §14;
 * design 2026-08-10 §6). Researches the ICP dimensions — fit (structural) and
 * timing (dated signals) — and writes the account's ICP + timing scores,
 * independently of any prospect. Streams per-dimension progress.
 *
 * Fully injectable (`deps`) for unit testing without a graph or model API.
 */
import { randomUUID } from 'node:crypto';
import {
  createLogger,
  observeOperation,
  observeWorkflow,
  observeWorkflowStep,
  runDetachedWorkflow,
  traceable,
} from '@content-automation/observability';
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
  updateObservationLineage as updateObservationLineageDefault,
  upsertObservation as upsertObservationDefault,
  type AccountScoreRecord,
} from '../data/qualification-repository';
import { insufficientObservation, researchDimensions as researchDimensionsDefault } from './dimension-research';
import { evaluateFitMatches as evaluateFitMatchesDefault } from './match-evaluator';
import {
  evaluateFitMatchesVector,
  researchDimensionsVector,
  vectorScoringEnabled,
  VECTOR_THRESHOLDS,
} from './vector-research';
import { streamingDimensionProgress, type DimensionProgress, type ResearchActivity } from './dimension-progress';
import { ageDays, computeFitScore, computeTimingScore } from '../domain/scoring';
import {
  DEFAULT_THRESHOLDS,
  type DimensionDefinition,
  type DimensionMatch,
  type ObservationRecord,
  type QualificationThresholds,
  type TimingDimensionBreakdown,
} from '../domain/qualification';
import { summarizeDatabaseRead } from './research-tracing';
import { refreshAccountOpportunityAngles as refreshAccountOpportunityAnglesDefault } from './account-opportunities';
import { extractOutreachResearchKnowledge, ingestOutreachObservationKnowledge, recordOutreachKnowledgeAssessment } from '../knowledge-service';

const log = createLogger('account-research');

type EntityRef = { kind: 'account' | 'prospect'; id: string; catalogItemId?: string };

// Re-exported so the account research stream route can import both from here.
export { streamingDimensionProgress, type DimensionProgress };

export interface AccountResearchDeps {
  getAccountById: (id: string) => Promise<{ id: string; name: string } | null>;
  getDimensionDefinitions: (opts?: { activeOnly?: boolean; seedIfEmpty?: boolean; catalogItemId?: string }) => Promise<DimensionDefinition[]>;
  getObservations: (entity: EntityRef) => Promise<ObservationRecord[]>;
  upsertObservation: (entity: EntityRef, obs: Omit<ObservationRecord, 'id'>) => Promise<ObservationRecord>;
  updateObservationLineage?: typeof updateObservationLineageDefault;
  researchDimensions: (
    dims: DimensionDefinition[],
    entity: { kind: 'account'; id?: string; name: string; commercialContext?: string },
    runId: string,
    now: Date,
    options?: { onActivity?: (activity: ResearchActivity) => void },
  ) => Promise<Array<Omit<ObservationRecord, 'id'>>>;
  evaluateFitMatches: (dims: DimensionDefinition[], observations: ObservationRecord[], now: Date) => Promise<DimensionMatch[]>;
  saveMatches: (entity: EntityRef, matches: DimensionMatch[]) => Promise<void>;
  recordResearchRun: (accountId: string, run: { runType: 'full' | 'refresh'; refreshedDimensions: string[] }, catalogItemId?: string) => Promise<unknown>;
  hasAnyResearchRun: (accountId: string, catalogItemId?: string) => Promise<boolean>;
  saveAccountScore: (accountId: string, score: AccountScoreRecord, catalogItemId?: string) => Promise<void>;
  now: () => Date;
  thresholds: QualificationThresholds;
  onDimension?: (part: DimensionProgress) => void;
  onActivity?: (activity: ResearchActivity) => void;
  /**
   * When not false, researching an account requalifies prospects that already
   * have Persona research and starts missing Persona research in the background.
   * A compact `onProspect` marker lets the account page show those background
   * runs. Cascaded prospect research uses `cascade: false` to avoid a loop.
   */
  cascade?: boolean;
  /** Explicit user-triggered research refreshes every account dimension. */
  forceRefresh?: boolean;
  catalogItemId?: string;
  commercialContext?: string;
  getAccountProspects: (accountId: string) => Promise<string[]>;
  prospectHasResearch: (prospectId: string) => Promise<boolean>;
  researchProspect: (prospectId: string, opts: { cascade: boolean }) => void;
  /** Recompute an already-researched prospect against this account's new score. */
  qualifyProspect: (prospectId: string) => Promise<unknown>;
  onProspect?: (part: { prospectId: string; phase: 'researching' }) => void;
  refreshAccountOpportunityAngles: typeof refreshAccountOpportunityAnglesDefault;
  ingestObservationKnowledge?: typeof ingestOutreachObservationKnowledge;
  extractResearchKnowledge?: typeof extractOutreachResearchKnowledge;
  recordKnowledgeAssessment?: typeof recordOutreachKnowledgeAssessment;
}

export interface AccountResearchResult {
  icpScore: number;
  timingScore: number;
  hardExcluded: boolean;
  icpMatches: DimensionMatch[];
  timingBreakdown: TimingDimensionBreakdown[];
  /** Null for Catalog-scoped research; opportunity angles belong to the account baseline. */
  opportunityCount: number | null;
}

const defaultDeps: AccountResearchDeps = {
  getAccountById: getAccountByIdDefault,
  getDimensionDefinitions: getDimensionDefinitionsDefault,
  getObservations: getObservationsDefault,
  upsertObservation: upsertObservationDefault,
  updateObservationLineage: updateObservationLineageDefault,
  researchDimensions: (dims, entity, runId, now, options) => (
    vectorScoringEnabled()
      ? researchDimensionsVector(dims, entity, runId, now, options)
      : researchDimensionsDefault(dims, entity, runId, now, options)
  ),
  evaluateFitMatches: (dims, observations, now) => (
    vectorScoringEnabled()
      ? evaluateFitMatchesVector(dims, observations, now)
      : evaluateFitMatchesDefault(dims, observations, now)
  ),
  saveMatches: saveMatchesDefault,
  recordResearchRun: recordResearchRunDefault,
  hasAnyResearchRun: hasAnyResearchRunDefault,
  saveAccountScore: saveAccountScoreDefault,
  ingestObservationKnowledge: ingestOutreachObservationKnowledge,
  extractResearchKnowledge: extractOutreachResearchKnowledge,
  recordKnowledgeAssessment: recordOutreachKnowledgeAssessment,
  getAccountProspects: getAccountProspectsDefault,
  // "Researched" for a prospect = it has at least one observation.
  prospectHasResearch: async (prospectId) =>
    (await getObservationsDefault({ kind: 'prospect', id: prospectId })).length > 0,
  // Fire-and-forget; lazy import breaks the account-research <-> prospect-research cycle.
  researchProspect: (prospectId, opts) => {
    runDetachedWorkflow(() => {
      void import('./prospect-research').then(({ runProspectResearch }) =>
        runProspectResearch(prospectId, { cascade: opts.cascade }).catch((error) =>
          log.error('outreach.research.prospect_cascade_background_failed', error, { prospect_id: prospectId }),
        ),
      );
    });
  },
  qualifyProspect: async (prospectId) => {
    const { runQualifyProspect } = await import('./qualify-prospect');
    return runQualifyProspect(prospectId);
  },
  refreshAccountOpportunityAngles: refreshAccountOpportunityAnglesDefault,
  now: () => new Date(),
  thresholds: (process.env.RESEARCH_SCORING?.trim() === 'vector' ? VECTOR_THRESHOLDS : DEFAULT_THRESHOLDS),
};

function lapsedDimensions(dims: DimensionDefinition[], observations: ObservationRecord[], now: Date): DimensionDefinition[] {
  const byKey = new Map(observations.map((o) => [o.dimensionKey, o]));
  return dims.filter((dim) => {
    const obs = byKey.get(dim.key);
    return !obs || ageDays(obs.researchedAt, now) > dim.freshnessWindowDays;
  });
}

const loadAccountResearchContext = traceable(
  async (accountId: string, deps: AccountResearchDeps) => {
    const account = await deps.getAccountById(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);
    const dimensions = await deps.getDimensionDefinitions({ activeOnly: true, seedIfEmpty: true, catalogItemId: deps.catalogItemId });
    const hasPriorResearchRun = await deps.hasAnyResearchRun(accountId, deps.catalogItemId);
    const observations = await deps.getObservations({ kind: 'account', id: accountId, catalogItemId: deps.catalogItemId });
    const loaded = { account, dimensions, hasPriorResearchRun, observations };
    return {
      ...loaded,
      database: summarizeDatabaseRead('load_account_research_context', loaded, 4, {
        accounts: 1,
        dimensions: dimensions.length,
        observations: observations.length,
        priorResearchRuns: hasPriorResearchRun ? 1 : 0,
      }),
    };
  },
  {
    name: 'research.account.load_context',
    kind: 'data',
    attributes: { 'taicho.data.system': 'falkordb', 'taicho.data.operation': 'load_research_context' },
    processInputs: ([accountId]) => ({ accountId }),
  },
);

const planAccountRefresh = traceable(
  async (
    dimensions: DimensionDefinition[],
    observations: ObservationRecord[],
    now: Date,
    forceRefresh: boolean,
    hasPriorResearchRun: boolean,
  ) => {
    const dimensionsToResearch = forceRefresh
      ? dimensions
      : lapsedDimensions(dimensions, observations, now);
    const refreshKeys = new Set(dimensionsToResearch.map((dimension) => dimension.key));
    return {
      runType: hasPriorResearchRun ? 'refresh' as const : 'full' as const,
      dimensionsToResearch,
      decision: {
        forceRefresh,
        totalDimensions: dimensions.length,
        refreshedDimensions: dimensionsToResearch.map((dimension) => dimension.key),
        reusedDimensions: dimensions
          .filter((dimension) => !refreshKeys.has(dimension.key))
          .map((dimension) => {
            const observation = observations.find((candidate) => candidate.dimensionKey === dimension.key);
            return {
              key: dimension.key,
              ageDays: observation ? ageDays(observation.researchedAt, now) : null,
              freshnessWindowDays: dimension.freshnessWindowDays,
            };
          }),
      },
    };
  },
  {
    name: 'research.account.plan_refresh',
    kind: 'decision',
    processInputs: ([dimensions, observations, now, forceRefresh, hasPriorResearchRun]) => ({
      evaluatedAt: now,
      forceRefresh,
      hasPriorResearchRun,
      dimensions: dimensions.map((dimension) => ({
        key: dimension.key,
        freshnessWindowDays: dimension.freshnessWindowDays,
      })),
      observations: observations.map((observation) => ({
        dimensionKey: observation.dimensionKey,
        researchedAt: observation.researchedAt,
      })),
    }),
  },
);

const reloadAccountEvidence = traceable(
  async (accountId: string, deps: AccountResearchDeps) => {
    const observations = await deps.getObservations({ kind: 'account', id: accountId, catalogItemId: deps.catalogItemId });
    return {
      observations,
      database: summarizeDatabaseRead('reload_account_evidence', observations, 1, {
        observations: observations.length,
      }),
    };
  },
  {
    name: 'research.account.reload_evidence',
    kind: 'data',
    attributes: { 'taicho.data.system': 'falkordb', 'taicho.data.operation': 'reload_evidence' },
    processInputs: ([accountId]) => ({ accountId }),
  },
);

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
  return observeOperation('outreach.account.research', { runId: accountId, attributes: { account_id: accountId } }, () =>
    observeWorkflow('research.account', {
      kind: 'workflow',
      input: { accountId, forceRefresh: Boolean(d.forceRefresh), cascade: d.cascade !== false },
      attributes: {
        'taicho.research.entity_kind': 'account',
        'taicho.research.force_refresh': Boolean(d.forceRefresh),
      },
    }, async (workflow) => {
      const context = await loadAccountResearchContext(accountId, d);
      const { account, dimensions: dims, hasPriorResearchRun, observations: existing } = context;

      const now = d.now();
      const runId = randomUUID();
      const emit = d.onDimension ?? (() => undefined);

      const fitDims = dims.filter((dimension) => dimension.appliesTo === 'account' && dimension.dimensionType === 'fit');
      const timingDims = dims.filter((dimension) => dimension.appliesTo === 'account' && dimension.dimensionType === 'timing');
      const allAccountDims = [...fitDims, ...timingDims];
      const byKey = new Map(allAccountDims.map((dimension) => [dimension.key, dimension]));
      const refreshPlan = await planAccountRefresh(
        allAccountDims,
        existing,
        now,
        Boolean(d.forceRefresh),
        hasPriorResearchRun,
      );
      const { runType, dimensionsToResearch } = refreshPlan;

      workflow.setInput({
        subject: { id: account.id, name: account.name },
        runType,
        forceRefresh: Boolean(d.forceRefresh),
        cascade: d.cascade !== false,
        dimensions: allAccountDims.map((dimension) => ({
          key: dimension.key,
          name: dimension.name,
          type: dimension.dimensionType,
          instruction: dimension.researchInstruction,
          idealValue: dimension.idealValue,
        })),
      });

      for (const dimension of dimensionsToResearch) {
        emit({ dimensionKey: dimension.key, name: dimension.name, type: dimension.dimensionType, phase: 'searching' });
      }

      if (dimensionsToResearch.length > 0) {
        const researched = await d.researchDimensions(
          dimensionsToResearch,
          { kind: 'account', id: accountId, name: account.name, commercialContext: d.commercialContext },
          runId,
          now,
          { onActivity: d.onActivity },
        );
        const returnedByKey = new Map(researched.map((observation) => [observation.dimensionKey, observation]));
        const fresh = dimensionsToResearch.map((dimension) => (
          returnedByKey.get(dimension.key) ?? insufficientObservation(dimension, runId, now)
        ));
        await observeWorkflowStep('research.account.persist_observations', {
          kind: 'persistence',
          input: {
            accountId,
            observations: fresh.map((observation) => ({
              dimensionKey: observation.dimensionKey,
              confidence: observation.confidence,
              evidenceCount: observation.evidence.length,
            })),
          },
        }, async () => {
          for (const observation of fresh) {
            await d.upsertObservation(
              { kind: 'account', id: accountId, catalogItemId: d.catalogItemId },
              observation,
            );
          }
          return {
            observationsWritten: fresh.length,
            dimensionKeys: fresh.map((observation) => observation.dimensionKey),
          };
        });
        d.onActivity?.({
          type: 'observations_persisted',
          scope: 'account',
          occurredAt: new Date().toISOString(),
          observationCount: fresh.length,
          criteriaTotal: dimensionsToResearch.length,
          criteriaCompleted: fresh.length,
          criteriaWithoutEvidence: fresh.filter((observation) => observation.confidence <= 0).length,
        });

        d.onActivity?.({
          type: 'graph_enrichment_started',
          scope: 'account',
          occurredAt: new Date().toISOString(),
          observationCount: fresh.length,
        });
        try {
          const enrichment = await observeWorkflowStep('research.account.enrich_graph', {
            kind: 'persistence',
            input: { accountId, observationCount: fresh.length },
          }, async () => {
            const extracted = await d.extractResearchKnowledge?.({
              entity: { kind: 'account', id: accountId, name: account.name },
              observations: fresh,
            });
            for (const observation of fresh) {
              const lineage = extracted
                ? extracted.lineageByDimension[observation.dimensionKey] ?? { claimIds: [], evidenceIds: [] }
                : await d.ingestObservationKnowledge?.({ entity: { kind: 'account', id: accountId, name: account.name }, observation }) ?? { claimIds: [], evidenceIds: [] };
              if (d.updateObservationLineage) {
                await d.updateObservationLineage(
                  { kind: 'account', id: accountId, catalogItemId: d.catalogItemId },
                  { dimensionKey: observation.dimensionKey, runId: observation.runId, ...lineage },
                );
              } else if (lineage.claimIds.length > 0 || lineage.evidenceIds.length > 0) {
                await d.upsertObservation(
                  { kind: 'account', id: accountId, catalogItemId: d.catalogItemId },
                  { ...observation, ...lineage },
                );
              }
            }
            return {
              claimCount: extracted?.reconciled.claims.length ?? 0,
              entityCount: extracted?.entities.length ?? 0,
              warnings: [
                ...(extracted?.candidates.warnings ?? []),
                ...(extracted?.reviewRequired ?? []).map((reason) => `Graph candidate required review: ${reason}`),
              ].slice(0, 12),
            };
          });
          d.onActivity?.({
            type: 'graph_enrichment_completed',
            scope: 'account',
            occurredAt: new Date().toISOString(),
            claimCount: enrichment.claimCount,
            entityCount: enrichment.entityCount,
            warnings: enrichment.warnings,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn('outreach.research.graph_enrichment_skipped', { account_id: accountId, error: message });
          d.onActivity?.({
            type: 'graph_enrichment_warning',
            scope: 'account',
            occurredAt: new Date().toISOString(),
            error: message,
          });
        }
      }

      const { observations } = await reloadAccountEvidence(accountId, d);
      for (const observation of observations) {
        const dimension = byKey.get(observation.dimensionKey);
        if (!dimension) continue;
        emit({
          dimensionKey: dimension.key,
          name: dimension.name,
          type: dimension.dimensionType,
          phase: 'found',
          observedValue: observation.observedValue,
          signals: observation.signals,
          evidence: observation.evidence,
        });
      }

      d.onActivity?.({
        type: 'scoring_started',
        scope: 'account',
        occurredAt: new Date().toISOString(),
        criteriaTotal: allAccountDims.length,
      });
      const score = await observeWorkflowStep('research.account.score', {
        kind: 'scoring',
        input: {
          fitDimensions: fitDims,
          timingDimensions: timingDims,
          observations,
          lowConfidenceCutoff: d.thresholds.lowConfidenceCutoff,
        },
      }, async () => {
        const icpMatches = await d.evaluateFitMatches(fitDims, observations, now);
        const timing = computeTimingScore(timingDims, observations, now);
        const icpScore = computeFitScore(icpMatches, fitDims);
        const icpScoreConfident = computeFitScore(
          icpMatches.filter((match) => match.confidence >= d.thresholds.lowConfidenceCutoff),
          fitDims,
        );
        return {
          icpMatches,
          timing,
          icpScore,
          icpScoreConfident,
          hardExcluded: icpMatches.some((match) => match.hardExclusion),
        };
      });
      const { icpMatches, timing, icpScore, icpScoreConfident, hardExcluded } = score;
      const insufficientCriteria = icpMatches.filter((match) => match.classification === 'insufficient_evidence');
      const timingWithoutEvidence = timing.breakdown.filter((entry) => entry.signalCount === 0);

      for (const match of icpMatches) {
        const dimension = byKey.get(match.dimensionKey);
        emit({
          dimensionKey: match.dimensionKey,
          name: dimension?.name ?? match.dimensionKey,
          type: 'fit',
          phase: 'matched',
          matchScore: match.matchScore,
          classification: match.classification,
        });
      }
      for (const entry of timing.breakdown) {
        const dimension = byKey.get(entry.dimensionKey);
        emit({
          dimensionKey: entry.dimensionKey,
          name: dimension?.name ?? entry.dimensionKey,
          type: 'timing',
          phase: 'matched',
          matchScore: entry.dimensionValue,
        });
      }

      await observeWorkflowStep('research.account.persist_assessment', {
        kind: 'persistence',
        input: {
          accountId,
          icpMatches,
          icpScore,
          icpScoreConfident,
          timingScore: timing.score,
          hardExcluded,
          runType,
        },
      }, async () => {
        await d.saveMatches({ kind: 'account', id: accountId, catalogItemId: d.catalogItemId }, icpMatches);
        await d.saveAccountScore(accountId, {
          icpScore,
          icpScoreConfident,
          timingScore: timing.score,
          hardExcluded,
          ...(insufficientCriteria.length > 0 || timingWithoutEvidence.length > 0
            ? { reviewReason: `insufficient evidence for: ${[
                ...insufficientCriteria.map((match) => match.dimensionKey),
                ...timingWithoutEvidence.map((entry) => entry.dimensionKey),
              ].join(', ')}` }
            : {}),
          timingBreakdown: timing.breakdown,
          computedAt: now.toISOString(),
        }, d.catalogItemId);
        await d.recordResearchRun(accountId, {
          runType,
          refreshedDimensions: dimensionsToResearch.map((dimension) => dimension.key),
        }, d.catalogItemId);
        return { matchesWritten: icpMatches.length, scoreWritten: true, researchRunWritten: true };
      });

      d.onActivity?.({
        type: 'scoring_completed',
        scope: 'account',
        occurredAt: new Date().toISOString(),
        criteriaTotal: allAccountDims.length,
        criteriaCompleted: icpMatches.length + timing.breakdown.length,
        criteriaWithoutEvidence: insufficientCriteria.length + timingWithoutEvidence.length,
      });

      try {
        await d.recordKnowledgeAssessment?.({
          entity: { kind: 'account', id: accountId, name: account.name },
          observations,
          matches: icpMatches,
          policyKey: `outreach.icp.${d.catalogItemId ?? 'workspace'}`,
          result: {
            icpScore,
            icpScoreConfident,
            timingScore: timing.score,
            hardExcluded,
            timingBreakdown: timing.breakdown,
            computedAt: now.toISOString(),
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn('outreach.research.graph_assessment_skipped', { account_id: accountId, error: message });
        d.onActivity?.({
          type: 'graph_enrichment_warning',
          scope: 'account',
          occurredAt: new Date().toISOString(),
          error: `Research scoring was saved, but its Brain assessment could not be recorded: ${message}`,
        });
      }

      const opportunityCount = d.catalogItemId
        ? null
        : await observeWorkflowStep('research.account.generate_opportunity_angles', {
            kind: 'generation',
            input: {
              accountId,
              researchRunId: runId,
              observationCount: observations.length,
            },
          }, async () => {
            const result = await d.refreshAccountOpportunityAngles({
              account,
              dimensions: allAccountDims,
              observations,
              matches: icpMatches,
              timingBreakdown: timing.breakdown,
              researchRunId: runId,
              generatedAt: now.toISOString(),
            });
            return { opportunityCount: result.count };
          }).then((result) => result.opportunityCount);

      log.info('outreach.account_research.completed', {
        account_id: accountId,
        icp_score: icpScore,
        timing_score: timing.score,
        hard_excluded: hardExcluded,
      });
      d.onActivity?.({
        type: 'scope_completed',
        scope: 'account',
        occurredAt: new Date().toISOString(),
        criteriaTotal: allAccountDims.length,
        criteriaCompleted: icpMatches.length + timing.breakdown.length,
        criteriaWithoutEvidence: insufficientCriteria.length + timingWithoutEvidence.length,
      });

      if (d.cascade !== false) {
        await observeWorkflowStep('research.account.cascade', {
          kind: 'decision',
          input: { accountId },
        }, async () => {
          const summary = { requalified: [] as string[], researchStarted: [] as string[], failed: [] as string[] };
          try {
            const prospectIds = await d.getAccountProspects(accountId);
            for (const prospectId of prospectIds) {
              if (await d.prospectHasResearch(prospectId)) {
                try {
                  await d.qualifyProspect(prospectId);
                  summary.requalified.push(prospectId);
                } catch (error) {
                  summary.failed.push(prospectId);
                  log.error('outreach.research.prospect_requalification_failed', error, {
                    account_id: accountId,
                    prospect_id: prospectId,
                  });
                }
              } else {
                d.onProspect?.({ prospectId, phase: 'researching' });
                d.researchProspect(prospectId, { cascade: false });
                summary.researchStarted.push(prospectId);
              }
            }
          } catch (error) {
            log.error('outreach.research.prospect_cascade_failed', error, { account_id: accountId });
          }
          return summary;
        });
      }

      return {
        icpScore,
        timingScore: timing.score,
        hardExcluded,
        opportunityCount,
        icpMatches,
        timingBreakdown: timing.breakdown,
      };
    }),
  );
}
