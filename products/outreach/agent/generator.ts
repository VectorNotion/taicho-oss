/**
 * Outreach generator utility using Mastra agent.
 * Provides sync API for extension (no streaming, just results).
 *
 * IMPORTANT: Grounded in real data - agent can only reference:
 * - Identity/projects from Settings
 * - Projects from Neo4j (via tools)
 * - Never fabricates clients, projects, or experiences.
 */
import { createOutreachAgent } from './mastra-agent';
import { createLogger, observeOperation } from '@content-automation/observability';
import { emitProductEventFromContext } from '@content-automation/platform/events/emit';
import { getSettings } from '@content-automation/platform/settings/repository';
import {
  getLeadById,
  getLeadResearch,
  createOutreachMessage,
} from '../data/lead-repository';
import type { Lead, LeadResearch, OutreachMedium, OutreachMessage } from '../domain/types';
import { z } from 'zod';

const log = createLogger('outreach-generator');

// Schema for parsing agent output
const outreachOutputSchema = z.object({
  subject: z.string().optional().nullable(),
  content: z.string(),
  reportUrl: z.string().optional().nullable(),
  reportSlug: z.string().optional().nullable(),
  reportId: z.string().optional().nullable(),
});

export type OutreachOutput = z.infer<typeof outreachOutputSchema>;

export interface GenerateOutreachInput {
  leadId: string;
  medium: OutreachMedium;
  targetContent?: string; // For content_comment
  tenantId?: string; // CMS tenant ID for report creation
}

export interface GenerateOutreachResult {
  success: boolean;
  message?: OutreachMessage;
  error?: string;
}

/**
 * Build prompt for the outreach agent based on medium and lead context.
 * Clearly separates THEIR DATA (lead research) from YOUR DATA (identity/projects).
 * Agent must use tools to access real projects before writing.
 */
function buildOutreachPrompt(
  lead: Lead,
  research: LeadResearch | null,
  medium: OutreachMedium,
  targetContent?: string,
  tenantId?: string
): string {
  // THEIR context - for understanding, not for claiming you reacted to
  const leadContext = `
## THEIR CONTEXT (The Lead)
- Name: ${lead.name}
- Role: ${lead.title || 'Unknown'} at ${lead.company || 'Unknown'}
- Location: ${lead.location || 'Unknown'}
${research ? `
- Industry: ${research.industry}
- Company Summary: ${research.companySummary}

**Use this to understand their world. Do NOT claim you "saw" or "noticed" any of this.**
` : ''}
`;

  // Talking points - things that MIGHT resonate, not things to reference directly
  const resonanceContext = research?.talkingPoints?.length
    ? `
## Topics That May Resonate
These are insights about what someone in their position might care about:
${research.talkingPoints.map((tp) => `- ${tp}`).join('\n')}

**Use these to find CONNECTION POINTS with your REAL documented experience.**
**Do NOT fabricate stories about working with similar people.**
`
    : '';

  let mediumInstructions = '';

  switch (medium) {
    case 'inmail':
      mediumInstructions = `
## Task: Write an InMail

**FIRST:** Use \`list-projects\` to see your actual projects you can reference.

${tenantId ? `CMS Tenant ID: ${tenantId}
1. Validate the CMS tenant using cms-set-tenant
2. Pass tenantId to every cms-create-report and cms-get-report call
3. Create a useful report page using cms-create-report
4. Write the InMail` : 'No CMS tenant - skip report creation, just write the message'}

**Your InMail should:**
- Reference your ACTUAL documented work (from your identity or projects)
- Connect to something relevant to their role/industry
- Be honest about what you do and have done
- End with genuine curiosity

**Do NOT:**
- Invent client stories or projects
- Claim you "were just working with [similar role]" unless true
- Fabricate conversations or outcomes
`;
      break;

    case 'inmail_traditional':
      mediumInstructions = `
## Task: Write a Traditional InMail

A lighter touch - share a genuine observation or insight.

${tenantId ? `CMS Tenant ID: ${tenantId} (optional - create a report if it adds value)` : ''}

**Your message should:**
- Be based on your REAL documented experience
- Keep it brief and honest
- End with light curiosity
`;
      break;

    case 'email':
      mediumInstructions = `
## Task: Write a Cold Email

**FIRST:** Use \`list-projects\` to see your actual projects you can reference.

**Your email should:**
- Subject: 3-6 words, honest (not clickbait)
- Open with something TRUE about your work
- Connect to their world naturally
- Under 150 words total
`;
      break;

    case 'content_comment':
      mediumInstructions = `
## Task: Write a Comment on Their Content

**Their content:**
"""
${targetContent || 'No target content provided'}
"""

This is the one case where you CAN reference their specific content (since you're commenting on it).

**Your comment should:**
- Engage with a specific point they made
- Add your perspective from your REAL documented experience
- 2-4 sentences max
`;
      break;
  }

  return `${leadContext}
${resonanceContext}
${mediumInstructions}

Generate the outreach now. Remember: ONLY reference real work from your identity or project tools. Never fabricate.

Output ONLY a JSON object with: subject (if applicable), content, reportUrl/reportSlug/reportId (if report created).`;
}

