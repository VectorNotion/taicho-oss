/**
 * Prospect (person) research operation (design 2026-08-10 §6). Researches the
 * Persona dimensions — the person's fit (authority, problem ownership, change
 * mandate…) — writes the prospect's persona score, and chains the qualification
 * decision. Company research lives on the Account, not here.
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
import { emitProductEventFromContext } from '@content-automation/platform/events/emit';
import { getProspectById as getProspectByIdDefault } from '../data/prospect-repository';
import { resolveAccountForProspect as resolveAccountForProspectDefault } from '../data/account-repository';
import { getDimensionDefinitions as getDimensionDefinitionsDefault } from '../data/dimension-repository';
import {
  getObservations as getObservationsDefault,
  saveMatches as saveMatchesDefault,
  saveProspectScore as saveProspectScoreDefault,
  upsertObservation as upsertObservationDefault,
} from '../data/qualification-repository';
import { researchDimensions as researchDimensionsDefault } from './dimension-research';
import { evaluateFitMatches as evaluateFitMatchesDefault } from './match-evaluator';
import { runQualifyProspect as runQualifyProspectDefault } from './qualify-prospect';
import type { DimensionProgress } from './dimension-progress';
import { ageDays, computeFitScore } from '../domain/scoring';
import {
  DEFAULT_THRESHOLDS,
  type DimensionDefinition,
  type DimensionMatch,
  type ObservationRecord,
  type QualificationThresholds,
} from '../domain/qualification';
import type { Prospect } from '../domain/types';
import type { AccountResearchResult } from './account-research';
import { summarizeDatabaseRead } from './research-tracing';
import { getProspectCatalogItem as getProspectCatalogItemDefault } from '../data/catalog-repository';
import { catalogItemContext } from '../domain/catalog';

const log = createLogger('prospect-research');

type EntityRef = { kind: 'account' | 'prospect'; id: string; catalogItemId?: string };

export interface ProspectResearchDeps {
  getProspectById: (id: string) => Promise<Prospect | null>;
  getDimensionDefinitions: (opts?: { activeOnly?: boolean; seedIfEmpty?: boolean; catalogItemId?: string }) => Promise<DimensionDefinition[]>;
  getObservations: (entity: EntityRef) => Promise<ObservationRecord[]>;
  upsertObservation: (entity: EntityRef, obs: Omit<ObservationRecord, 'id'>) => Promise<ObservationRecord>;
  researchDimensions: (
    dims: DimensionDefinition[],
    entity: { kind: 'prospect'; id?: string; name: string; company?: string; title?: string; commercialContext?: string },
    runId: string,
    now: Date,
  ) => Promise<Array<Omit<ObservationRecord, 'id'>>>;
  evaluateFitMatches: (dims: DimensionDefinition[], observations: ObservationRecord[], now: Date) => Promise<DimensionMatch[]>;
  saveMatches: (entity: EntityRef, matches: DimensionMatch[]) => Promise<void>;
  saveProspectScore: (prospectId: string, score: { personaScore: number; personaScoreConfident: number; hardExcluded: boolean; reviewReason?: string; computedAt: string }, catalogItemId?: string) => Promise<void>;
  runQualifyProspect: (prospectId: string) => Promise<unknown>;
  now: () => Date;
  thresholds: QualificationThresholds;
  onDimension?: (part: DimensionProgress) => void;
  /**
   * When not false, researching a prospect also runs its account research,
   * streaming the account's lanes as `scope: 'account'`. Account research
   * refreshes stale dimensions and reuses fresh evidence. It runs with
   * `cascade: false` so it does not bounce back to sibling prospects.
   */
  cascade?: boolean;
  /** Explicit user-triggered research refreshes every person and company dimension. */
  forceRefresh?: boolean;
  resolveAccountForProspect: (prospect: Prospect) => Promise<{ id: string; name: string } | null>;
  getProspectCatalogItem: typeof getProspectCatalogItemDefault;
  researchAccount: (
    accountId: string,
    opts: { cascade: boolean; forceRefresh?: boolean; onDimension?: (part: DimensionProgress) => void; catalogItemId?: string; commercialContext?: string },
  ) => Promise<AccountResearchResult>;
}

export interface ProspectResearchOutcome {
  personaScore: number;
  hardExcluded: boolean;
  matches: DimensionMatch[];
  account: ({ id: string; name: string } & AccountResearchResult) | null;
}

