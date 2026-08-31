import { NextRequest, NextResponse } from "next/server";
import "@/products/content-generator/publishing/adapters";
import { canManageOrganization } from "@content-automation/auth/permissions";
import { getAuthorizationContext } from "@content-automation/auth/server";
import { upsertChannel } from "@/products/content-generator/publishing/channel-repository";
import { getAdapter, hasAdapter } from "@/products/content-generator/publishing/registry";
import {
  decodePublishingOAuthState,
  localPublishingOAuthChannel,
  localPublishingOAuthEnabled,
  PUBLISHING_OAUTH_STATE_COOKIE,
} from "@/products/content-generator/publishing/oauth/state";
import { publishingDb } from "../../../_publishing/db";

export const runtime = "nodejs";

function redirectToChannels(origin: string, query?: Record<string, string>) {
  const url = new URL("/content/channels", origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url, 302);
  response.cookies.delete(PUBLISHING_OAUTH_STATE_COOKIE);
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

    const context = await getAuthorizationContext(request.headers);
    if (!context || !canManageOrganization(context.role)) {
      return redirectToChannels(origin, { error: "permission" });
    }
    const callbackParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const state = decodePublishingOAuthState(
      request.cookies.get(PUBLISHING_OAUTH_STATE_COOKIE)?.value,
    );
    if (!state || state.destination !== destination) {
      return redirectToChannels(origin, { error: "state" });
    }
    if (state.organizationId !== context.organizationId) {
      return redirectToChannels(origin, { error: "workspace" });
    }
    if (callbackParams.error) {
      return redirectToChannels(origin, { error: "denied" });
    }
    // OAuth 1.0a callbacks (x) carry no `state` param — the oauth_token itself
    // correlates the flow, so only OAuth 2 destinations verify the round-trip.
    if (adapter.credentialKind !== "oauth1" && callbackParams.state !== state.nonce) {
      return redirectToChannels(origin, { error: "state" });
    }

    const redirectUri = `${origin}/api/content/channels/callback/${destination}`;
    const connected = localPublishingOAuthEnabled()
      ? localPublishingOAuthChannel(destination, context.organizationId, adapter.credentialKind)
      : await adapter.oauth.exchangeCallback(callbackParams, redirectUri);

    const pool = await publishingDb(request.headers);
    await upsertChannel(pool, {
      id: connected.id,
      destination,
      name: connected.name,
      credentialKind: adapter.credentialKind,
      credentials: connected.credentials,
      tokenExpiry: connected.tokenExpiry,
      extra: connected.extra ?? {},
      orgId: context.organizationId,
    });

    return redirectToChannels(origin, { connected: destination });
  } catch (error) {
    console.error("Error completing channel connection:", error);
    return redirectToChannels(origin, { error: "oauth" });
  }
}
