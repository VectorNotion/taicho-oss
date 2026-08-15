import { commercialErrorResponse, reserveBackgroundAction } from "@content-automation/auth/commercial";
import { runWithGraphOrganization } from "@content-automation/platform/data/graph";
import { actionStreamResponse } from "@/packages/platform/agents/streaming";
import { streamingDimensionProgress } from "@/products/outreach/agent/dimension-progress";
import { runProspectResearch } from "@/products/outreach/agent/prospect-research";

export const maxDuration = 600;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let billing;
  try {
    billing = await reserveBackgroundAction(request, "research_prospect");
  } catch (error) {
    return commercialErrorResponse(error)
      ?? Response.json({ error: "Could not start person research." }, { status: 500 });
  }

  return actionStreamResponse({
    action: "research_prospect",
    entityId: id,
    entityType: "prospect",
    commercial: billing.commercial,
    estimatedCredits: billing.estimatedCredits,
    run: (emit) => runWithGraphOrganization(
      billing.commercial.organizationId,
      () => runProspectResearch(id, {
        cascade: false,
        forceRefresh: true,
        onDimension: streamingDimensionProgress(emit),
      }),
    ) as unknown as Promise<Record<string, unknown>>,
  });
}
