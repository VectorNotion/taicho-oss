import { handleCancelCreativeRun } from "@content-automation/content-generator/media/service";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleCancelCreativeRun(request, (await params).id);
}
