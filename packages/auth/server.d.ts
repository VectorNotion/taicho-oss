/**
 * Stable server-side auth API.
 *
 * Better Auth derives a very large type from every installed plugin. Exposing
 * that inferred type through a workspace package makes each Next.js route
 * instantiate the complete OAuth, organization, and JWT API graph. This
 * declaration intentionally describes the supported cross-package surface
 * while server.ts remains the runtime implementation and source of truth.
 */

type ProductId = "outreach" | "content" | "cascade";
type ProductAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "research"
  | "qualify"
  | "message"
  | "generate"
  | "publish"
  | "approve";

export type PlanId = "trial" | "plus" | "pro" | "team" | "enterprise";
export type CapabilityId =
  | "content.basic"
  | "ai.basic"
  | "content.full"
  | "content.publish"
  | "research"
  | "outreach"
  | "cascade"
  | "brain"
  | "squad"
  | "team.admin";

export const MCP_RESOURCE_URL: string;
export const API_RESOURCE_URL: string;
export const OAUTH_AUTHORIZATION_ISSUER: string;
export const MCP_AUTHORIZATION_ISSUER: string;
export const ORGANIZATION_CLAIM: "https://vectornotion.com/claims/organization_id";
export const ACTOR_TYPE_CLAIM: "https://vectornotion.com/claims/actor_type";
export const ROLE_CLAIM: "https://vectornotion.com/claims/role";
export const MCP_ORGANIZATION_CLAIM: "https://vectornotion.com/claims/organization_id";
export const MCP_ACTOR_TYPE_CLAIM: "https://vectornotion.com/claims/actor_type";
export const MCP_ROLE_CLAIM: "https://vectornotion.com/claims/role";
export const PLATFORM_OAUTH_SCOPES: readonly [
  "vn:read",
  "vn:workspace:read",
  "vn:content:read",
  "vn:outreach:read",
  "vn:cascade:read",
  "vn:operations:read",
  "vn:user:write",
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
];
export const MCP_SCOPES: typeof PLATFORM_OAUTH_SCOPES;
export type OAuthScope = (typeof PLATFORM_OAUTH_SCOPES)[number];
export type McpScope = OAuthScope;

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
};

export type AuthSessionRecord = {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  activeOrganizationId?: string | null;
  [key: string]: unknown;
};

export type AuthSession = {
  user: AuthUser;
  session: AuthSessionRecord;
};

export type AuthOrganization = {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  metadata?: unknown;
  createdAt?: Date;
  [key: string]: unknown;
};

export type PublicOAuthClient = {
  clientId: string;
  clientName?: string | null;
  clientUri?: string | null;
  logoUri?: string | null;
  client_id?: string;
  client_name?: string | null;
  client_uri?: string | null;
  logo_uri?: string | null;
  [key: string]: unknown;
};

type HeaderInput = { headers: Headers };

export const auth: {
  api: {
    getSession(input: HeaderInput): Promise<AuthSession | null>;
    listOrganizations(input: HeaderInput): Promise<AuthOrganization[]>;
    getOAuthClientPublic(input: HeaderInput & { query: { client_id: string } }): Promise<PublicOAuthClient>;
  };
  handler(request: Request): Promise<Response>;
};

export const authHandler: {
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
};

export function oauthAuthorizationServerMetadataHandler(request: Request): Promise<Response>;

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
  claims: Record<string, unknown>;
};

export type McpAuthorizationContext = Omit<ExternalAuthorizationContext, "resource"> & {
  resource?: "mcp";
};

export class ExternalAuthorizationError extends Error {
  readonly status: 401 | 403;
  readonly code: "invalid_token" | "insufficient_scope" | "forbidden";
  readonly requiredScopes: OAuthScope[];
  constructor(
    message: string,
    status: 401 | 403,
    code: "invalid_token" | "insufficient_scope" | "forbidden",
    requiredScopes?: OAuthScope[],
  );
}
export const McpAuthorizationError: typeof ExternalAuthorizationError;
export type McpAuthorizationError = ExternalAuthorizationError;

export function getAuthorizationContext(headers: Headers): Promise<AuthorizationContext | null>;
export function getExternalAuthorizationContext(
  headers: Headers,
  resource: OAuthResourceKind,
): Promise<ExternalAuthorizationContext>;
export function getMcpAuthorizationContext(headers: Headers): Promise<McpAuthorizationContext>;
export function getApiAuthorizationContext(headers: Headers): Promise<ExternalAuthorizationContext>;
export const SESSION_CLIENT_ID_PREFIX: "session:";
export function sessionScopesForRole(role: string): OAuthScope[];
export function createInternalServiceAuthorizationContext(input: {
  organizationId: string;
  billingUserId: string;
  clientId: string;
  scopes: readonly OAuthScope[];
  claims?: Record<string, unknown>;
}): Promise<McpAuthorizationContext>;
export function getSessionApiAuthorizationContext(headers: Headers): Promise<ExternalAuthorizationContext | null>;
export function requireOAuthScopes(
  context: Pick<ExternalAuthorizationContext, "scopes">,
  requiredScopes: readonly OAuthScope[],
): void;
export function requireMcpScopes(
  context: McpAuthorizationContext,
  requiredScopes: readonly McpScope[],
): void;
export function getProtectedResourceMetadata(resource: OAuthResourceKind): Promise<Record<string, unknown>>;
export function getMcpProtectedResourceMetadata(): Promise<Record<string, unknown>>;
export function getApiProtectedResourceMetadata(): Promise<Record<string, unknown>>;
export function isAuthorized(
  context: OrganizationAuthorizationContext,
  product: ProductId,
  action: ProductAction,
): boolean;

export type AuthorizeRequestDecision =
  | {
      allowed: true;
      context: AuthorizationContext;
      required: { product: ProductId; action: ProductAction } | null;
    }
  | {
      allowed: false;
      reason: "unauthenticated";
      context: null;
    }
  | {
      allowed: false;
      reason: "forbidden";
      context: AuthorizationContext;
      required: { product: ProductId; action: ProductAction } | "admin" | "brain";
    };

export function authorizeRequest(
  request: { headers: Headers; method: string; url: string },
  pageProduct: ProductId | null,
): Promise<AuthorizeRequestDecision>;

export function provisionOrganizationEntitlements(
  organizationId: string,
  products: ProductId[],
): Promise<void>;

export function onboardCurrentUser(
  requestHeaders: Headers,
  products: ProductId[],
): Promise<
  | { status: 401; error: "Unauthenticated" }
  | { status: 200; organization: AuthOrganization }
>;

export function ensureAuthorizationSchema(): Promise<void>;
