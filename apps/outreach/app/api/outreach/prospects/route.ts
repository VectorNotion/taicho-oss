import { getAuthorizationContext } from "@content-automation/auth/server";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getProspectCounts,
  getProspectByNameAndCompany,
  getProspectOutreach,
  getProspectsPage,
  createProspect,
} from "@/products/outreach/data/prospect-repository";
import type { ProspectFilters } from "@/products/outreach/domain/types";
import { runProspectResearchAsync, buildResearchInput } from "@/products/outreach/agent/prospect-research";

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
      const prospect = await getProspectByNameAndCompany(lookupName, lookupCompany);
      if (!prospect) return NextResponse.json({ exists: false }, { headers: corsHeaders });
      const outreach = await getProspectOutreach(prospect.id);
      return NextResponse.json({ exists: true, prospect, outreach }, { headers: corsHeaders });
    }

    const filters: ProspectFilters = {};
    const status = searchParams.get("status");
    if (status && ["new", "researched", "contacted", "replied", "unresponsive", "qualified", "converted"].includes(status)) {
      filters.status = status as ProspectFilters["status"];
    }
    const source = searchParams.get("source");
    if (source && ["manual", "sales_navigator"].includes(source)) {
      filters.source = source as ProspectFilters["source"];
    }
    const priority = searchParams.get("priority");
    if (priority && ["low", "medium", "high"].includes(priority)) {
      filters.priority = priority as ProspectFilters["priority"];
    }
    const search = searchParams.get("search")?.trim();
    if (search) filters.search = search.slice(0, 500);
    const page = Number(searchParams.get("page") ?? 1);
    const pageSize = Number(searchParams.get("pageSize") ?? 50);
    const [result, counts] = await Promise.all([
      getProspectsPage(filters, { page, pageSize }),
      getProspectCounts(),
    ]);
    return NextResponse.json({ ...result, counts }, { headers: corsHeaders });
  } catch (error) {
    console.error("Error fetching prospects:", error);
    return NextResponse.json(
      { error: "Failed to fetch prospects" },
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
        { error: "Prospect data is invalid", fields: parsed.error.flatten().fieldErrors },
        { status: 400, headers: corsHeaders },
      );
    }
    const { triggerResearch, ...input } = parsed.data;
    const prospect = await createProspect(input);
    if (triggerResearch) {
      runProspectResearchAsync(buildResearchInput(prospect));
    }
    return NextResponse.json(
      { ...prospect, existed: false },
      { status: 201, headers: corsHeaders },
    );
  } catch (error) {
    console.error("Error creating prospect:", error);
    return NextResponse.json(
      { error: "Failed to create prospect" },
      { status: 500, headers: corsHeaders },
    );
  }
}
