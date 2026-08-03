import { NextRequest, NextResponse } from "next/server";
import "@/products/content-generator/publishing/adapters";
import {
  ScheduleDraftError,
  type ScheduleDraftErrorCode,
  scheduleDraftPost,
} from "@/products/content-generator/publishing/schedule-draft";
import { publishingDb } from "../../../_publishing/db";

export const runtime = "nodejs";

/** HTTP mapping for the shared scheduler's error codes — messages unchanged from the pre-extraction route. */
const ERROR_STATUS: Record<ScheduleDraftErrorCode, number> = {
  UNKNOWN_DESTINATION: 400,
  INVALID_WHEN: 400,
  DRAFT_NOT_FOUND: 404,
  CHANNEL_NOT_FOUND: 400,
  CHANNEL_MISMATCH: 400,
  CHANNEL_AMBIGUOUS: 400,
  ASSET_NOT_FOUND: 404,
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const destination = body?.destination as unknown;
    const channelId = body?.channelId as unknown;
    const when = body?.when as unknown;
    const assetId = body?.assetId as unknown;

    if (typeof destination !== "string") {
      return NextResponse.json({ error: "Unknown destination" }, { status: 400 });
    }
    // The HTTP contract keeps channelId required (the publish dialog always sends it);
    // only headless callers use the shared function's single-channel resolution.
    if (typeof channelId !== "string" || channelId.length === 0) {
      return NextResponse.json({ error: "A channel is required" }, { status: 400 });
    }
    if (when !== undefined && when !== null && when !== "" && typeof when !== "string") {
      return NextResponse.json({ error: "Invalid schedule time" }, { status: 400 });
    }
    if (assetId !== undefined && assetId !== null && typeof assetId !== "string") {
      return NextResponse.json({ error: "Invalid content asset" }, { status: 400 });
    }

    const pool = await publishingDb(request.headers);
    const post = await scheduleDraftPost(pool, {
      draftId: id,
      destination,
      channelId,
      when: typeof when === "string" && when !== "" ? when : undefined,
      assetId: typeof assetId === "string" && assetId ? assetId : undefined,
    });
    return NextResponse.json(post, { status: 201 });
  } catch (error) {
    if (error instanceof ScheduleDraftError) {
      return NextResponse.json({ error: error.message }, { status: ERROR_STATUS[error.code] });
    }
    console.error("Error scheduling post:", error);
    return NextResponse.json({ error: "Failed to schedule the post" }, { status: 500 });
  }
}
