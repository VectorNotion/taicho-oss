import { getAuthorizationContext, type AuthorizationContext } from "@content-automation/auth/server";
import { runWithGraphOrganization } from "@content-automation/platform/data/graph";
import { NextResponse } from "next/server";

/**
 * Tenant boundary for every prospect API route.
 *
 * Authenticates the caller and runs the handler inside the caller's graph
 * organization, so all prospect graph access is scoped to their tenant rather
 * than trusting the proxy-set `x-vector-notion-organization-id` header alone.
 * AsyncLocalStorage propagates the org into any fire-and-forget work (background
 * research/qualification) spawned inside `handler`.
 *
 * Returns a 401 when unauthenticated; otherwise the handler's own Response.
 */
export async function withProspectOrg(
  request: Request,
  handler: (context: AuthorizationContext) => Promise<Response>,
  options?: { headers?: HeadersInit },
): Promise<Response> {
  const context = await getAuthorizationContext(request.headers);
  if (!context) {
    return NextResponse.json(
      { error: "Unauthenticated" },
      { status: 401, headers: options?.headers },
    );
  }
  return runWithGraphOrganization(context.organizationId, () => handler(context));
}

/** Generic alias — the same auth + graph-org boundary for non-prospect outreach routes (accounts). */
export const withOrgScope = withProspectOrg;
