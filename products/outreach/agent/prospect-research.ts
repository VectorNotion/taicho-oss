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
import { getAccountForProspect as getAccountForProspectDefault } from '../data/account-repository';
import { getDimensionDefinitions as getDimensionDefinitionsDefault } from '../data/dimension-repository';
import {
  getObservations as getObservationsDefault,
  hasAnyResearchRun as hasAnyResearchRunDefault,
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
   * When not false, researching a prospect also researches its account (if the
   * account has never been researched), streaming the account's lanes as
   * `scope: 'account'`. The cascaded account research runs with `cascade: false`
   * so it does not bounce back to sibling prospects.
   */
  cascade?: boolean;
  getAccountForProspect: (prospectId: string) => Promise<{ id: string; name: string } | null>;
  accountHasResearch: (accountId: string) => Promise<boolean>;
  researchAccount: (
    accountId: string,
    opts: { cascade: boolean; onDimension?: (part: DimensionProgress) => void },
  ) => Promise<unknown>;
}

export interface ProspectResearchOutcome {
  personaScore: number;
  hardExcluded: boolean;
  matches: DimensionMatch[];
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
  getAccountForProspect: getAccountForProspectDefault,
  accountHasResearch: hasAnyResearchRunDefault,
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
    const lapsed = lapsedDimensions(personaDims, existing, now);
    for (const dim of lapsed) emit({ dimensionKey: dim.key, name: dim.name, type: 'fit', phase: 'searching' });
    if (lapsed.length > 0) {
      const fresh = await d.researchDimensions(
        lapsed,
        { kind: 'prospect', name: prospect.name, company: prospect.company, title: prospect.title },
        runId,
        now,
      );
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

    // Qualification is useful follow-on work but must not invalidate research.
    try {
      await d.runQualifyProspect(prospectId);
    } catch (error) {
      log.error('outreach.research.qualification_failed', error, { prospect_id: prospectId });
    }

    log.info('outreach.prospect_research.completed', { prospect_id: prospectId, persona_score: personaScore, hard_excluded: hardExcluded });

    // Cascade: also research the prospect's account if it has never been
    // researched, streaming the account's lanes into this same stream as
    // `scope: 'account'`. Failures here never fail the prospect research.
    if (d.cascade !== false) {
      try {
        const account = await d.getAccountForProspect(prospectId);
        if (account && !(await d.accountHasResearch(account.id))) {
          await d.researchAccount(account.id, {
            cascade: false,
            onDimension: (part) =>
              d.onDimension?.({ ...part, scope: 'account', entityName: account.name }),
          });
        }
      } catch (error) {
        log.error('outreach.research.account_cascade_failed', error, { prospect_id: prospectId });
      }
    }

    return { personaScore, hardExcluded, matches };
  });
}

/** Fire-and-forget version for prospect creation. */
export function runProspectResearchAsync(prospectId: string): void {
  runProspectResearch(prospectId).catch((error) => {
    log.error('outreach.research.background_failed', error, { prospect_id: prospectId });
  });
}
