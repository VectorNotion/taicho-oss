import { getAuthorizationContext } from "@content-automation/auth/server";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getLeadCounts,
  getLeadByNameAndCompany,
  getLeadOutreach,
  getLeadsPage,
  createLead,
} from "@/products/outreach/data/lead-repository";
import type { LeadFilters } from "@/products/outreach/domain/types";
import { runLeadResearchAsync, buildResearchInput } from "@/products/outreach/agent/lead-research";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
};

const optionalText = z.string().trim().max(2_000).optional();
const createSchema = z.object({
  name: z.string().trim().min(1).max(500),
  company: optionalText,
  title: optionalText,
  location: optionalText,
  photoUrl: optionalText,
  email: optionalText,
  phone: optionalText,
  linkedinUrl: optionalText,
  twitterUrl: optionalText,
  youtubeUrl: optionalText,
  instagramUrl: optionalText,
  facebookUrl: optionalText,
  websiteUrl: optionalText,
  source: z.enum(["manual", "sales_navigator"]).default("manual"),
  priority: z.enum(["low", "medium", "high"]).optional(),
  tags: z.array(z.string().trim().max(100)).max(100).optional(),
  about: z.string().trim().max(20_000).optional(),
  referredBy: optionalText,
  customAttributes: z.record(
    z.string().max(100),
    z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  ).optional(),
  triggerResearch: z.boolean().optional(),
});

async function context() {
  return getAuthorizationContext(await headers());
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  try {
    const authorization = await context();
    if (!authorization) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401, headers: corsHeaders });
    }
    const { searchParams } = new URL(request.url);
    const lookupName = searchParams.get("lookupName");
    const lookupCompany = searchParams.get("lookupCompany");

    if (lookupName) {
      const lead = await getLeadByNameAndCompany(lookupName, lookupCompany);
      if (!lead) return NextResponse.json({ exists: false }, { headers: corsHeaders });
      const outreach = await getLeadOutreach(lead.id);
      return NextResponse.json({ exists: true, lead, outreach }, { headers: corsHeaders });
    }

    const filters: LeadFilters = {};
    const status = searchParams.get("status");
    if (status && ["new", "researched", "contacted", "replied", "unresponsive", "qualified", "converted"].includes(status)) {
      filters.status = status as LeadFilters["status"];
    }
    const source = searchParams.get("source");
    if (source && ["manual", "sales_navigator"].includes(source)) {
      filters.source = source as LeadFilters["source"];
    }
    const priority = searchParams.get("priority");
    if (priority && ["low", "medium", "high"].includes(priority)) {
      filters.priority = priority as LeadFilters["priority"];
    }
    const search = searchParams.get("search")?.trim();
    if (search) filters.search = search.slice(0, 500);
    const page = Number(searchParams.get("page") ?? 1);
    const pageSize = Number(searchParams.get("pageSize") ?? 50);
    const [result, counts] = await Promise.all([
      getLeadsPage(filters, { page, pageSize }),
      getLeadCounts(),
    ]);
    return NextResponse.json({ ...result, counts }, { headers: corsHeaders });
  } catch (error) {
    console.error("Error fetching leads:", error);
    return NextResponse.json(
      { error: "Failed to fetch leads" },
      { status: 500, headers: corsHeaders },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authorization = await context();
    if (!authorization) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401, headers: corsHeaders });
    }
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Lead data is invalid", fields: parsed.error.flatten().fieldErrors },
        { status: 400, headers: corsHeaders },
      );
    }
    const { triggerResearch, ...input } = parsed.data;
    const lead = await createLead(input);
    if (triggerResearch) {
      runLeadResearchAsync(buildResearchInput(lead));
    }
    return NextResponse.json(
      { ...lead, existed: false },
      { status: 201, headers: corsHeaders },
    );
  } catch (error) {
    console.error("Error creating lead:", error);
    return NextResponse.json(
      { error: "Failed to create lead" },
      { status: 500, headers: corsHeaders },
    );
  }
}
