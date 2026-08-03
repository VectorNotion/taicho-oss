import { handleListCreativeMedia, handleStartCreativeGeneration } from "@content-automation/content-generator/media/service";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleListCreativeMedia(request, (await params).id);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleStartCreativeGeneration(request, (await params).id);
}
