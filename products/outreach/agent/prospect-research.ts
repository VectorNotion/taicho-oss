/**
 * Prospect (person) research operation (design 2026-08-10 §6). Researches the
 * Persona dimensions — the person's fit (authority, problem ownership, change
 * mandate…) — writes the prospect's persona score, and chains the qualification
 * decision. Company research lives on the Account, not here.
 *
 * Fully injectable (`deps`) for unit testing without a graph or model API.
 */
import { randomUUID } from 'node:crypto';
import { createLogger, observeOperation } from '@content-automation/observability';
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

const log = createLogger('prospect-research');

type EntityRef = { kind: 'account' | 'prospect'; id: string };

export interface ProspectResearchDeps {
  getProspectById: (id: string) => Promise<Prospect | null>;
  getDimensionDefinitions: (opts?: { activeOnly?: boolean; seedIfEmpty?: boolean }) => Promise<DimensionDefinition[]>;
  getObservations: (entity: EntityRef) => Promise<ObservationRecord[]>;
  upsertObservation: (entity: EntityRef, obs: Omit<ObservationRecord, 'id'>) => Promise<ObservationRecord>;
  researchDimensions: (
    dims: DimensionDefinition[],
    entity: { kind: 'prospect'; name: string; company?: string; title?: string },
    runId: string,
    now: Date,
  ) => Promise<Array<Omit<ObservationRecord, 'id'>>>;
  evaluateFitMatches: (dims: DimensionDefinition[], observations: ObservationRecord[], now: Date) => Promise<DimensionMatch[]>;
  saveMatches: (entity: EntityRef, matches: DimensionMatch[]) => Promise<void>;
  saveProspectScore: (prospectId: string, score: { personaScore: number; personaScoreConfident: number; hardExcluded: boolean; reviewReason?: string; computedAt: string }) => Promise<void>;
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
  researchAccount: (
    accountId: string,
    opts: { cascade: boolean; forceRefresh?: boolean; onDimension?: (part: DimensionProgress) => void },
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

/**
 * Research the prospect's Persona dimensions, write the persona score, and
 * chain the qualification decision.
 */
export async function runProspectResearch(
  prospectId: string,
  deps: Partial<ProspectResearchDeps> = {},
): Promise<ProspectResearchOutcome> {
  const d: ProspectResearchDeps = { ...defaultDeps, ...deps };
  return observeOperation('outreach.prospect.research', { runId: prospectId, attributes: { prospect_id: prospectId } }, async () => {
    const prospect = await d.getProspectById(prospectId);
    if (!prospect) throw new Error(`Prospect not found: ${prospectId}`);

    const now = d.now();
    const runId = randomUUID();
    const emit = d.onDimension ?? (() => undefined);

    const dims = await d.getDimensionDefinitions({ activeOnly: true, seedIfEmpty: true });
    const personaDims = dims.filter((x) => x.appliesTo === 'prospect' && x.dimensionType === 'fit');
    const byKey = new Map(personaDims.map((dim) => [dim.key, dim]));

    const existing = await d.getObservations({ kind: 'prospect', id: prospectId });
    const dimensionsToResearch = d.forceRefresh
      ? personaDims
      : lapsedDimensions(personaDims, existing, now);
    for (const dim of dimensionsToResearch) emit({ dimensionKey: dim.key, name: dim.name, type: 'fit', phase: 'searching' });
    if (dimensionsToResearch.length > 0) {
      const fresh = await d.researchDimensions(
        dimensionsToResearch,
        { kind: 'prospect', name: prospect.name, company: prospect.company, title: prospect.title },
        runId,
        now,
      );
      const returnedKeys = new Set(fresh.map((observation) => observation.dimensionKey));
      const missing = dimensionsToResearch.filter((dimension) => !returnedKeys.has(dimension.key));
      if (missing.length > 0) {
        throw new Error(`Person research returned no result for: ${missing.map((dimension) => dimension.name).join(', ')}.`);
      }
      for (const obs of fresh) await d.upsertObservation({ kind: 'prospect', id: prospectId }, obs);
    }
    const observations = await d.getObservations({ kind: 'prospect', id: prospectId });
    for (const obs of observations) {
      const dim = byKey.get(obs.dimensionKey);
      if (!dim) continue;
      emit({ dimensionKey: dim.key, name: dim.name, type: 'fit', phase: 'found', observedValue: obs.observedValue, evidence: obs.evidence });
    }

    const matches = await d.evaluateFitMatches(personaDims, observations, now);
    await d.saveMatches({ kind: 'prospect', id: prospectId }, matches);
    for (const match of matches) {
      const dim = byKey.get(match.dimensionKey);
      emit({ dimensionKey: match.dimensionKey, name: dim?.name ?? match.dimensionKey, type: 'fit', phase: 'matched', matchScore: match.matchScore, classification: match.classification });
    }

    const personaScore = computeFitScore(matches, personaDims);
    const personaScoreConfident = computeFitScore(
      matches.filter((m) => m.confidence >= d.thresholds.lowConfidenceCutoff),
      personaDims,
    );
    const hardExcluded = matches.some((m) => m.hardExclusion);
    await d.saveProspectScore(prospectId, { personaScore, personaScoreConfident, hardExcluded, computedAt: now.toISOString() });

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
  });
}

/** Fire-and-forget version for prospect creation. */
export function runProspectResearchAsync(prospectId: string): void {
  runProspectResearch(prospectId).catch((error) => {
    log.error('outreach.research.background_failed', error, { prospect_id: prospectId });
  });
}
