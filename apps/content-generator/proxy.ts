import { authorizeRequest } from "@content-automation/auth/server";
import {
  EXECUTION_ID_HEADER,
  REQUEST_ID_HEADER,
  SUPPORT_CODE_HEADER,
  headersAtExternalBoundary,
  headersWithExecutionContext,
} from "@content-automation/observability/headers";
import { NextRequest, NextResponse } from "next/server";

function continueWithAttribution(
  request: NextRequest,
  attribution: Parameters<typeof headersWithExecutionContext>[1] = {},
  source: Headers = request.headers,
) {
  const headers = headersWithExecutionContext(source, attribution);
  const response = NextResponse.next({ request: { headers } });
  return withPublicCorrelation(response, headers);
}

function withPublicCorrelation<T extends NextResponse>(response: T, headers: Headers): T {
  response.headers.set(REQUEST_ID_HEADER, headers.get(REQUEST_ID_HEADER)!);
  response.headers.set(EXECUTION_ID_HEADER, headers.get(EXECUTION_ID_HEADER)!);
  response.headers.set(SUPPORT_CODE_HEADER, headers.get(SUPPORT_CODE_HEADER)!);
  return response;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const correlationHeaders = headersAtExternalBoundary(request.headers);
  if (pathname === "/sign-in" || pathname === "/access-denied" || pathname.startsWith("/api/auth") || pathname === "/api/onboarding" || pathname === "/api/content/media/fal/webhook") return continueWithAttribution(request, {}, correlationHeaders);
  const decision = await authorizeRequest(
    { headers: correlationHeaders, method: request.method, url: request.url },
    "content",
  );
  if (decision.allowed) {
    return continueWithAttribution(request, {
      organizationId: decision.context.organizationId,
      actorId: decision.context.session.user.id,
      actorType: "user",
      sessionId: decision.context.session.session.id,
    }, correlationHeaders);
  }
  if (pathname.startsWith("/api/")) return withPublicCorrelation(
    NextResponse.json({ error: decision.reason === "unauthenticated" ? "Unauthenticated" : "Forbidden" }, { status: decision.reason === "unauthenticated" ? 401 : 403 }),
    correlationHeaders,
  );
  return withPublicCorrelation(
    NextResponse.redirect(new URL(decision.reason === "unauthenticated" ? "/sign-in" : "/access-denied", request.url)),
    correlationHeaders,
  );
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] };
