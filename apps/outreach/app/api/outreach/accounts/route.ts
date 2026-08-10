import { NextRequest, NextResponse } from "next/server";
import { withOrgScope } from "@/lib/prospect-scope";
import {
  getAccountCounts,
  getAccountsPage,
  type AccountListFilters,
} from "@/products/outreach/data/account-repository";

const SEGMENTS = new Set(["targets", "qualified", "warm"]);

export async function GET(request: NextRequest) {
  return withOrgScope(request, async () => {
    try {
      const { searchParams } = new URL(request.url);
      const filters: AccountListFilters = {};
      const search = searchParams.get("search")?.trim();
      if (search) filters.search = search.slice(0, 500);
      const segment = searchParams.get("segment");
      if (segment && SEGMENTS.has(segment)) {
        filters.segment = segment as AccountListFilters["segment"];
      }
      const page = Number(searchParams.get("page") ?? 1);
      const pageSize = Number(searchParams.get("pageSize") ?? 50);

      const [result, counts] = await Promise.all([
        getAccountsPage(filters, { page, pageSize }),
        getAccountCounts(),
      ]);
      return NextResponse.json({ ...result, counts });
    } catch (error) {
      console.error("Error fetching accounts:", error);
      return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 });
    }
  });
}
