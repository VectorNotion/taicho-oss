import { NextRequest, NextResponse } from "next/server";
import { withOrgScope } from "@/lib/prospect-scope";
import { getAccountNavigation } from "@/products/outreach/data/account-repository";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withOrgScope(request, async () => {
    try {
      const { id } = await params;
      const navigation = await getAccountNavigation(id);
      return navigation
        ? NextResponse.json(navigation)
        : NextResponse.json({ error: "Account not found" }, { status: 404 });
    } catch (error) {
      console.error("Error fetching account navigation:", error);
      return NextResponse.json(
        { error: "Failed to fetch account navigation" },
        { status: 500 },
      );
    }
  });
}
