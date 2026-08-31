import { handleListPostMedia, handleStartPostMedia } from "@content-automation/content-generator/media/service";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleListPostMedia(request, (await params).id);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleStartPostMedia(request, (await params).id);
}
