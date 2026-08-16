/**
 * Prospect qualification decision (docs/icp-update-v2.md §8, §11; design
 * 2026-08-10 §8). Reads the account's ICP + timing score and the prospect's
 * persona score, applies the deterministic §11 tree with confidence routing,
 * and writes the qualification. No research, no LLM — cheap enough to run on
 * demand or after either research operation completes.
 *
 * Fit gates. Timing ranks.
 */
import {
  createLogger,
  observeOperation,
  observeWorkflow,
  observeWorkflowStep,
  traceable,
} from '@content-automation/observability';
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
import { summarizeDatabaseRead } from './research-tracing';

const log = createLogger('prospect-qualification');

export interface QualifyProspectDeps {
  getProspectById: (id: string) => Promise<Prospect | null>;
  resolveAccountForProspect: (prospect: { id: string; company?: string }) => Promise<AccountRecord | null>;
  getAccountScore: (accountId: string, catalogItemId?: string) => Promise<AccountScoreRecord | null>;
  getProspectScore: (prospectId: string, catalogItemId?: string) => Promise<ProspectScoreRecord | null>;
  saveProspectQualification: (prospectId: string, result: ProspectQualificationResult, catalogItemId?: string) => Promise<void>;
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

const loadQualificationContext = traceable(
  async (prospectId: string, deps: QualifyProspectDeps) => {
    const prospect = await deps.getProspectById(prospectId);
    if (!prospect) throw new Error(`Prospect not found: ${prospectId}`);
    const account = await deps.resolveAccountForProspect(prospect);
    const accountScore = account ? await deps.getAccountScore(account.id, prospect.catalogItemId) : null;
    const prospectScore = await deps.getProspectScore(prospectId, prospect.catalogItemId);
    const loaded = { prospect, account, accountScore, prospectScore };
    return {
      ...loaded,
      database: summarizeDatabaseRead('load_qualification_context', loaded, account ? 4 : 3, {
        prospects: 1,
        accounts: account ? 1 : 0,
        accountScores: accountScore ? 1 : 0,
        prospectScores: prospectScore ? 1 : 0,
      }),
    };
  },
  {
    name: 'research.qualification.load_context',
    kind: 'data',
    attributes: { 'taicho.data.system': 'falkordb', 'taicho.data.operation': 'load_qualification_context' },
    processInputs: ([prospectId]) => ({ prospectId }),
  },
);

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
  return observeOperation('outreach.prospect.qualify', { runId: prospectId, attributes: { prospect_id: prospectId } }, () =>
    observeWorkflow('research.qualification', {
      kind: 'workflow',
      input: { prospectId },
      attributes: { 'taicho.research.entity_kind': 'prospect' },
    }, async (workflow) => {
      const { prospect, account, accountScore, prospectScore } = await loadQualificationContext(prospectId, d);
      const now = d.now();

      const icpScore = accountScore?.icpScore ?? 0;
      const timingScore = accountScore?.timingScore ?? 0;
      const personaScore = prospectScore?.personaScore ?? 0;
      const hardExcluded = Boolean(accountScore?.hardExcluded) || Boolean(prospectScore?.hardExcluded);
      workflow.setInput({
        prospect: { id: prospect.id, name: prospect.name, title: prospect.title, company: prospect.company },
        account: account ? { id: account.id, name: account.name } : null,
        scores: {
          icp: icpScore,
          icpConfident: accountScore?.icpScoreConfident ?? 0,
          persona: personaScore,
          personaConfident: prospectScore?.personaScoreConfident ?? 0,
          timing: timingScore,
          hardExcluded,
        },
        thresholds: d.thresholds,
      });

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

      await observeWorkflowStep('research.qualification.persist', {
        kind: 'persistence',
        input: { prospectId, qualification, priorityScore: Math.round(icpScore) },
      }, async () => {
        await d.saveProspectQualification(prospectId, qualification, prospect.catalogItemId);
        await d.updateProspectPriorityByScore(prospectId, Math.round(icpScore));
        return { qualificationWritten: true, priorityWritten: true };
      });

      emitProductEventFromContext({
        name: 'prospect.qualified',
        refs: { prospectId },
        payload: { status, icpScore, personaScore, timingScore },
      });

      log.info('outreach.qualification.completed', { prospect_id: prospectId, status, icp_score: icpScore, persona_score: personaScore, timing_score: timingScore });
      return { status: 'success', qualification };
    }),
  );
}
