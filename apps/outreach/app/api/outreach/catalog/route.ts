import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withOrgScope } from "@/lib/prospect-scope";
import {
  createCatalogItem,
  listCatalogItems,
} from "@/products/outreach/data/catalog-repository";

export const catalogItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["product", "service", "subscription", "retainer", "bundle", "other"]),
  summary: z.string().trim().max(10_000).default(""),
  positioning: z.string().trim().max(10_000).default(""),
  outcomes: z.string().trim().max(10_000).default(""),
  differentiators: z.string().trim().max(10_000).default(""),
  proof: z.string().trim().max(10_000).default(""),
  researchGuidance: z.string().trim().max(10_000).default(""),
  voice: z.string().trim().max(10_000).default(""),
  status: z.enum(["active", "archived"]).default("active"),
});

export async function GET(request: NextRequest) {
  return withOrgScope(request, async () => {
    const activeOnly = new URL(request.url).searchParams.get("active") === "true";
    return NextResponse.json(await listCatalogItems({ activeOnly }));
  });
}

export async function POST(request: NextRequest) {
  return withOrgScope(request, async () => {
    const parsed = catalogItemSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Catalog item is invalid", fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    return NextResponse.json(await createCatalogItem(parsed.data), { status: 201 });
  });
}
