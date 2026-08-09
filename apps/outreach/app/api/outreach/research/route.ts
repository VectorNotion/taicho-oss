import { getLeadById, storeLeadResearch } from '@/products/outreach/data/lead-repository';
import {
  buildResearchInput,
  generateLeadResearch,
} from '@/products/outreach/agent/lead-research';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { commercialErrorResponse, reserveVariableCost } from '@content-automation/auth/commercial';
import { releaseReservation, settleReservation } from '@content-automation/platform/commercial';
import { createLogger, observeOperation } from '@content-automation/observability';

export const maxDuration = 300;
const log = createLogger('outreach-research-api');
const RESEARCH_TIMEOUT_MS = 2 * 60_000;

function failureMessage(requestAborted: boolean, researchAborted: boolean): string {
  if (requestAborted) return 'Research was cancelled.';
  if (researchAborted) return 'Research timed out. Please try again.';
  return 'Research could not be completed. Please try again.';
}

export async function POST(req: Request) {
  let reservationId: string | null = null;
  try {
    const { leadId } = await req.json();
    if (typeof leadId !== 'string' || !leadId.trim()) {
      return Response.json({ error: 'A lead is required.' }, { status: 400 });
    }

    const lead = await getLeadById(leadId);
    if (!lead) return Response.json({ error: 'Lead not found.' }, { status: 404 });

    const billing = await reserveVariableCost(req, {
      action: 'outreach_research_stream',
      credits: 80,
      capability: 'outreach',
    });
    reservationId = billing.reservationId;
    const researchSignal = AbortSignal.any([
      req.signal,
      AbortSignal.timeout(RESEARCH_TIMEOUT_MS),
    ]);

    const uiMessageStream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({
          type: 'data-research-status',
          id: 'status',
          data: { phase: 'starting' },
        } as never);
        try {
          await observeOperation('ai.outreach.research_stream', {
            runId: leadId,
            attributes: { lead_id: leadId },
          }, async () => {
            // Retrieval is deterministic and concurrent; the model performs one
            // bounded synthesis pass after all five evidence sets arrive.
            const validated = await generateLeadResearch(buildResearchInput(lead), {
              signal: researchSignal,
              onSearchProgress: (topic, status, detail) => {
                writer.write({
                  type: 'data-tool-progress',
                  id: `search-${topic}`,
                  data: { topic, status, ...detail },
                } as never);
              },
              onSynthesisStarted: () => {
                writer.write({
                  type: 'data-research-status',
                  id: 'status',
                  data: { phase: 'synthesizing' },
                } as never);
              },
            });
            await storeLeadResearch(leadId, validated);
            await settleReservation({
              reservationId: billing.reservationId,
              actualCredits: billing.estimatedCredits,
              idempotencyKey: `outreach-research:${billing.reservationId}`,
              usageKind: 'agent_action',
            });
            writer.write({
              type: 'data-research-result',
              id: 'result',
              data: validated,
            } as never);
          });
        } catch (error) {
          await releaseReservation(billing.reservationId).catch(() => undefined);
          log.error('outreach.research_stream.failed', error, {
            lead_id: leadId,
            request_aborted: req.signal.aborted,
            research_aborted: researchSignal.aborted,
          });
          if (!req.signal.aborted) {
            writer.write({
              type: 'data-research-error',
              id: 'error',
              data: { error: failureMessage(req.signal.aborted, researchSignal.aborted) },
            } as never);
          }
        }
      },
      onError: () => 'Research could not be completed. Please try again.',
    });

    return createUIMessageStreamResponse({ stream: uiMessageStream });
  } catch (error) {
    if (reservationId) await releaseReservation(reservationId).catch(() => undefined);
    const commercial = commercialErrorResponse(error);
    if (commercial) return commercial;
    log.error('outreach.research_api.failed', error);
    return Response.json({ error: 'Research failed' }, { status: 500 });
  }
}
