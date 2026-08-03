import { outreachMastra } from '@/products/outreach/agent/runtime';
import { storeLeadResearch } from '@/products/outreach/data/lead-repository';
import { leadResearchSchema, type LeadResearchResult } from '@/products/outreach/domain/research-schema';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { commercialErrorResponse, reserveVariableCost } from '@content-automation/auth/commercial';
import { releaseReservation, settleReservation } from '@content-automation/platform/commercial';
import { createLogger, observeOperation } from '@content-automation/observability';

export const maxDuration = 600;
const log = createLogger('outreach-research-api');

export async function POST(req: Request) {
  let reservationId: string | null = null;
  try {
    const { messages, leadId, leadInfo } = await req.json();
    const billing = await reserveVariableCost(req, { action: 'outreach_research_stream', credits: 80, capability: 'outreach' }); reservationId = billing.reservationId;

    const agent = outreachMastra.getAgent('leadResearchAgent');

    // Build the prompt from messages or use the leadInfo directly
    const prompt =
      messages?.[messages.length - 1]?.content ||
      `Research ${leadInfo?.name} at ${leadInfo?.company} (${leadInfo?.title || 'Unknown title'}, ${leadInfo?.location || 'Unknown location'})`;

    const stream = await agent.stream(prompt, {
      structuredOutput: { schema: leadResearchSchema },
      modelSettings: { maxOutputTokens: 32768 },
      providerOptions: { openrouter: { reasoning: { effort: 'medium' } } },
    });

    const uiMessageStream = createUIMessageStream({
      execute: async ({ writer }) => {
        let reasoning = '';
        let finalResult: LeadResearchResult | null = null;
        try {
          await observeOperation('ai.outreach.research_stream', {
            runId: typeof leadId === 'string' ? leadId : undefined,
            attributes: { lead_id: typeof leadId === 'string' ? leadId : undefined },
          }, async () => {
            for await (const raw of stream.fullStream as AsyncIterable<{
              type: string;
              payload?: { text?: string };
              object?: unknown;
              data?: unknown;
            }>) {
              if (raw.type === 'reasoning-delta') {
                reasoning += raw.payload?.text ?? '';
                writer.write({ type: 'data-reasoning', id: 'reasoning', data: { text: reasoning } } as never);
              } else if (raw.type === 'object') {
                writer.write({ type: 'data-research-partial', id: 'partial', data: raw.object } as never);
              } else if (raw.type === 'object-result') {
                finalResult = raw.object as LeadResearchResult;
              } else if (raw.type.startsWith('data-')) {
                // Tool writer custom parts already use the exact client contract.
                writer.write(raw as never);
              }
            }
            if (!finalResult) throw new Error('research produced no structured result');
            const validated = leadResearchSchema.parse(finalResult) as LeadResearchResult;
            if (leadId) await storeLeadResearch(leadId, validated);
            await settleReservation({ reservationId: billing.reservationId, actualCredits: billing.estimatedCredits, idempotencyKey: `outreach-research:${billing.reservationId}`, usageKind: 'agent_action' });
            writer.write({ type: 'data-research-result', id: 'result', data: validated } as never);
          });
        } catch (error) {
          await releaseReservation(billing.reservationId).catch(() => undefined);
          log.error('outreach.research_stream.failed', error, {
            lead_id: typeof leadId === 'string' ? leadId : undefined,
          });
          writer.write({
            type: 'data-research-error',
            id: 'error',
            data: { error: 'Research failed' },
          } as never);
        }
      },
    });

    return createUIMessageStreamResponse({
      stream: uiMessageStream,
    });
  } catch (error) {
    if (reservationId) await releaseReservation(reservationId).catch(() => undefined);
    const commercial = commercialErrorResponse(error); if (commercial) return commercial;
    log.error('outreach.research_api.failed', error);
    return new Response(
      JSON.stringify({
        error: 'Research failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
