import { NextRequest, NextResponse } from "next/server";
import { disconnectChannel } from "@/products/content-generator/publishing/channel-repository";
import { publishingDb } from "../../_publishing/db";

export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const pool = await publishingDb(request.headers);
    const disconnected = await disconnectChannel(pool, id);
    if (!disconnected) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error disconnecting channel:", error);
    return NextResponse.json({ error: "Failed to disconnect channel" }, { status: 500 });
  }
}
