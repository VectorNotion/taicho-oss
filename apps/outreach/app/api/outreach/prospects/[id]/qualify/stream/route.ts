import { actionStreamResponse } from '@/packages/platform/agents/streaming';
import { runQualifyProspect, streamingQualifyProgress } from '@/products/outreach/agent/qualify-prospect';
import { commercialErrorResponse, reserveBackgroundAction } from '@content-automation/auth/commercial';
import { runWithGraphOrganization } from '@content-automation/platform/data/graph';

export const maxDuration = 600;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // reserveBackgroundAction authenticates and yields the caller's organization;
  // the deferred run callback must re-establish that graph scope itself, since
  // AsyncLocalStorage from this request does not reach the streamed execution.
  let billing;
  try {
    billing = await reserveBackgroundAction(request, 'qualify_prospect');
  } catch (error) {
    return commercialErrorResponse(error) ?? Response.json({ error: 'Could not start qualification.' }, { status: 500 });
  }
  const organizationId = billing.commercial.organizationId;
  return actionStreamResponse({
    action: 'qualify_prospect', entityId: id, entityType: 'prospect',
    commercial: billing.commercial, estimatedCredits: billing.estimatedCredits,
    run: (emit) => runWithGraphOrganization(
      organizationId,
      () => runQualifyProspect(id, { onProgress: streamingQualifyProgress(emit) }),
    ) as unknown as Promise<Record<string, unknown>>,
  });
}
