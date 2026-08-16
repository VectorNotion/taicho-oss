import { APIError, betterAuth, type JWTPayload } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { and, eq, sql } from "drizzle-orm";
import { createAuthClient } from "better-auth/client";
import { oauthProvider, oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { genericOAuth, jwt, organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { toNextJsHandler } from "better-auth/next-js";
import { getCommercialSummary, isPlatformOperator, provisionCommercialOrganization } from "@content-automation/platform/commercial";
import {
  activateExecutionContext,
  createLogger,
  enrichExecutionContext,
  observeOperation,
} from "@content-automation/observability";
import type { CapabilityId, PlanId } from "@content-automation/platform/commercial";
import {
  mcp_service_principal as servicePrincipalTable,
  member as memberTable,
  oauthClient as oauthClientTable,
  organization as organizationTable,
  organization_entitlement as entitlementTable,
} from "@content-automation/database";
import * as databaseSchema from "@content-automation/database/schema";
import { authDatabase } from "./database";
import { ac, canManageOrganization, canOpenAdmin, hasAnyRole, roles, type ProductAction, type ProductId, permissionForRequest, roleHasPermission } from "./permissions";
import { signupPolicy } from "./signup-policy";

function productionAuthConfiguration() {
  const baseUrl = process.env.BETTER_AUTH_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!baseUrl) throw new Error("BETTER_AUTH_URL is required in production.");
    if (new URL(baseUrl).protocol !== "https:") {
      throw new Error("BETTER_AUTH_URL must use HTTPS in production.");
    }
    if (!secret || secret.length < 32) {
      throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters in production.");
    }
  }
  return {
    baseUrl: baseUrl ?? "http://localhost:3000",
    secret: secret ?? "local-development-secret-change-before-production-32chars",
  };
}

const authConfiguration = productionAuthConfiguration();
const betterAuthBaseUrl = authConfiguration.baseUrl;
const configuredSignupPolicy = signupPolicy();
const productionRuntime = process.env.NODE_ENV === "production";

export const MCP_RESOURCE_URL = process.env.MCP_RESOURCE_URL ?? new URL("/api/mcp", betterAuthBaseUrl).toString();
export const API_RESOURCE_URL = process.env.API_RESOURCE_URL ?? new URL("/api/v1", betterAuthBaseUrl).toString();
export const OAUTH_AUTHORIZATION_ISSUER = process.env.OAUTH_AUTHORIZATION_ISSUER ?? process.env.MCP_AUTHORIZATION_ISSUER ?? new URL("/api/auth", betterAuthBaseUrl).toString();
export const ORGANIZATION_CLAIM = "https://vectornotion.com/claims/organization_id";
export const ACTOR_TYPE_CLAIM = "https://vectornotion.com/claims/actor_type";
export const ROLE_CLAIM = "https://vectornotion.com/claims/role";
export const PLATFORM_OAUTH_SCOPES = [
  "vn:read",
  "vn:workspace:read",
  "vn:content:read",
  "vn:outreach:read",
  "vn:cascade:read",
  "vn:operations:read",
  "vn:intelligence:read",
  "vn:intelligence:execute",
  "vn:intelligence:outcomes:write",
  "vn:webhooks:read",
  "vn:webhooks:write",
  "vn:ai:execute",
  "vn:content:write",
  "vn:content:publish",
  "vn:outreach:write",
  "vn:cascade:write",
  "vn:workspace:write",
  "vn:integrations:write",
  "vn:billing:write",
  "vn:workspace:admin",
  "vn:commercial:operator",
] as const;

export type OAuthScope = (typeof PLATFORM_OAUTH_SCOPES)[number];
export const MCP_AUTHORIZATION_ISSUER = OAUTH_AUTHORIZATION_ISSUER;
export const MCP_ORGANIZATION_CLAIM = ORGANIZATION_CLAIM;
export const MCP_ACTOR_TYPE_CLAIM = ACTOR_TYPE_CLAIM;
export const MCP_ROLE_CLAIM = ROLE_CLAIM;
export const MCP_SCOPES = PLATFORM_OAUTH_SCOPES;
export type McpScope = OAuthScope;
const observabilityLog = createLogger("authorization");

