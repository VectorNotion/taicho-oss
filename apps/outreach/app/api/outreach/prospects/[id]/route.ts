import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateProspectInsights } from "@/products/outreach/agent/prospect-insights";
import {
  deleteProspect,
  getProspectById,
  updateProspect,
} from "@/products/outreach/data/prospect-repository";
import { withProspectOrg } from "@/lib/prospect-scope";

export const maxDuration = 600;

const optionalNullableText = z.string().trim().max(20_000).nullable().optional()
  .transform((value) => value === null ? "" : value);
const updateSchema = z.object({
  name: z.string().trim().min(1).max(500).optional(),
  company: optionalNullableText,
  title: optionalNullableText,
  location: optionalNullableText,
  email: optionalNullableText,
  phone: optionalNullableText,
  linkedinUrl: optionalNullableText,
  twitterUrl: optionalNullableText,
  youtubeUrl: optionalNullableText,
  instagramUrl: optionalNullableText,
  facebookUrl: optionalNullableText,
  websiteUrl: optionalNullableText,
  status: z.enum(["new", "researched", "contacted", "replied", "unresponsive", "qualified", "converted"]).optional(),
  source: z.enum(["manual", "sales_navigator"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  tags: z.array(z.string().trim().max(100)).max(100).optional(),
  about: optionalNullableText,
  referredBy: optionalNullableText,
  customAttributes: z.record(
    z.string().max(100),
    z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  ).optional(),
});

export async function OPTIONS() {
  return NextResponse.json({}, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withProspectOrg(request, async () => {
    try {
      const { id } = await params;
      const prospect = await getProspectById(id);
      return prospect
        ? NextResponse.json(prospect)
        : NextResponse.json({ error: "Prospect not found" }, { status: 404 });
    } catch (error) {
      console.error("Error fetching prospect:", error);
      return NextResponse.json({ error: "Failed to fetch prospect" }, { status: 500 });
    }
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withProspectOrg(request, async (context) => {
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Prospect data is invalid", fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    try {
      const { id } = await params;
      const previous = parsed.data.status ? await getProspectById(id) : null;
      const prospect = await updateProspect(id, parsed.data);
      if (!prospect) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
      let insightStatus = "unchanged";
      if (parsed.data.status && previous?.status !== parsed.data.status) {
        insightStatus = "refreshed";
        try {
          await generateProspectInsights({
            organizationId: context.organizationId,
            prospectId: id,
            reason: "activity_update",
            createdBy: context.session.user.id,
          });
        } catch {
          insightStatus = "pending";
        }
      }
      return NextResponse.json(prospect, {
        headers: { "X-Prospect-Insight-Status": insightStatus },
      });
    } catch (error) {
      console.error("Error updating prospect:", error);
      return NextResponse.json({ error: "Failed to update prospect" }, { status: 500 });
    }
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withProspectOrg(request, async () => {
    try {
      const { id } = await params;
      const deleted = await deleteProspect(id);
      return deleted
        ? NextResponse.json({ success: true })
        : NextResponse.json({ error: "Prospect not found" }, { status: 404 });
    } catch (error) {
      console.error("Error deleting prospect:", error);
      return NextResponse.json({ error: "Failed to delete prospect" }, { status: 500 });
    }
  });
}
