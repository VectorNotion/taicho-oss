/**
 * Lead research utility using Mastra agent.
 * Provides sync API for extension (no streaming, just results).
 */
import { outreachMastra } from './runtime';
import { createLogger, observeOperation } from '@content-automation/observability';
import { emitProductEventFromContext } from '@content-automation/platform/events/emit';
import { runQualifyLead } from './qualify-lead';
import { storeLeadResearch } from '../data/lead-repository';
import { leadResearchSchema, type LeadResearchResult } from '../domain/research-schema';
import type { Lead } from '../domain/types';

const log = createLogger('lead-research');

export interface RunLeadResearchInput {
  leadId: string;
  name: string;
  company: string;
  title?: string;
  location?: string;
}

/**
 * Run lead research synchronously using Mastra agent.
 * Parses response, saves to Neo4j, returns result.
 */
export async function runLeadResearch(
  input: RunLeadResearchInput
): Promise<LeadResearchResult> {
  const { leadId, name, company, title, location } = input;
  return observeOperation('outreach.lead.research', {
    runId: leadId,
    attributes: { lead_id: leadId },
  }, async () => {
    const agent = outreachMastra.getAgent('leadResearchAgent');
    const prompt = `Research ${name} at ${company}${title ? ` (${title})` : ''}${location ? `, ${location}` : ''}`;

    log.info('outreach.research.started', { lead_id: leadId });
    const result = await agent.generate(prompt, {
      structuredOutput: { schema: leadResearchSchema },
    });
    const validated = result.object as LeadResearchResult;
    await storeLeadResearch(leadId, validated);
    log.info('outreach.research.saved', { lead_id: leadId });

    // Emitted before the chained qualification so a qualification failure never
    // suppresses the research event.
    emitProductEventFromContext({ name: 'lead.researched', refs: { leadId } });

    // Qualification is useful follow-on work but must not invalidate research.
    try {
      await runQualifyLead(leadId);
    } catch (error) {
      log.error('outreach.research.qualification_failed', error, { lead_id: leadId });
    }
    return validated;
  });
}

/**
 * Fire-and-forget version - runs research in background.
 * Returns immediately, logs errors but doesn't throw.
 */
export function runLeadResearchAsync(input: RunLeadResearchInput): void {
  runLeadResearch(input).catch((error) => {
    log.error('outreach.research.background_failed', error, { lead_id: input.leadId });
  });
}

/**
 * Helper to build research input from a Lead object.
 */
export function buildResearchInput(lead: Lead): RunLeadResearchInput {
  return {
    leadId: lead.id,
    name: lead.name,
    company: lead.company || '',
    title: lead.title,
    location: lead.location,
  };
}