const OAUTH_PROVIDER_SCOPES = ["openid", "profile", "email", "offline_access", ...PLATFORM_OAUTH_SCOPES];

function needsOrganization(scopes: readonly string[]) {
  return scopes.some((scope) => scope.startsWith("vn:"));
}

async function organizationMembership(userId: string, organizationId: string) {
  const [membership] = await authDatabase
    .select({ role: memberTable.role, name: organizationTable.name })
    .from(memberTable)
    .innerJoin(
      organizationTable,
      eq(organizationTable.id, memberTable.organizationId),
    )
    .where(
      and(
        eq(memberTable.userId, userId),
        eq(memberTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return membership ?? null;
}

type GenericProvider = {
  providerId: string;
  clientId: string;
  clientSecret: string;
  discoveryUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  scopes?: string[];
};

function oauthProviders(): GenericProvider[] {
  const value = process.env.AUTH_OAUTH_PROVIDERS;
  if (!value) return [];
  try {
    const providers = JSON.parse(value);
    return Array.isArray(providers) ? providers : [];
  } catch {
    throw new Error("AUTH_OAUTH_PROVIDERS must be a valid JSON array");
  }
}

export const auth = betterAuth({
  database: drizzleAdapter(authDatabase, {
    provider: "pg",
    schema: databaseSchema,
  }),
  baseURL: betterAuthBaseUrl,
  // Set the default explicitly because the OAuth resource-client plugin reads
  // auth.options.basePath when constructing the JWKS URL for local JWT checks.
  basePath: "/api/auth",
  secret: authConfiguration.secret,
  trustedOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "http://localhost:3000,http://localhost:3004,http://localhost:3005")
    .split(",")
    .map((origin) => origin.trim()),
  emailAndPassword: {
    enabled: true,
    disableSignUp: configuredSignupPolicy !== "open",
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
  },
  rateLimit: {
    enabled: process.env.NODE_ENV === "production"
      || process.env.AUTH_RATE_LIMIT_ENABLED === "true",
    storage: "database",
    window: 60,
    max: 120,
    customRules: {
      "/sign-in/email": { window: 15 * 60, max: 10 },
      "/sign-up/email": { window: 60 * 60, max: 3 },
      "/forget-password": { window: 60 * 60, max: 3 },
      "/reset-password": { window: 60 * 60, max: 5 },
      "/oauth2/token": { window: 60, max: 30 },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 60,
  },
  plugins: [
    jwt(),
    organization({
      ac,
      roles,
      teams: {
        enabled: true,
        maximumTeams: 50,
        allowRemovingAllTeams: true,
      },
      allowUserToCreateOrganization: true,
      organizationLimit: 10,
    }),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/oauth/consent",
      scopes: OAUTH_PROVIDER_SCOPES,
      validAudiences: [MCP_RESOURCE_URL, API_RESOURCE_URL],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: (process.env.OAUTH_ALLOW_PUBLIC_REGISTRATION ?? process.env.MCP_ALLOW_PUBLIC_REGISTRATION) === "true",
      clientRegistrationDefaultScopes: ["openid", "profile", "email", "vn:read"],
      clientRegistrationAllowedScopes: [...PLATFORM_OAUTH_SCOPES, "offline_access"],
      clientCredentialGrantDefaultScopes: ["vn:read"],
      silenceWarnings: { oauthAuthServerConfig: true },
      clientReference: ({ session }) => session?.activeOrganizationId as string | undefined,
      clientPrivileges: async ({ session }) => {
        const organizationId = session?.activeOrganizationId as string | undefined;
        const userId = session?.userId as string | undefined;
        if (!organizationId || !userId) return false;
        const membership = await organizationMembership(userId, organizationId);
        return Boolean(membership && canManageOrganization(membership.role));
      },
      postLogin: {
        page: "/oauth/select-organization",
        shouldRedirect: async ({ session, scopes }) => {
          if (!needsOrganization(scopes)) return false;
          const activeOrganizationId = session.activeOrganizationId as string | undefined;
          if (!activeOrganizationId) return true;
          return !(await organizationMembership(session.userId, activeOrganizationId));
        },
        consentReferenceId: async ({ session, scopes }) => {
          if (!needsOrganization(scopes)) return undefined;
          const organizationId = session.activeOrganizationId as string | undefined;
          if (!organizationId || !(await organizationMembership(session.userId, organizationId))) {
            throw new APIError("BAD_REQUEST", {
              error: "organization_required",
              error_description: "Select an organization before authorizing this client.",
            });
          }
          return organizationId;
        },
      },
      customAccessTokenClaims: async ({ user, scopes, referenceId, resource, metadata }) => {
        if (!needsOrganization(scopes)) return {};
        const allowedResources = Array.isArray(metadata?.allowed_resources)
          ? metadata.allowed_resources.filter((value): value is OAuthResourceKind => value === "api" || value === "mcp")
          : [];
        const requestedResource = resource === API_RESOURCE_URL
          ? "api"
          : resource === MCP_RESOURCE_URL
            ? "mcp"
            : undefined;
        if (allowedResources.length > 0 && (!requestedResource || !allowedResources.includes(requestedResource))) {
          throw new APIError("FORBIDDEN", {
            error: "invalid_target",
            error_description: "This OAuth client is not approved for the requested resource.",
          });
        }
        // Better Auth's client_credentials path does not pass client.referenceId
        // into customAccessTokenClaims, so approved service clients carry the
        // same immutable organization binding in authenticated client metadata.
        const servicePrincipal = metadata?.service_principal === true || metadata?.mcp_service_principal === true;
        const metadataOrganizationId = servicePrincipal && typeof metadata.organization_id === "string"
          ? metadata.organization_id
          : undefined;
        const tokenOrganizationId = referenceId ?? metadataOrganizationId;
        if (!tokenOrganizationId) {
          throw new APIError("BAD_REQUEST", {
            error: "organization_required",
            error_description: "This token must be bound to an organization.",
          });
        }

        if (user) {
          if (scopes.includes("vn:commercial:operator") && !isPlatformOperator(user.email)) {
            throw new APIError("FORBIDDEN", {
              error: "insufficient_privilege",
              error_description: "Platform-operator scope is restricted to configured commercial operators.",
            });
          }
          const membership = await organizationMembership(user.id, tokenOrganizationId);
          if (!membership) {
            throw new APIError("FORBIDDEN", {
              error: "membership_required",
              error_description: "The user is no longer a member of this organization.",
            });
          }
          return {
            [ORGANIZATION_CLAIM]: tokenOrganizationId,
            [ACTOR_TYPE_CLAIM]: "user",
            [ROLE_CLAIM]: membership.role,
          };
        }

        if (!servicePrincipal) {
          throw new APIError("FORBIDDEN", {
            error: "service_principal_required",
            error_description: "Client credentials require an approved service principal.",
          });
        }
        return {
          [ORGANIZATION_CLAIM]: tokenOrganizationId,
          [ACTOR_TYPE_CLAIM]: "service",
        };
      },
      scopeExpirations: {
        "vn:ai:execute": "30m",
        "vn:intelligence:execute": "30m",
        "vn:intelligence:outcomes:write": "30m",
        "vn:content:publish": "15m",
        "vn:workspace:admin": "15m",
        "vn:commercial:operator": "10m",
      },
    }),
    genericOAuth({ config: oauthProviders() }),
    nextCookies(),
  ],
  advanced: {
    useSecureCookies: productionRuntime,
    defaultCookieAttributes: {
      httpOnly: true,
      secure: productionRuntime,
      sameSite: "lax",
      path: "/",
    },
    ipAddress: {
      // The production nginx boundary overwrites this with one client address;
      // it never forwards a caller-controlled chain.
      ipAddressHeaders: ["x-forwarded-for"],
      ipv6Subnet: 64,
    },
  },
});

const mcpResourceClient = createAuthClient({
  baseURL: betterAuthBaseUrl,
  plugins: [oauthProviderResourceClient(auth)],
});

export const oauthAuthorizationServerMetadataHandler = oauthProviderAuthServerMetadata(auth);

const nextAuthHandler = toNextJsHandler(auth);

async function observedAuthRequest(method: "GET" | "POST", request: Request) {
  activateExecutionContext({ headers: request.headers, actorType: "system" });
  return observeOperation("auth.protocol.request", {
    headers: request.headers,
    actorType: "system",
    attributes: { http_method: method },
  }, async () => {
    // Existing sessions can be attributed before Better Auth handles refresh,
    // sign-out, organization, and account-management operations. Login and
    // signup requests intentionally remain system-attributed until identity
    // verification succeeds inside Better Auth.
    await getAuthorizationContext(request.headers).catch(() => null);
    const response = await nextAuthHandler[method](request);
    if (response.status === 429) {
      observabilityLog.warn("auth.abuse.rate_limited", {
        auth_path: new URL(request.url).pathname,
        retry_after: response.headers.get("retry-after") ?? "unknown",
      });
    }
    return response;
  });
}

export const authHandler = {
  GET: (request: Request) => observedAuthRequest("GET", request),
  POST: (request: Request) => observedAuthRequest("POST", request),
};

export type AuthSession = typeof auth.$Infer.Session;

export type WorkspaceType = "personal" | "business";

export type OrganizationAuthorizationContext = {
  organizationId: string;
  organizationName: string;
  workspaceType: WorkspaceType;
  role: string;
  entitlements: ProductId[];
  planId: PlanId;
  subscriptionStatus: "active" | "expired" | "cancelled";
  capabilities: CapabilityId[];
};

export type AuthorizationContext = OrganizationAuthorizationContext & {
  session: AuthSession;
};

export type OAuthResourceKind = "api" | "mcp";

export type ExternalAuthorizationContext = OrganizationAuthorizationContext & {
  actor: {
    type: "user" | "service";
    userId?: string;
    clientId: string;
    billingUserId: string;
  };
  scopes: OAuthScope[];
  resource: OAuthResourceKind;
  claims: JWTPayload;
};

/** Compatibility type for the MCP adapter while callers move to the shared context. */
export type McpAuthorizationContext = Omit<ExternalAuthorizationContext, "resource"> & {
  resource?: "mcp";
};

export class ExternalAuthorizationError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
    readonly code: "invalid_token" | "insufficient_scope" | "forbidden",
    readonly requiredScopes: OAuthScope[] = [],
  ) {
    super(message);
    this.name = "ExternalAuthorizationError";
  }
}

