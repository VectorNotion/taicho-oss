import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { commercialErrorResponse, reserveVariableCost } from '@content-automation/auth/commercial';
import { runWithGraphOrganization } from '@content-automation/platform/data/graph';
import { releaseReservation, settleReservation } from '@content-automation/platform/commercial';
import { createLogger } from '@content-automation/observability';
import { streamOutreach } from '@/products/outreach/agent/generator';
import { OutreachOpportunityBlockedError } from '@/products/outreach/services/outreach-opportunity-context';
import type { OutreachMedium } from '@/products/outreach/domain/types';

export const maxDuration = 600;

const log = createLogger('outreach-generation-stream-api');
const VALID_MEDIA = new Set<OutreachMedium>([
  'inmail',
  'inmail_traditional',
  'email',
  'content_comment',
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let reservationId: string | null = null;

  try {
    const { id } = await params;
    const body = await request.json() as {
      medium?: string;
      targetContent?: string;
      generationId?: string;
    };
    if (!body.medium || !VALID_MEDIA.has(body.medium as OutreachMedium)) {
      return Response.json({ error: 'A valid outreach medium is required.' }, { status: 400 });
    }
    if (body.generationId !== undefined && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.generationId)) {
      return Response.json({ error: 'A valid generation id is required.' }, { status: 400 });
    }

    const medium = body.medium as OutreachMedium;
    const billing = await reserveVariableCost(request, {
      action: 'generate_outreach_stream',
      credits: 30,
      capability: 'outreach',
    });
    reservationId = billing.reservationId;

    const uiStream = createUIMessageStream({
      execute: async ({ writer }) => {
        const writeProgress = (step: {
          id: 'context' | 'draft' | 'save';
          label: string;
          state: 'running' | 'complete';
        }) => writer.write({
          type: 'data-progress',
          id: step.id,
          data: { label: step.label, state: step.state },
        } as never);

        try {
          // The stream body runs after the request returns, so re-establish the
          // caller's graph organization here (billing already authenticated it).
          const message = await runWithGraphOrganization(billing.context.organizationId, () => streamOutreach({
            prospectId: id,
            medium,
            targetContent: body.targetContent,
            generationId: body.generationId,
          }, {
            onProgress: writeProgress,
            onPartial: (partial) => writer.write({
              type: 'data-partial',
              id: 'draft',
              data: partial,
            } as never),
          }));

          await settleReservation({
            reservationId: billing.reservationId,
            actualCredits: billing.estimatedCredits,
            idempotencyKey: `outreach-stream:${billing.reservationId}`,
            usageKind: 'agent_action',
          });
          reservationId = null;
          writer.write({ type: 'data-final', id: 'final', data: message } as never);
        } catch (error) {
          await releaseReservation(billing.reservationId).catch(() => undefined);
          reservationId = null;
          log.error('outreach.generation_stream.failed', error, {
            prospect_id: id,
            medium,
          });
          writer.write({
            type: 'data-action-error',
            id: 'error',
            data: {
              message: error instanceof OutreachOpportunityBlockedError
                ? error.message
                : 'Could not generate this outreach draft.',
            },
          } as never);
        }
      },
    });

    return createUIMessageStreamResponse({
      stream: uiStream,
      headers: { 'X-Accel-Buffering': 'no' },
    });
  } catch (error) {
    if (reservationId) await releaseReservation(reservationId).catch(() => undefined);
    const commercial = commercialErrorResponse(error);
    if (commercial) return commercial;
    log.error('outreach.generation_stream_api.failed', error);
    return Response.json({ error: 'Could not start outreach generation.' }, { status: 500 });
  }
}
