import { NextRequest, NextResponse } from "next/server";
import { withProspectOrg } from "@/lib/prospect-scope";
import { getProspectNavigation } from "@/products/outreach/data/prospect-repository";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withProspectOrg(request, async () => {
    try {
      const { id } = await params;
      const navigation = await getProspectNavigation(id);
      return navigation
        ? NextResponse.json(navigation)
        : NextResponse.json({ error: "Prospect not found" }, { status: 404 });
    } catch (error) {
      console.error("Error fetching prospect navigation:", error);
      return NextResponse.json(
        { error: "Failed to fetch prospect navigation" },
        { status: 500 },
      );
    }
  });
}
