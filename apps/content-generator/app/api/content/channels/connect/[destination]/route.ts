import { NextRequest, NextResponse } from "next/server";
import "@/products/content-generator/publishing/adapters";
import { getAdapter, hasAdapter } from "@/products/content-generator/publishing/registry";

export const runtime = "nodejs";

/** Must match the callback route's cookie name. */
const OAUTH_STATE_COOKIE = "publishing_oauth_state";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ destination: string }> },
) {
  try {
    const { destination } = await params;
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
    const state = crypto.randomUUID();
    const authUrl = await adapter.oauth.buildAuthUrl(redirectUri, state);

    const response = NextResponse.redirect(authUrl, 307);
    response.cookies.set(OAUTH_STATE_COOKIE, state, {
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
