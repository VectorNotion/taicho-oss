/**
 * Lead qualification orchestrator (Mastra migration of the `qualify_lead` action).
 *
 * Flow (spec §8): getLeadById + getLeadResearch → getPersonas(true).
 * If there are no active personas → status 'skipped', no write.
 * Otherwise score the lead against each active persona (temp 0.2, structured
 * output) and persist the highest-scoring match.
 *
 * Agents are never on the hot path: this runs offline via the job runner.
 * Dependencies are injectable (`deps`) so the orchestration can be unit-tested
 * without touching Neo4j or the model API.
 */
import { Agent } from '@mastra/core/agent';
import { createLogger, observeOperation } from '@content-automation/observability';
import { registerObservedAgent } from '@content-automation/observability/ai';
import { routerModel } from '@content-automation/platform/agents/model';
import { emitProductEventFromContext } from '@content-automation/platform/events/emit';
import { z } from 'zod';
import { getSettings as getSettingsDefault } from '@content-automation/platform/settings/repository';
import type { Settings } from '@content-automation/platform/settings/types';
import { streamingStructuredGenerate, type StreamEmit } from '@content-automation/platform/agents/streaming';
import {
  getLeadById as getLeadByIdDefault,
  getLeadResearch as getLeadResearchDefault,
  createLeadQualification as createLeadQualificationDefault,
  updateLeadPriorityByScore as updateLeadPriorityByScoreDefault,
} from '../data/lead-repository';
import { getPersonas as getPersonasDefault } from '../data/persona-repository';
import type {
  CreateQualificationInput,
  Lead,
  LeadQualification,
  LeadResearch,
  Persona,
} from '../domain/types';

const log = createLogger('lead-qualification');


/**
 * Structured-output schema for a single persona score (spec §8).
 */
export const qualificationScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  notes: z.string(),
});

export type QualificationScore = z.infer<typeof qualificationScoreSchema>;

export interface ScorePersonaInput {
  persona: Persona;
  lead: Lead;
  research: LeadResearch | null;
  settings: Settings;
}

export interface QualifyLeadDeps {
  getLeadById: (id: string) => Promise<Lead | null>;
  getLeadResearch: (leadId: string) => Promise<LeadResearch | null>;
  getPersonas: (activeOnly?: boolean) => Promise<Persona[]>;
  getSettings: () => Promise<Settings>;
  createLeadQualification: (
    leadId: string,
    data: CreateQualificationInput
  ) => Promise<LeadQualification>;
  updateLeadPriorityByScore: (leadId: string, score: number) => Promise<Lead | null>;
  scorePersona: (input: ScorePersonaInput) => Promise<QualificationScore>;
}

export interface QualifyLeadResult {
  status: 'success' | 'skipped';
  score?: number;
  personaName?: string;
}

/**
 * Format a persona's company-size range for the prompt.
 */
function formatCompanySize(persona: Persona): string {
  const { companySizeMin, companySizeMax } = persona;
  if (companySizeMin != null && companySizeMax != null) {
    return `${companySizeMin}-${companySizeMax} employees`;
  }
  if (companySizeMin != null) return `${companySizeMin}+ employees`;
  if (companySizeMax != null) return `up to ${companySizeMax} employees`;
  return 'any';
}

function formatList(values?: string[]): string {
  return values && values.length > 0 ? values.join(', ') : 'any';
}

/**
 * Build the qualification system prompt (spec §8): mission/identity/voice +
 * persona fields, with a 4×0-25 rubric.
 */
function buildQualificationInstructions(settings: Settings, persona: Persona): string {
  return `You are a B2B sales qualification analyst.

## Your context
- Mission: ${settings.mission}
- Identity: ${settings.identity}
- Voice: ${settings.voice}

## Target persona
- Name: ${persona.name}
- Description: ${persona.description}
- Target titles: ${formatList(persona.targetTitles)}
- Company size: ${formatCompanySize(persona)}
- Funding stages: ${formatList(persona.fundingStages)}
- Target domains: ${formatList(persona.targetDomains)}
- Signals: ${formatList(persona.signals)}

## Scoring rubric (0-100, four criteria worth 25 points each)
1. Title fit (0-25): how well the lead's title matches the target titles.
2. Company fit (0-25): industry/domain, size, and funding-stage alignment.
3. Signals (0-25): presence of the persona's buying/interest signals.
4. Mission alignment (0-25): how well the lead fits the mission above.

Be conservative. Only award 80+ when there is strong, specific evidence across
multiple criteria. When evidence is thin or missing, score low.

Return a score (0-100 integer) and concise notes explaining the score.`;
}

/**
 * Build the qualification user message (spec §8): lead + research facts.
 */