export const McpAuthorizationError = ExternalAuthorizationError;
export type McpAuthorizationError = ExternalAuthorizationError;

async function loadOrganizationAuthorization(
  userId: string,
  organizationId: string,
  roleOverride?: string,
): Promise<OrganizationAuthorizationContext | null> {
  const member = await organizationMembership(userId, organizationId);
  if (!member) return null;

  const entitlementRows = await authDatabase
    .select({ product: entitlementTable.product })
    .from(entitlementTable)
    .where(and(
      eq(entitlementTable.organization_id, organizationId),
      eq(entitlementTable.enabled, true),
    ));
  const commercial = await getCommercialSummary(organizationId, userId);

  return {
    organizationId,
    organizationName: member.name,
    workspaceType: commercial.plan.creditOwner === "organization"
      ? "business"
      : "personal",
    role: roleOverride ?? member.role,
    entitlements: entitlementRows.map((row) => row.product as ProductId),
    planId: commercial.plan.id,
    subscriptionStatus: commercial.subscriptionStatus,
    capabilities: commercial.commerciallyActive ? commercial.plan.capabilities : [],
  };
}

export async function getAuthorizationContext(headers: Headers): Promise<AuthorizationContext | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;

  let organizationId = session.session.activeOrganizationId;
  if (!organizationId) {
    const organizations = await auth.api.listOrganizations({ headers });
    const first = organizations[0];
    if (!first) return null;
    organizationId = first.id;
  }

  const organization = await loadOrganizationAuthorization(session.user.id, organizationId);
  if (!organization) return null;

  const context = {
    session,
    ...organization,
  };
  enrichExecutionContext({
    headers,
    organizationId,
    actorId: session.user.id,
    actorType: "user",
    sessionId: session.session.id,
  });
  return context;
}

