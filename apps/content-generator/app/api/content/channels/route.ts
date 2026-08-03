import { NextRequest, NextResponse } from "next/server";
import "@/products/content-generator/publishing/adapters";
import {
  listChannels,
  upsertChannel,
} from "@/products/content-generator/publishing/channel-repository";
import { getAdapter, hasAdapter, listDestinations } from "@/products/content-generator/publishing/registry";
import type { ChannelRecord } from "@/products/content-generator/publishing/types";
import { publishingDb } from "../_publishing/db";

export const runtime = "nodejs";

/** Never send stored credentials (tokens, API keys, secrets) to the client. */
function toChannelSummary(channel: ChannelRecord) {
  const { credentials: _credentials, ...summary } = channel;
  return summary;
}

export async function GET(request: NextRequest) {
  try {
    const pool = await publishingDb(request.headers);
    const channels = await listChannels(pool);
    return NextResponse.json({
      channels: channels.map(toChannelSummary),
      destinations: listDestinations().map((adapter) => ({
        destination: adapter.destination,
        credentialKind: adapter.credentialKind,
        oauthCapable: Boolean(adapter.oauth),
        requiresMedia: Boolean(adapter.requiresMedia),
      })),
    });
  } catch (error) {
    console.error("Error listing channels:", error);
    return NextResponse.json({ error: "Failed to list channels" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const destination = body?.destination as unknown;
    const name = body?.name as unknown;
    const credentials = body?.credentials as unknown;

    if (destination !== "cms" && destination !== "webhook") {
      return NextResponse.json(
        { error: "Only cms and webhook channels can be created with credentials" },
        { status: 400 },
      );
    }
    if (!hasAdapter(destination)) {
      return NextResponse.json({ error: `No adapter registered for ${destination}` }, { status: 400 });
    }
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "A channel name is required" }, { status: 400 });
    }
    if (
      credentials === null ||
      typeof credentials !== "object" ||
      Array.isArray(credentials) ||
      Object.keys(credentials).length === 0 ||
      Object.values(credentials).some((value) => typeof value !== "string" || value.length === 0)
    ) {
      return NextResponse.json(
        { error: "Credentials must be a non-empty object of string values" },
        { status: 400 },
      );
    }

    const adapter = getAdapter(destination);
    const pool = await publishingDb(request.headers);
    const channel = await upsertChannel(pool, {
      id: crypto.randomUUID(),
      destination,
      name: name.trim(),
      credentialKind: adapter.credentialKind,
      credentials: credentials as Record<string, string>,
      tokenExpiry: null,
    });
    return NextResponse.json(toChannelSummary(channel), { status: 201 });
  } catch (error) {
    console.error("Error creating channel:", error);
    return NextResponse.json({ error: "Failed to create channel" }, { status: 500 });
  }
}
