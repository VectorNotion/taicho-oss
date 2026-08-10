import { NextRequest, NextResponse } from "next/server";
import { withOrgScope } from "@/lib/prospect-scope";
import { getAccountDetail } from "@/products/outreach/data/account-repository";

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
      return NextResponse.json(account);
    } catch (error) {
      console.error("Error fetching account:", error);
      return NextResponse.json({ error: "Failed to fetch account" }, { status: 500 });
    }
  });
}
