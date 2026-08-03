import { NextRequest, NextResponse } from "next/server";
import "@/products/content-generator/publishing/adapters";
import { upsertChannel } from "@/products/content-generator/publishing/channel-repository";
import { getAdapter, hasAdapter } from "@/products/content-generator/publishing/registry";
import { publishingDb } from "../../../_publishing/db";

export const runtime = "nodejs";

/** Must match the connect route's cookie name. */
const OAUTH_STATE_COOKIE = "publishing_oauth_state";

function redirectToChannels(origin: string, query?: Record<string, string>) {
  const url = new URL("/content/channels", origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url, 302);
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ destination: string }> },
) {
  const origin = request.nextUrl.origin;
  try {
    const { destination } = await params;
    if (!hasAdapter(destination)) {
      return redirectToChannels(origin, { error: "oauth" });
    }
    const adapter = getAdapter(destination);
    if (!adapter.oauth) {
      return redirectToChannels(origin, { error: "oauth" });
    }

    const callbackParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const stateCookie = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
    if (!stateCookie) {
      return redirectToChannels(origin, { error: "state" });
    }
    // OAuth 1.0a callbacks (x) carry no `state` param — the oauth_token itself
    // correlates the flow, so only OAuth 2 destinations verify the round-trip.
    if (adapter.credentialKind !== "oauth1" && callbackParams.state !== stateCookie) {
      return redirectToChannels(origin, { error: "state" });
    }

    const redirectUri = `${origin}/api/content/channels/callback/${destination}`;
    const connected = await adapter.oauth.exchangeCallback(callbackParams, redirectUri);

    const pool = await publishingDb(request.headers);
    await upsertChannel(pool, {
      id: connected.id,
      destination,
      name: connected.name,
      credentialKind: adapter.credentialKind,
      credentials: connected.credentials,
      tokenExpiry: connected.tokenExpiry,
      extra: connected.extra ?? {},
    });

    return redirectToChannels(origin, { connected: destination });
  } catch (error) {
    console.error("Error completing channel connection:", error);
    return redirectToChannels(origin, { error: "oauth" });
  }
}
