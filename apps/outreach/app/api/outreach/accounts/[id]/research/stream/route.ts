import { actionStreamResponse } from '@/packages/platform/agents/streaming';
import { runAccountResearch, streamingDimensionProgress } from '@/products/outreach/agent/account-research';
import { commercialErrorResponse, reserveBackgroundAction } from '@content-automation/auth/commercial';
import { runWithGraphOrganization } from '@content-automation/platform/data/graph';

export const maxDuration = 600;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // reserveBackgroundAction authenticates and yields the caller's organization;
  // the deferred run callback re-establishes that graph scope (AsyncLocalStorage
  // from this request does not reach the streamed execution).
  let billing;
  try {
    billing = await reserveBackgroundAction(request, 'research_account');
  } catch (error) {
    return commercialErrorResponse(error) ?? Response.json({ error: 'Could not start account research.' }, { status: 500 });
  }
  const organizationId = billing.commercial.organizationId;
  return actionStreamResponse({
    action: 'research_account', entityId: id, entityType: 'account',
    commercial: billing.commercial, estimatedCredits: billing.estimatedCredits,
    run: (emit) => runWithGraphOrganization(
      organizationId,
      () => runAccountResearch(id, {
        forceRefresh: true,
        onDimension: streamingDimensionProgress(emit),
        onProspect: (part) => emit({
          type: 'data-research-cascade',
          id: `person-${part.prospectId}`,
          data: { entityId: part.prospectId, scope: 'person', phase: part.phase },
        }),
      }),
    ) as unknown as Promise<Record<string, unknown>>,
  });
}
