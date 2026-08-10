/**
 * Prospect qualification decision (docs/icp-update-v2.md §8, §11; design
 * 2026-08-10 §8). Reads the account's ICP + timing score and the prospect's
 * persona score, applies the deterministic §11 tree with confidence routing,
 * and writes the qualification. No research, no LLM — cheap enough to run on
 * demand or after either research operation completes.
 *
 * Fit gates. Timing ranks.
 */
import { createLogger, observeOperation } from '@content-automation/observability';
import { emitProductEventFromContext } from '@content-automation/platform/events/emit';
import {
  getProspectById as getProspectByIdDefault,
  updateProspectPriorityByScore as updateProspectPriorityByScoreDefault,
} from '../data/prospect-repository';
import { resolveAccountForProspect as resolveAccountForProspectDefault } from '../data/account-repository';
import {
  getAccountScore as getAccountScoreDefault,
  getProspectScore as getProspectScoreDefault,
  saveProspectQualification as saveProspectQualificationDefault,
  type AccountScoreRecord,
  type ProspectScoreRecord,
} from '../data/qualification-repository';
import { decideStatus } from '../domain/scoring';
import {
  DEFAULT_THRESHOLDS,
  type AccountRecord,
  type ProspectQualificationResult,
  type QualificationThresholds,
} from '../domain/qualification';
import type { Prospect } from '../domain/types';

const log = createLogger('prospect-qualification');

export interface QualifyProspectDeps {
  getProspectById: (id: string) => Promise<Prospect | null>;
  resolveAccountForProspect: (prospect: { id: string; company?: string }) => Promise<AccountRecord | null>;
  getAccountScore: (accountId: string) => Promise<AccountScoreRecord | null>;
  getProspectScore: (prospectId: string) => Promise<ProspectScoreRecord | null>;
  saveProspectQualification: (prospectId: string, result: ProspectQualificationResult) => Promise<void>;
  updateProspectPriorityByScore: (prospectId: string, score: number) => Promise<unknown>;
  now: () => Date;
  thresholds: QualificationThresholds;
}

export interface QualifyProspectResult {
  status: 'success' | 'skipped';
  qualification?: ProspectQualificationResult;
  reason?: string;
}

const defaultDeps: QualifyProspectDeps = {
  getProspectById: getProspectByIdDefault,
  resolveAccountForProspect: resolveAccountForProspectDefault,
  getAccountScore: getAccountScoreDefault,
  getProspectScore: getProspectScoreDefault,
  saveProspectQualification: saveProspectQualificationDefault,
  updateProspectPriorityByScore: updateProspectPriorityByScoreDefault,
  now: () => new Date(),
  thresholds: DEFAULT_THRESHOLDS,
};

/**
 * Decide a prospect's qualification from the already-computed entity scores.
 * @param prospectId - the prospect to qualify
 * @param deps - optional overrides (testing)
 */
export async function runQualifyProspect(
  prospectId: string,
  deps: Partial<QualifyProspectDeps> = {},
): Promise<QualifyProspectResult> {
  const d: QualifyProspectDeps = { ...defaultDeps, ...deps };
  return observeOperation('outreach.prospect.qualify', { runId: prospectId, attributes: { prospect_id: prospectId } }, async () => {
    const prospect = await d.getProspectById(prospectId);
    if (!prospect) throw new Error(`Prospect not found: ${prospectId}`);

    const now = d.now();
    const account = await d.resolveAccountForProspect(prospect);
    const accountScore = account ? await d.getAccountScore(account.id) : null;
    const prospectScore = await d.getProspectScore(prospectId);

    const icpScore = accountScore?.icpScore ?? 0;
    const timingScore = accountScore?.timingScore ?? 0;
    const personaScore = prospectScore?.personaScore ?? 0;
    const hardExcluded = Boolean(accountScore?.hardExcluded) || Boolean(prospectScore?.hardExcluded);

    let status: ProspectQualificationResult['status'];
    let reviewReason: string | undefined;

    if (!account) {
      // No company → account fit is unknowable; a human decides (spec §3).
      status = 'REVIEW';
      reviewReason = 'prospect has no company; account fit is unknown';
    } else {
      const baseline = decideStatus({ icpScore, personaScore, hardExcluded, thresholds: d.thresholds });
      const confident = decideStatus({
        icpScore: accountScore?.icpScoreConfident ?? 0,
        personaScore: prospectScore?.personaScoreConfident ?? 0,
        hardExcluded,
        thresholds: d.thresholds,
      });
      if (!hardExcluded && confident !== baseline) {
        // The decision flips when low-confidence findings are excluded (spec §8).
        status = 'REVIEW';
        reviewReason = `decision depends on low-confidence findings: ${baseline} → ${confident} when excluded`;
      } else {
        status = baseline;
      }
    }

    const qualification: ProspectQualificationResult = {
      status,
      icpScore,
      personaScore,
      timingScore,
      icpMatches: [],
      personaMatches: [],
      timingBreakdown: accountScore?.timingBreakdown ?? [],
      reviewReason,
      computedAt: now.toISOString(),
    };

    await d.saveProspectQualification(prospectId, qualification);
    await d.updateProspectPriorityByScore(prospectId, Math.round(icpScore));

    emitProductEventFromContext({
      name: 'prospect.qualified',
      refs: { prospectId },
      payload: { status, icpScore, personaScore, timingScore },
    });

    log.info('outreach.qualification.completed', { prospect_id: prospectId, status, icp_score: icpScore, persona_score: personaScore, timing_score: timingScore });
    return { status: 'success', qualification };
  });
}
