import { NextRequest, NextResponse } from "next/server";
import { withOrgScope } from "@/lib/prospect-scope";
import {
  deleteCatalogItem,
  getCatalogItem,
  updateCatalogItem,
} from "@/products/outreach/data/catalog-repository";
import { catalogItemSchema } from "../route";

type CatalogRouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: CatalogRouteContext) {
  return withOrgScope(request, async () => {
    const item = await getCatalogItem((await context.params).id);
    return item
      ? NextResponse.json(item)
      : NextResponse.json({ error: "Catalog item not found" }, { status: 404 });
  });
}

export async function PATCH(request: NextRequest, context: CatalogRouteContext) {
  return withOrgScope(request, async () => {
    const parsed = catalogItemSchema.partial().safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Catalog item is invalid" }, { status: 400 });
    }
    const item = await updateCatalogItem((await context.params).id, parsed.data);
    return item
      ? NextResponse.json(item)
      : NextResponse.json({ error: "Catalog item not found" }, { status: 404 });
  });
}

export async function DELETE(request: NextRequest, context: CatalogRouteContext) {
  return withOrgScope(request, async () => {
    const id = (await context.params).id;
    if (!await getCatalogItem(id)) {
      return NextResponse.json({ error: "Catalog item not found" }, { status: 404 });
    }
    const deleted = await deleteCatalogItem(id);
    return deleted
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json(
          { error: "Catalog items assigned to prospects cannot be deleted. Archive it instead." },
          { status: 409 },
        );
  });
}