/**
 * Generate outreach message synchronously using Mastra agent.
 * Fetches user's identity/voice/mission from Settings for personalized outreach.
 */
export async function generateOutreach(
  input: GenerateOutreachInput
): Promise<GenerateOutreachResult> {
  const { leadId, medium, targetContent, tenantId } = input;

  log.info('outreach.generation.started', { lead_id: leadId, medium });

  // Fetch lead
  const lead = await getLeadById(leadId);
  if (!lead) {
    return { success: false, error: `Lead not found: ${leadId}` };
  }

  // Fetch research (optional)
  const research = await getLeadResearch(leadId);

  // Fetch user's configured identity from Settings
  const settings = await getSettings();

  // Build prompt with storytelling approach
  const prompt = buildOutreachPrompt(lead, research, medium, targetContent, tenantId);

  // Create agent with user's identity/voice/mission
  const agent = createOutreachAgent({
    identity: settings.identity,
    voice: settings.voice,
    mission: settings.mission,
  });

  // Use structured output (replaces regex-JSON parsing). Keep the same
  // graceful error return shape on failure.
  let parsed: OutreachOutput;
  try {
    const result = await observeOperation('ai.outreach.generate', {
      runId: leadId,
      attributes: { lead_id: leadId, medium },
    }, () => agent.generate(prompt, {
      structuredOutput: { schema: outreachOutputSchema },
    }));
    parsed = result.object;
  } catch (e) {
    log.error('outreach.generation.failed', e, { lead_id: leadId, medium });
    return { success: false, error: 'Failed to parse agent response' };
  }

  // Save to Neo4j (convert null to undefined)
  const message = await createOutreachMessage({
    leadId,
    medium,
    subject: parsed.subject ?? undefined,
    content: parsed.content,
    targetContent,
    landingPageUrl: parsed.reportUrl ?? undefined,
    landingPageSlug: parsed.reportSlug ?? undefined,
    reportId: parsed.reportId ?? undefined,
    status: 'draft',
  });

  log.info('outreach.message.saved', {
    lead_id: leadId,
    message_id: message.id,
    medium,
  });

  emitProductEventFromContext({
    name: 'outreach.generated',
    refs: { leadId },
    payload: { messageId: message.id, medium },
  });

  return { success: true, message };
}

/**
 * Fire-and-forget version - runs in background.
 */
export function generateOutreachAsync(input: GenerateOutreachInput): void {
  generateOutreach(input).catch((error) => {
    log.error('outreach.generation.background_failed', error, {
      lead_id: input.leadId,
      medium: input.medium,
    });
  });
}
