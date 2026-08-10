import { actionStreamResponse } from '@/packages/platform/agents/streaming';
import { runProspectResearch } from '@/products/outreach/agent/prospect-research';
import { streamingDimensionProgress } from '@/products/outreach/agent/dimension-progress';
import { commercialErrorResponse, reserveBackgroundAction } from '@content-automation/auth/commercial';
import { runWithGraphOrganization } from '@content-automation/platform/data/graph';

export const maxDuration = 600;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let billing;
  try {
    billing = await reserveBackgroundAction(request, 'research_prospect');
  } catch (error) {
    return commercialErrorResponse(error) ?? Response.json({ error: 'Could not start prospect research.' }, { status: 500 });
  }
  const organizationId = billing.commercial.organizationId;
  return actionStreamResponse({
    action: 'research_prospect', entityId: id, entityType: 'prospect',
    commercial: billing.commercial, estimatedCredits: billing.estimatedCredits,
    run: (emit) => runWithGraphOrganization(
      organizationId,
      () => runProspectResearch(id, { onDimension: streamingDimensionProgress(emit) }),
    ) as unknown as Promise<Record<string, unknown>>,
  });
}
