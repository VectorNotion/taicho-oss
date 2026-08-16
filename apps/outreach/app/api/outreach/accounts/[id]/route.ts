import { NextRequest, NextResponse } from "next/server";
import { withOrgScope } from "@/lib/prospect-scope";
import { getAccountDetail } from "@/products/outreach/data/account-repository";
import { getOpenActionItemsForProspects } from "@/products/outreach/data/action-item-repository";
import { DEFAULT_THRESHOLDS } from "@/products/outreach/domain/qualification";
import { getAccountOpportunityCoverage } from "@/products/outreach/services/account-opportunity-coverage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withOrgScope(request, async () => {
    try {
      const { id } = await params;
      const account = await getAccountDetail(id);
      if (!account) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }
      const [open, opportunityCoverage] = await Promise.all([
        getOpenActionItemsForProspects(
          account.prospects.map((prospect) => prospect.id),
        ),
        getAccountOpportunityCoverage({
          accountId: account.id,
          accountEligible: !account.hardExcluded
            && account.icpScore != null
            && account.icpScore >= DEFAULT_THRESHOLDS.icpMinimum,
        }),
      ]);
      const prospects = account.prospects.map((prospect) => {
        const next = open.get(prospect.id)?.[0];
        return {
          ...prospect,
          nextAction: next ? { id: next.id, title: next.title, dueAt: next.dueAt } : null,
        };
      });
      return NextResponse.json({ ...account, prospects, opportunityCoverage });
    } catch (error) {
      console.error("Error fetching account:", error);
      return NextResponse.json({ error: "Failed to fetch account" }, { status: 500 });
    }
  });
}