const defaultDeps: ProspectResearchDeps = {
  getProspectById: getProspectByIdDefault,
  getDimensionDefinitions: getDimensionDefinitionsDefault,
  getObservations: getObservationsDefault,
  upsertObservation: upsertObservationDefault,
  researchDimensions: researchDimensionsDefault,
  evaluateFitMatches: evaluateFitMatchesDefault,
  saveMatches: saveMatchesDefault,
  saveProspectScore: saveProspectScoreDefault,
  runQualifyProspect: runQualifyProspectDefault,
  resolveAccountForProspect: resolveAccountForProspectDefault,
  getProspectCatalogItem: getProspectCatalogItemDefault,
  // Lazy import breaks the prospect-research <-> account-research cycle.
  researchAccount: async (accountId, opts) => {
    const { runAccountResearch } = await import('./account-research');
    return runAccountResearch(accountId, opts);
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

const loadProspectResearchContext = traceable(
  async (prospectId: string, deps: ProspectResearchDeps) => {
    const prospect = await deps.getProspectById(prospectId);
    if (!prospect) throw new Error(`Prospect not found: ${prospectId}`);
    const catalogItem = prospect.catalogItemId
      ? await deps.getProspectCatalogItem(prospectId)
      : null;
    const dimensions = await deps.getDimensionDefinitions({ activeOnly: true, seedIfEmpty: true, catalogItemId: catalogItem?.id });
    const observations = await deps.getObservations({ kind: 'prospect', id: prospectId, catalogItemId: catalogItem?.id });
    const loaded = { prospect, catalogItem, dimensions, observations };
    return {
      ...loaded,
      database: summarizeDatabaseRead('load_person_research_context', loaded, 3, {
        prospects: 1,
        dimensions: dimensions.length,
        observations: observations.length,
      }),
    };
  },
  {
    name: 'research.person.load_context',
    kind: 'data',
    attributes: { 'taicho.data.system': 'falkordb', 'taicho.data.operation': 'load_research_context' },
    processInputs: ([prospectId]) => ({ prospectId }),
  },
);

const planProspectRefresh = traceable(
  async (
    dimensions: DimensionDefinition[],
    observations: ObservationRecord[],
    now: Date,
    forceRefresh: boolean,
  ) => {
    const dimensionsToResearch = forceRefresh
      ? dimensions
      : lapsedDimensions(dimensions, observations, now);
    const refreshKeys = new Set(dimensionsToResearch.map((dimension) => dimension.key));
    return {
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
    name: 'research.person.plan_refresh',
    kind: 'decision',
    processInputs: ([dimensions, observations, now, forceRefresh]) => ({
      evaluatedAt: now,
      forceRefresh,
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

const reloadProspectEvidence = traceable(
  async (prospectId: string, catalogItemId: string | undefined, deps: ProspectResearchDeps) => {
    const observations = await deps.getObservations({ kind: 'prospect', id: prospectId, catalogItemId });
    return {
      observations,
      database: summarizeDatabaseRead('reload_person_evidence', observations, 1, {
        observations: observations.length,
      }),
    };
  },
  {
    name: 'research.person.reload_evidence',
    kind: 'data',
    attributes: { 'taicho.data.system': 'falkordb', 'taicho.data.operation': 'reload_evidence' },
    processInputs: ([prospectId]) => ({ prospectId }),
  },
);

/**
 * Research the prospect's Persona dimensions, write the persona score, and
 * chain the qualification decision.
 */
export async function runProspectResearch(
  prospectId: string,
  deps: Partial<ProspectResearchDeps> = {},
): Promise<ProspectResearchOutcome> {
  const d: ProspectResearchDeps = { ...defaultDeps, ...deps };
  return observeOperation('outreach.prospect.research', { runId: prospectId, attributes: { prospect_id: prospectId } }, () =>
    observeWorkflow('research.person', {
      kind: 'workflow',
      input: { prospectId, forceRefresh: Boolean(d.forceRefresh), includeAccount: d.cascade !== false },
      attributes: {
        'taicho.research.entity_kind': 'prospect',
        'taicho.research.force_refresh': Boolean(d.forceRefresh),
      },
    }, async (workflow) => {
      const context = await loadProspectResearchContext(prospectId, d);
      const { prospect, catalogItem, dimensions: dims, observations: existing } = context;
      const commercialContext = catalogItemContext(catalogItem);

      const now = d.now();
      const runId = randomUUID();
      const emit = d.onDimension ?? (() => undefined);

      const personaDims = dims.filter((x) => x.appliesTo === 'prospect' && x.dimensionType === 'fit');
      const byKey = new Map(personaDims.map((dim) => [dim.key, dim]));
      const refreshPlan = await planProspectRefresh(personaDims, existing, now, Boolean(d.forceRefresh));
      const { dimensionsToResearch } = refreshPlan;
      workflow.setInput({
        subject: {
          id: prospect.id,
          name: prospect.name,
          title: prospect.title,
          company: prospect.company,
        },
        forceRefresh: Boolean(d.forceRefresh),
        includeAccount: d.cascade !== false,
        dimensions: personaDims.map((dimension) => ({
          key: dimension.key,
          name: dimension.name,
          instruction: dimension.researchInstruction,
          idealValue: dimension.idealValue,
        })),
      });

      for (const dim of dimensionsToResearch) emit({ dimensionKey: dim.key, name: dim.name, type: 'fit', phase: 'searching' });
      if (dimensionsToResearch.length > 0) {
        const fresh = await d.researchDimensions(
          dimensionsToResearch,
          { kind: 'prospect', id: prospectId, name: prospect.name, company: prospect.company, title: prospect.title, commercialContext },
          runId,
          now,
        );
        const returnedKeys = new Set(fresh.map((observation) => observation.dimensionKey));
        const missing = dimensionsToResearch.filter((dimension) => !returnedKeys.has(dimension.key));
        if (missing.length > 0) {
          throw new Error(`Person research returned no result for: ${missing.map((dimension) => dimension.name).join(', ')}.`);
        }
        await observeWorkflowStep('research.person.persist_observations', {
          kind: 'persistence',
          input: {
            prospectId,
            observations: fresh.map((observation) => ({
              dimensionKey: observation.dimensionKey,
              confidence: observation.confidence,
              evidenceCount: observation.evidence.length,
            })),
          },
        }, async () => {
          for (const observation of fresh) {
            await d.upsertObservation({ kind: 'prospect', id: prospectId, catalogItemId: catalogItem?.id }, observation);
          }
          return { observationsWritten: fresh.length, dimensionKeys: fresh.map((observation) => observation.dimensionKey) };
        });
      }
      const { observations } = await reloadProspectEvidence(prospectId, catalogItem?.id, d);
      for (const obs of observations) {
        const dim = byKey.get(obs.dimensionKey);
        if (!dim) continue;
        emit({ dimensionKey: dim.key, name: dim.name, type: 'fit', phase: 'found', observedValue: obs.observedValue, evidence: obs.evidence });
      }

      const score = await observeWorkflowStep('research.person.score', {
        kind: 'scoring',
        input: {
          dimensions: personaDims,
          observations,
          lowConfidenceCutoff: d.thresholds.lowConfidenceCutoff,
        },
      }, async () => {
        const matches = await d.evaluateFitMatches(personaDims, observations, now);
        const personaScore = computeFitScore(matches, personaDims);
        const personaScoreConfident = computeFitScore(
          matches.filter((match) => match.confidence >= d.thresholds.lowConfidenceCutoff),
          personaDims,
        );
        return {
          matches,
          personaScore,
          personaScoreConfident,
          hardExcluded: matches.some((match) => match.hardExclusion),
        };
      });
      const { matches, personaScore, personaScoreConfident, hardExcluded } = score;
      for (const match of matches) {
        const dim = byKey.get(match.dimensionKey);
        emit({ dimensionKey: match.dimensionKey, name: dim?.name ?? match.dimensionKey, type: 'fit', phase: 'matched', matchScore: match.matchScore, classification: match.classification });
      }

      await observeWorkflowStep('research.person.persist_assessment', {
        kind: 'persistence',
        input: { prospectId, matches, personaScore, personaScoreConfident, hardExcluded },
      }, async () => {
        await d.saveMatches({ kind: 'prospect', id: prospectId, catalogItemId: catalogItem?.id }, matches);
        await d.saveProspectScore(prospectId, { personaScore, personaScoreConfident, hardExcluded, computedAt: now.toISOString() }, catalogItem?.id);
        return { matchesWritten: matches.length, scoreWritten: true };
      });

      emitProductEventFromContext({ name: 'prospect.researched', refs: { prospectId } });

    // A company name is sufficient to resolve/create the Account here. Imported
    // prospects may predate the BELONGS_TO edge, so merely looking up an
    // existing edge can silently skip required company research.
      let accountResearch: ProspectResearchOutcome['account'] = null;
      if (d.cascade !== false && prospect.company?.trim()) {
        const account = await d.resolveAccountForProspect(prospect);
        if (!account) {
          throw new Error(`Could not resolve the company account for ${prospect.company}.`);
        }
        try {
          const result = await d.researchAccount(account.id, {
            cascade: false,
            forceRefresh: d.forceRefresh,
            onDimension: (part) =>
              d.onDimension?.({ ...part, scope: 'account', entityName: account.name }),
            catalogItemId: catalogItem?.id,
            commercialContext,
          });
          accountResearch = { id: account.id, name: account.name, ...result };
        } catch (error) {
          log.error('outreach.research.account_cascade_failed', error, { prospect_id: prospectId });
          throw new Error(`Company research failed for ${account.name}.`, { cause: error });
        }
      }

    // Qualify only after the required account cascade. Qualification reads the
    // saved Persona + ICP + Timing scores, so running it earlier would persist
    // the account's pre-research values and force the user to re-score manually.
    // It is part of the research contract: a stale qualification must never be
    // reported as a successfully completed composite run.
      await d.runQualifyProspect(prospectId);

      log.info('outreach.prospect_research.completed', { prospect_id: prospectId, persona_score: personaScore, hard_excluded: hardExcluded });

      return { personaScore, hardExcluded, matches, account: accountResearch };
    }),
  );
}

/** Fire-and-forget version for prospect creation. */
export function runProspectResearchAsync(prospectId: string): void {
  runDetachedWorkflow(() => {
    void runProspectResearch(prospectId).catch((error) => {
      log.error('outreach.research.background_failed', error, { prospect_id: prospectId });
    });
  });
}
