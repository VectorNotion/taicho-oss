import { NextRequest, NextResponse } from "next/server";
import "@/products/content-generator/publishing/adapters";
import { canManageOrganization } from "@content-automation/auth/permissions";
import { getAuthorizationContext } from "@content-automation/auth/server";
import { publishingChannelInputSchema } from "@/products/content-generator/publishing/channel-config";
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
    const context = await getAuthorizationContext(request.headers);
    if (!context) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    if (!canManageOrganization(context.role)) {
      return NextResponse.json(
        { error: "Only workspace owners and administrators can connect publishing channels." },
        { status: 403 },
      );
    }
    const parsed = publishingChannelInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid publishing channel configuration." },
        { status: 400 },
      );
    }
    const { destination, name, credentials, extra } = parsed.data;
    if (!hasAdapter(destination)) {
      return NextResponse.json({ error: `No adapter registered for ${destination}` }, { status: 400 });
    }

    const adapter = getAdapter(destination);
    const pool = await publishingDb(request.headers);
    const channel = await upsertChannel(pool, {
      id: crypto.randomUUID(),
      destination,
      name,
      credentialKind: adapter.credentialKind,
      credentials,
      tokenExpiry: null,
      extra,
      orgId: context.organizationId,
    });
    return NextResponse.json(toChannelSummary(channel), { status: 201 });
  } catch (error) {
    console.error("Error creating channel:", error);
    return NextResponse.json({ error: "Failed to create channel" }, { status: 500 });
  }
}
