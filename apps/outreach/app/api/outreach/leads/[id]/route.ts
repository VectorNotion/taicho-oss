import { getAuthorizationContext } from "@content-automation/auth/server";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteLead,
  getLeadById,
  updateLead,
} from "@/products/outreach/data/lead-repository";

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

async function authorization() {
  return getAuthorizationContext(await headers());
}

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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await authorization();
  if (!context) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  try {
    const { id } = await params;
    const lead = await getLeadById(id);
    return lead
      ? NextResponse.json(lead)
      : NextResponse.json({ error: "Lead not found" }, { status: 404 });
  } catch (error) {
    console.error("Error fetching lead:", error);
    return NextResponse.json({ error: "Failed to fetch lead" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await authorization();
  if (!context) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Lead data is invalid", fields: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  try {
    const { id } = await params;
    const lead = await updateLead(id, parsed.data);
    return lead
      ? NextResponse.json(lead)
      : NextResponse.json({ error: "Lead not found" }, { status: 404 });
  } catch (error) {
    console.error("Error updating lead:", error);
    return NextResponse.json({ error: "Failed to update lead" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await authorization();
  if (!context) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  try {
    const { id } = await params;
    const deleted = await deleteLead(id);
    return deleted
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: "Lead not found" }, { status: 404 });
  } catch (error) {
    console.error("Error deleting lead:", error);
    return NextResponse.json({ error: "Failed to delete lead" }, { status: 500 });
  }
}