function buildQualificationPrompt(lead: Lead, research: LeadResearch | null): string {
  const leadBlock = `## Lead
- Name: ${lead.name}
- Title: ${lead.title || 'Unknown'}
- Company: ${lead.company || 'Unknown'}
- Location: ${lead.location || 'Unknown'}`;

  const researchBlock = research
    ? `

## Research
- Industry: ${research.industry}
- Company summary: ${research.companySummary}
- Talking points: ${formatList(research.talkingPoints)}
- Outreach angle: ${research.outreachAngle}`
    : `

## Research
No research available for this lead.`;

  return `${leadBlock}${researchBlock}

Score this lead against the target persona using the rubric.`;
}

/**
 * Default per-persona scorer: a Mastra agent with structured output (temp 0.2).
 */
async function defaultScorePersona({
  persona,
  lead,
  research,
  settings,
}: ScorePersonaInput): Promise<QualificationScore> {
  const agent = registerObservedAgent(new Agent({
    id: 'lead-qualification-agent',
    name: 'Lead Qualification Agent',
    instructions: buildQualificationInstructions(settings, persona),
    model: routerModel(),
  }), 'taicho-outreach-agents');

  const result = await observeOperation('ai.outreach.qualify_persona', {
    runId: lead.id,
    attributes: { lead_id: lead.id, persona_id: persona.id },
  }, () => agent.generate(buildQualificationPrompt(lead, research), {
    structuredOutput: { schema: qualificationScoreSchema },
    modelSettings: { temperature: 0.2 },
  }));

  return result.object;
}

export function streamingScorePersona(emit: StreamEmit): QualifyLeadDeps['scorePersona'] {
  return async (input) => {
    const progressId = `persona-${input.persona.id}`;
    emit({ type: 'data-progress', id: progressId, data: { label: `Scoring vs ${input.persona.name}`, state: 'running' } });
    const result = await streamingStructuredGenerate(emit)({
      agentId: 'lead-qualification-agent',
      agentName: 'Lead Qualification Agent',
      instructions: buildQualificationInstructions(input.settings, input.persona),
      prompt: buildQualificationPrompt(input.lead, input.research),
      schema: qualificationScoreSchema,
      temperature: 0.2,
    });
    emit({ type: 'data-progress', id: progressId, data: { label: `Scored vs ${input.persona.name}`, state: 'done' } });
    return result;
  };
}

const defaultDeps: QualifyLeadDeps = {
  getLeadById: getLeadByIdDefault,
  getLeadResearch: getLeadResearchDefault,
  getPersonas: getPersonasDefault,
  getSettings: getSettingsDefault,
  createLeadQualification: createLeadQualificationDefault,
  updateLeadPriorityByScore: updateLeadPriorityByScoreDefault,
  scorePersona: defaultScorePersona,
};

/**
 * Qualify a lead against all active personas, keeping the highest score.
 *
 * @param leadId - the lead to qualify
 * @param deps - optional dependency overrides (for testing / injection)
 */
export async function runQualifyLead(
  leadId: string,
  deps: Partial<QualifyLeadDeps> = {}
): Promise<QualifyLeadResult> {
  const d: QualifyLeadDeps = { ...defaultDeps, ...deps };

  const lead = await d.getLeadById(leadId);
  if (!lead) {
    throw new Error(`Lead not found: ${leadId}`);
  }

  const research = await d.getLeadResearch(leadId);
  const personas = await d.getPersonas(true);

  // No active personas → skip, no write (spec §8).
  if (personas.length === 0) {
    log.info('outreach.qualification.skipped', {
      lead_id: leadId,
      reason: 'no_active_personas',
    });
    return { status: 'skipped' };
  }

  const settings = await d.getSettings();

  // Score against each persona, keep the highest.
  let best: { score: number; notes: string; persona: Persona } | null = null;
  for (const persona of personas) {
    const { score, notes } = await d.scorePersona({ persona, lead, research, settings });
    if (!best || score > best.score) {
      best = { score, notes, persona };
    }
  }

  // Unreachable given personas.length > 0, but narrows for the type checker.
  if (!best) {
    return { status: 'skipped' };
  }

  await d.createLeadQualification(leadId, {
    matchedPersonaId: best.persona.id,
    matchedPersonaName: best.persona.name,
    score: best.score,
    notes: best.notes,
  });
  await d.updateLeadPriorityByScore(leadId, best.score);

  emitProductEventFromContext({
    name: 'lead.qualified',
    refs: { leadId },
    payload: { score: best.score, personaId: best.persona.id, personaName: best.persona.name },
  });

  log.info('outreach.qualification.completed', {
    lead_id: leadId,
    persona_id: best.persona.id,
    score: best.score,
  });

  return { status: 'success', score: best.score, personaName: best.persona.name };
}
