import { commercialErrorResponse, reserveBackgroundAction } from "@content-automation/auth/commercial";
import { runWithGraphOrganization } from "@content-automation/platform/data/graph";
import { actionStreamResponse } from "@/packages/platform/agents/streaming";
import { runAccountResearch, streamingDimensionProgress } from "@/products/outreach/agent/account-research";
import { resolveAccountForProspect } from "@/products/outreach/data/account-repository";
import { getProspectById } from "@/products/outreach/data/prospect-repository";
import { getProspectCatalogItem } from "@/products/outreach/data/catalog-repository";
import { catalogItemContext } from "@/products/outreach/domain/catalog";

export const maxDuration = 600;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let billing;
  try {
    billing = await reserveBackgroundAction(request, "research_account");
  } catch (error) {
    return commercialErrorResponse(error)
      ?? Response.json({ error: "Could not start account research." }, { status: 500 });
  }

  return actionStreamResponse({
    action: "research_account",
    entityId: id,
    entityType: "prospect",
    commercial: billing.commercial,
    estimatedCredits: billing.estimatedCredits,
    run: (emit) => runWithGraphOrganization(billing.commercial.organizationId, async () => {
      const prospect = await getProspectById(id);
      if (!prospect) throw new Error(`Prospect not found: ${id}`);
      const account = await resolveAccountForProspect(prospect);
      if (!account) throw new Error("Add a company before researching the account.");
      const catalogItem = prospect.catalogItemId ? await getProspectCatalogItem(id) : null;
      const result = await runAccountResearch(account.id, {
        forceRefresh: true,
        catalogItemId: catalogItem?.id,
        commercialContext: catalogItemContext(catalogItem),
        onDimension: streamingDimensionProgress(emit),
        onProspect: (part) => emit({
          type: "data-research-cascade",
          id: `person-${part.prospectId}`,
          data: { entityId: part.prospectId, scope: "person", phase: part.phase },
        }),
      });
      return { account: { id: account.id, name: account.name }, ...result };
    }) as unknown as Promise<Record<string, unknown>>,
  });
}
