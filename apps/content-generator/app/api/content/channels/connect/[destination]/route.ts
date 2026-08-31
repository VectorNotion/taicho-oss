import { NextRequest, NextResponse } from "next/server";
import "@/products/content-generator/publishing/adapters";
import { canManageOrganization } from "@content-automation/auth/permissions";
import { getAuthorizationContext } from "@content-automation/auth/server";
import { getAdapter, hasAdapter } from "@/products/content-generator/publishing/registry";
import {
  encodePublishingOAuthState,
  localPublishingOAuthEnabled,
  PUBLISHING_OAUTH_STATE_COOKIE,
} from "@/products/content-generator/publishing/oauth/state";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ destination: string }> },
) {
  try {
    const { destination } = await params;
    const context = await getAuthorizationContext(request.headers);
    if (!context) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    if (!canManageOrganization(context.role)) {
      return NextResponse.json(
        { error: "Only workspace owners and administrators can connect publishing channels." },
        { status: 403 },
      );
    }
    if (!hasAdapter(destination)) {
      return NextResponse.json({ error: `Unknown destination '${destination}'` }, { status: 404 });
    }
    const adapter = getAdapter(destination);
    if (!adapter.oauth) {
      return NextResponse.json(
        { error: `${destination} does not connect via OAuth` },
        { status: 400 },
      );
    }

    const origin = request.nextUrl.origin;
    const redirectUri = `${origin}/api/content/channels/callback/${destination}`;
    const nonce = crypto.randomUUID();
    let authorizationUrl: string;
    if (localPublishingOAuthEnabled()) {
      const callback = new URL(redirectUri);
      const qaResult = request.nextUrl.searchParams.get("qa_result");
      if (qaResult === "denied") callback.searchParams.set("error", "access_denied");
      else callback.searchParams.set("code", "browser-qa-code");
      if (adapter.credentialKind !== "oauth1") {
        callback.searchParams.set("state", qaResult === "state-mismatch" ? "mismatched-state" : nonce);
      } else {
        callback.searchParams.set("oauth_token", "browser-qa-token");
        callback.searchParams.set("oauth_verifier", "browser-qa-verifier");
      }
      authorizationUrl = callback.toString();
    } else {
      authorizationUrl = await adapter.oauth.buildAuthUrl(redirectUri, nonce);
    }

    const response = NextResponse.redirect(authorizationUrl, 307);
    response.cookies.set(PUBLISHING_OAUTH_STATE_COOKIE, encodePublishingOAuthState({
      nonce,
      organizationId: request.nextUrl.searchParams.get("qa_result") === "wrong-workspace"
        && localPublishingOAuthEnabled()
        ? "browser-qa-wrong-workspace"
        : context.organizationId,
      destination,
    }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    console.error("Error starting channel connection:", error);
    return NextResponse.json({ error: "Failed to start the connection" }, { status: 500 });
  }
}