function parseTokenScopes(claims: JWTPayload): OAuthScope[] {
  const raw = typeof claims.scope === "string"
    ? claims.scope.split(/\s+/)
    : Array.isArray(claims.scope)
      ? claims.scope
      : [];
  const supported = new Set<string>(PLATFORM_OAUTH_SCOPES);
  return [...new Set(raw.filter((scope): scope is OAuthScope => typeof scope === "string" && supported.has(scope)))];
}

function stringClaim(claims: JWTPayload, name: string): string | null {
  const value = claims[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function getExternalAuthorizationContext(
  headers: Headers,
  resource: OAuthResourceKind,
): Promise<ExternalAuthorizationContext> {
  const authorization = headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : undefined;
  const audience = resource === "mcp" ? MCP_RESOURCE_URL : API_RESOURCE_URL;
  const resourceLabel = resource === "mcp" ? "MCP" : "API";

  let claims: JWTPayload;
  try {
    claims = await mcpResourceClient.verifyAccessToken(token, {
      verifyOptions: { audience, issuer: OAUTH_AUTHORIZATION_ISSUER },
    });
  } catch {
    throw new ExternalAuthorizationError(`A valid ${resourceLabel} access token is required.`, 401, "invalid_token");
  }

  const organizationId = stringClaim(claims, ORGANIZATION_CLAIM);
  const actorType = stringClaim(claims, ACTOR_TYPE_CLAIM);
  const clientId = stringClaim(claims, "azp");
  const scopes = parseTokenScopes(claims);
  if (!organizationId || !clientId || (actorType !== "user" && actorType !== "service") || scopes.length === 0) {
    throw new ExternalAuthorizationError("The token is not bound to an organization and OAuth client.", 401, "invalid_token");
  }

  const [oauthClient] = await authDatabase.select({
    disabled: oauthClientTable.disabled,
    referenceId: oauthClientTable.referenceId,
    scopes: oauthClientTable.scopes,
    metadata: oauthClientTable.metadata,
  }).from(oauthClientTable).where(eq(oauthClientTable.clientId, clientId)).limit(1);
  if (!oauthClient || oauthClient.disabled === true) {
    throw new ExternalAuthorizationError("The OAuth client has been revoked or disabled.", 401, "invalid_token");
  }
  if (oauthClient.referenceId && oauthClient.referenceId !== organizationId) {
    throw new ExternalAuthorizationError("The OAuth client is not approved for this organization.", 403, "forbidden");
  }
  const currentlyAllowedScopes = Array.isArray(oauthClient.scopes) ? oauthClient.scopes : [];
  if (scopes.some((scope) => !currentlyAllowedScopes.includes(scope))) {
    throw new ExternalAuthorizationError("The token exceeds this OAuth client's current allowed scopes.", 403, "insufficient_scope");
  }
  const clientMetadata = (oauthClient.metadata ?? {}) as { allowed_resources?: unknown };
  const currentlyAllowedResources = Array.isArray(clientMetadata.allowed_resources)
    ? clientMetadata.allowed_resources.filter((value): value is OAuthResourceKind => value === "api" || value === "mcp")
    : [];
  if (currentlyAllowedResources.length > 0 && !currentlyAllowedResources.includes(resource)) {
    throw new ExternalAuthorizationError(`The OAuth client is not approved for the ${resourceLabel} resource.`, 403, "forbidden");
  }

  if (actorType === "user") {
    const userId = typeof claims.sub === "string" ? claims.sub : null;
    if (!userId) throw new ExternalAuthorizationError("The token has no user subject.", 401, "invalid_token");
    const organization = await loadOrganizationAuthorization(userId, organizationId);
    if (!organization) {
      throw new ExternalAuthorizationError("Organization membership is no longer active.", 403, "forbidden");
    }
    const context: ExternalAuthorizationContext = {
      ...organization,
      actor: { type: "user", userId, clientId, billingUserId: userId },
      scopes,
      resource,
      claims,
    };
    enrichExecutionContext({
      headers,
      organizationId,
      actorId: userId,
      actorType: "user",
      sessionId: typeof claims.sid === "string" ? claims.sid : undefined,
    });
    return context;
  }

  const [principal] = await authDatabase
    .select({
      billingUserId: servicePrincipalTable.billing_user_id,
      role: servicePrincipalTable.role,
      allowedScopes: servicePrincipalTable.allowed_scopes,
      allowedResources: servicePrincipalTable.allowed_resources,
    })
    .from(servicePrincipalTable)
    .where(and(
      eq(servicePrincipalTable.oauth_client_id, clientId),
      eq(servicePrincipalTable.organization_id, organizationId),
      eq(servicePrincipalTable.enabled, true),
    ))
    .limit(1);
  if (!principal) {
    throw new ExternalAuthorizationError("The service principal is disabled or unknown.", 403, "forbidden");
  }
  if (scopes.some((scope) => !principal.allowedScopes.includes(scope))) {
    throw new ExternalAuthorizationError("The token exceeds this service principal's allowed scopes.", 403, "insufficient_scope");
  }
  if (!principal.allowedResources.includes(resource)) {
    throw new ExternalAuthorizationError(`The service principal is not approved for the ${resourceLabel} resource.`, 403, "forbidden");
  }
  const organization = await loadOrganizationAuthorization(principal.billingUserId, organizationId, principal.role);
  if (!organization) {
    throw new ExternalAuthorizationError("The service principal billing member is no longer active.", 403, "forbidden");
  }
  const context: ExternalAuthorizationContext = {
    ...organization,
    actor: { type: "service", clientId, billingUserId: principal.billingUserId },
    scopes,
    resource,
    claims,
  };
  enrichExecutionContext({
    headers,
    organizationId,
    actorId: clientId,
    actorType: "service",
    sessionId: typeof claims.sid === "string" ? claims.sid : undefined,
  });
  return context;
}

export async function getMcpAuthorizationContext(headers: Headers): Promise<McpAuthorizationContext> {
  const context = await getExternalAuthorizationContext(headers, "mcp");
  return { ...context, resource: "mcp" };
}

export async function getApiAuthorizationContext(headers: Headers): Promise<ExternalAuthorizationContext> {
  return getExternalAuthorizationContext(headers, "api");
}

/**
 * Dashboard sessions call the same /api/v1 surface as OAuth clients. Their
 * synthetic client id keeps rate limiting and idempotency per-user without an
 * oauthClient row.
 */
export const SESSION_CLIENT_ID_PREFIX = "session:";

/**
 * Scopes a dashboard session receives, derived from the workspace role. The
 * registry re-checks role authorization on every call, so scopes here only
 * bound the surface — they never widen what the role can do.
 *
 * vn:commercial:operator is deliberately never session-derived: it is a
 * platform-operator scope, not a workspace-role scope. Operator capabilities
 * require an OAuth token explicitly granted that scope.
 */
export function sessionScopesForRole(role: string): OAuthScope[] {
  const scopes = new Set<OAuthScope>(["vn:read", "vn:workspace:read", "vn:operations:read"]);
  const products: Array<{ product: ProductId; read: OAuthScope; write: OAuthScope }> = [
    { product: "outreach", read: "vn:outreach:read", write: "vn:outreach:write" },
    { product: "content", read: "vn:content:read", write: "vn:content:write" },
    { product: "cascade", read: "vn:cascade:read", write: "vn:cascade:write" },
  ];
  for (const { product, read, write } of products) {
    if (roleHasPermission(role, product, "read")) scopes.add(read);
    if (roleHasPermission(role, product, "create") || roleHasPermission(role, product, "update")) scopes.add(write);
  }
  if (roleHasPermission(role, "content", "publish")) scopes.add("vn:content:publish");
  if (
    roleHasPermission(role, "content", "generate")
    || roleHasPermission(role, "content", "research")
    || roleHasPermission(role, "outreach", "research")
  ) scopes.add("vn:ai:execute");
  // Team administrators reach the admin-console capabilities; their role
  // authorization inside each capability still restricts them to their teams.
  if (hasAnyRole(role, ["team_admin"])) scopes.add("vn:workspace:admin");
  if (canManageOrganization(role)) {
    scopes.add("vn:workspace:write");
    scopes.add("vn:workspace:admin");
    scopes.add("vn:integrations:write");
    scopes.add("vn:billing:write");
    scopes.add("vn:webhooks:read");
    scopes.add("vn:webhooks:write");
    scopes.add("vn:intelligence:read");
    scopes.add("vn:intelligence:execute");
    scopes.add("vn:intelligence:outcomes:write");
  }
  return [...scopes];
}

/**
 * Authenticate a dashboard session as an API caller. Returns null when no
 * valid session is present so the caller can fall through to its
 * unauthenticated handling. CSRF defense for cookie-authenticated mutations
 * is the transport layer's responsibility — this function only mints the
 * context.
 */
export async function getSessionApiAuthorizationContext(headers: Headers): Promise<ExternalAuthorizationContext | null> {
  const context = await getAuthorizationContext(headers);
  if (!context) return null;
  const userId = context.session.user.id;
  const { session: _session, ...organization } = context;
  return {
    ...organization,
    actor: {
      type: "user",
      userId,
      clientId: `${SESSION_CLIENT_ID_PREFIX}${userId}`,
      billingUserId: userId,
    },
    scopes: sessionScopesForRole(organization.role),
    resource: "api",
    claims: {},
  };
}

export function requireOAuthScopes(
  context: Pick<ExternalAuthorizationContext, "scopes">,
  requiredScopes: readonly OAuthScope[],
) {
  const missing = requiredScopes.filter((scope) => !context.scopes.includes(scope));
  if (missing.length > 0) {
    throw new ExternalAuthorizationError(
      `Additional OAuth scope required: ${missing.join(" ")}`,
      403,
      "insufficient_scope",
      [...missing],
    );
  }
}

export function requireMcpScopes(context: McpAuthorizationContext, requiredScopes: readonly McpScope[]) {
  requireOAuthScopes(context as ExternalAuthorizationContext, requiredScopes);
}

export async function getProtectedResourceMetadata(resource: OAuthResourceKind) {
  return mcpResourceClient.getProtectedResourceMetadata({
    resource: resource === "mcp" ? MCP_RESOURCE_URL : API_RESOURCE_URL,
    authorization_servers: [OAUTH_AUTHORIZATION_ISSUER],
    scopes_supported: [...PLATFORM_OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
  });
}

export async function getMcpProtectedResourceMetadata() {
  return getProtectedResourceMetadata("mcp");
}

export async function getApiProtectedResourceMetadata() {
  return getProtectedResourceMetadata("api");
}

export function isAuthorized(context: OrganizationAuthorizationContext, product: ProductId, action: ProductAction): boolean {
  const commerciallyEnabled = product === "content"
    ? context.capabilities.includes("content.basic")
    : product === "outreach"
      ? context.capabilities.includes("outreach")
      : context.capabilities.includes("cascade");
  const actionEnabled = product !== "content"
    ? true
    : action === "publish"
      ? context.capabilities.includes("content.publish")
      : action === "research"
        ? context.capabilities.includes("research")
        : action === "generate"
          ? context.capabilities.includes("ai.basic")
          : true;
  return commerciallyEnabled && actionEnabled && context.entitlements.includes(product) && roleHasPermission(context.role, product, action);
}

export async function authorizeRequest(
  request: { headers: Headers; method: string; url: string },
  pageProduct: ProductId | null,
) {
  activateExecutionContext({ headers: request.headers, actorType: "system" });
  return observeOperation("auth.authorize_request", {
    headers: request.headers,
    attributes: { http_method: request.method, page_product: pageProduct ?? "platform" },
  }, async () => {
    const context = await getAuthorizationContext(request.headers);
    if (!context) {
      observabilityLog.warn("authorization.denied", { reason: "unauthenticated" });
      return { allowed: false as const, reason: "unauthenticated" as const, context: null };
    }

    const pathname = new URL(request.url).pathname;
    const permission = permissionForRequest(pathname, request.method);
    const required = permission ?? (pageProduct ? { product: pageProduct, action: "read" as const } : null);
    if ((pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin")) && !canOpenAdmin(context.role)) {
      observabilityLog.warn("authorization.denied", { reason: "forbidden", required: "admin" });
      return { allowed: false as const, reason: "forbidden" as const, context, required: "admin" as const };
    }
    const commercialCapability = pathname.startsWith("/brain") || pathname.startsWith("/api/brain")
      ? "brain"
      : pathname.startsWith("/chat") || pathname.startsWith("/api/chat")
        ? "ai.basic"
        : null;
    if (commercialCapability && !context.capabilities.includes(commercialCapability)) {
      observabilityLog.warn("authorization.denied", { reason: "forbidden", required: commercialCapability });
      return { allowed: false as const, reason: "forbidden" as const, context, required: commercialCapability };
    }
    if (required && !isAuthorized(context, required.product, required.action)) {
      observabilityLog.warn("authorization.denied", {
        reason: "forbidden",
        required_product: required.product,
        required_action: required.action,
      });
      return { allowed: false as const, reason: "forbidden" as const, context, required };
    }
    observabilityLog.info("authorization.allowed", {
      role: context.role,
      required_product: required && typeof required !== "string" ? required.product : undefined,
      required_action: required && typeof required !== "string" ? required.action : undefined,
    });
    return { allowed: true as const, context, required };
  });
}

export async function provisionOrganizationEntitlements(organizationId: string, products: ProductId[]) {
  if (products.length === 0) return;
  await authDatabase
    .insert(entitlementTable)
    .values(products.map((product) => ({ organization_id: organizationId, product })))
    .onConflictDoUpdate({
      target: [entitlementTable.organization_id, entitlementTable.product],
      set: { enabled: true, updated_at: sql`now()` },
    });
}

export async function onboardCurrentUser(requestHeaders: Headers, products: ProductId[]) {
  activateExecutionContext({ headers: requestHeaders, actorType: "system" });
  return observeOperation("auth.onboard_user", {
    headers: requestHeaders,
    actorType: "system",
    attributes: { product_count: products.length },
    workflow: {
      name: "workspace.onboard_user",
      input: { products },
      processOutput: (output) => ({
        status: output.status,
        organizationId: "organization" in output ? output.organization?.id ?? null : null,
      }),
    },
  }, async () => {
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (!session) return { status: 401 as const, error: "Unauthenticated" };
    enrichExecutionContext({
      actorId: session.user.id,
      actorType: "user",
      sessionId: session.session.id,
    });

    const existing = await auth.api.listOrganizations({ headers: requestHeaders });
    let organization = existing[0];
    if (!organization) {
      const slugBase = session.user.email.split("@")[0].replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "workspace";
      organization = await auth.api.createOrganization({
        headers: requestHeaders,
        body: {
          name: `${session.user.name || slugBase}'s Workspace`,
          slug: `${slugBase}-${session.user.id.slice(0, 8)}`,
        },
      });
    }
    enrichExecutionContext({ organizationId: organization.id });

    await provisionOrganizationEntitlements(organization.id, products);
    await provisionCommercialOrganization(organization.id, session.user.id);
    return { status: 200 as const, organization };
  });
}

export { ensureAuthorizationSchema } from "./database";
