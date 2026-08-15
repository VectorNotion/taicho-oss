import { NextResponse } from "next/server";
import { withProspectOrg } from "@/lib/prospect-scope";
import { getProspectDossier } from "@/products/outreach/data/prospect-dossier-repository";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withProspectOrg(request, async () => {
    try {
      const { id } = await params;
      const dossier = await getProspectDossier(id);
      if (!dossier) {
        return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
      }
      return NextResponse.json(dossier);
    } catch (error) {
      console.error("Error fetching prospect dossier:", error);
      return NextResponse.json({ error: "Failed to fetch prospect dossier" }, { status: 500 });
    }
  });
}
