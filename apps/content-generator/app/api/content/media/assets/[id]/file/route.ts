import { handleCreativeAssetFile } from "@content-automation/content-generator/media/service";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleCreativeAssetFile(request, (await params).id);
}
