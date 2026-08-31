import {
  member as memberTable,
  oauthClient as oauthClientTable,
} from "@content-automation/database";
import { and, desc, eq, sql } from "drizzle-orm";
import { authDatabase } from "./database";
import {
  API_RESOURCE_URL,
  OAUTH_AUTHORIZATION_ISSUER,
  PLATFORM_OAUTH_SCOPES,
  type OAuthResourceKind,
  type OAuthScope,
} from "./server";

export {
  createExternalServicePrincipal,
  deleteExternalServicePrincipal,
  rotateExternalServicePrincipalSecret,
  updateExternalServicePrincipal,
} from "./mcp-administration";

type ClientMetadata = {
  managed_external_api?: boolean;
  service_principal?: boolean;
  allowed_resources?: OAuthResourceKind[];
  created_by_user_id?: string;
};

export type ExternalOAuthApplication = {
  clientId: string;
  name: string;
  redirectUris: string[];
  scopes: OAuthScope[];
  resources: OAuthResourceKind[];
  clientType: "public" | "confidential";
  offlineAccess: boolean;
  disabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export class OAuthApplicationAdministrationError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT",
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "OAuthApplicationAdministrationError";
  }
}

function randomSecret(bytes = 36) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

async function hashOAuthSecret(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("base64url");
}

async function assertOrganizationMember(organizationId: string, userId: string) {
  const [member] = await authDatabase.select({ id: memberTable.id }).from(memberTable).where(and(
    eq(memberTable.organizationId, organizationId),
    eq(memberTable.userId, userId),
  )).limit(1);
  if (!member) throw new Error("Organization member not found.");
}

function validateScopes(scopes: readonly string[]): OAuthScope[] {
  const supported = new Set<string>(PLATFORM_OAUTH_SCOPES);
  const unique = [...new Set(scopes)];
  if (unique.length === 0 || unique.some((scope) => !supported.has(scope))) {
    throw new OAuthApplicationAdministrationError("INVALID_INPUT", "One or more OAuth scopes are unsupported.", 400);
  }
  if (unique.includes("vn:commercial:operator")) {
    throw new OAuthApplicationAdministrationError("INVALID_INPUT", "Platform-operator scope cannot be delegated to an OAuth application.", 400);
  }
  return unique as OAuthScope[];
}

function validateResources(resources: readonly OAuthResourceKind[]): OAuthResourceKind[] {
  const unique = [...new Set(resources)];
  if (unique.length === 0 || unique.some((resource) => resource !== "api" && resource !== "mcp")) {
    throw new OAuthApplicationAdministrationError("INVALID_INPUT", "At least one supported OAuth resource is required.", 400);
  }
  return unique;
}

function validateRedirectUris(values: readonly string[]): string[] {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (unique.length === 0 || unique.length > 20) throw new OAuthApplicationAdministrationError("INVALID_INPUT", "Provide between one and twenty redirect URIs.", 400);
  return unique.map((value) => {
    let uri: URL;
    try {
      uri = new URL(value);
    } catch {
      throw new OAuthApplicationAdministrationError("INVALID_INPUT", "Redirect URIs must be absolute URLs.", 400);
    }
    const loopback = uri.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(uri.hostname);
    if (uri.hash || uri.username || uri.password || (uri.protocol !== "https:" && !loopback)) {
      throw new OAuthApplicationAdministrationError("INVALID_INPUT", "Redirect URIs must use HTTPS, except for HTTP loopback development URLs, and cannot contain credentials or fragments.", 400);
    }
    return uri.toString();
  });
}

function applicationFromRow(row: {
  clientId: string;
  name: string | null;
  redirectUris: unknown;
  scopes: unknown;
  public: boolean | null;
  disabled: boolean | null;
  createdAt: string | null;
  updatedAt: string | null;
  metadata: unknown;
}): ExternalOAuthApplication | null {
  const metadata = (row.metadata ?? {}) as ClientMetadata;
  if (metadata.service_principal || metadata.managed_external_api !== true) return null;
  const clientScopes = Array.isArray(row.scopes) ? row.scopes : [];
  return {
    clientId: row.clientId,
    name: row.name ?? "OAuth application",
    redirectUris: Array.isArray(row.redirectUris) ? row.redirectUris.filter((value): value is string => typeof value === "string") : [],
    scopes: clientScopes.filter((scope): scope is OAuthScope => PLATFORM_OAUTH_SCOPES.includes(scope as OAuthScope)),
    resources: validateResources(metadata.allowed_resources ?? ["api"]),
    clientType: row.public ? "public" : "confidential",
    offlineAccess: clientScopes.includes("offline_access"),
    disabled: row.disabled === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const applicationSelection = {
  clientId: oauthClientTable.clientId,
  name: oauthClientTable.name,
  redirectUris: oauthClientTable.redirectUris,
  scopes: oauthClientTable.scopes,
  public: oauthClientTable.public,
  disabled: oauthClientTable.disabled,
  createdAt: oauthClientTable.createdAt,
  updatedAt: oauthClientTable.updatedAt,
  metadata: oauthClientTable.metadata,
};

export async function listExternalOAuthApplications(organizationId: string) {
  const rows = await authDatabase.select(applicationSelection).from(oauthClientTable)
    .where(eq(oauthClientTable.referenceId, organizationId))
    .orderBy(desc(oauthClientTable.createdAt));
  return rows.map(applicationFromRow).filter((value): value is ExternalOAuthApplication => value !== null);
}

export async function createExternalOAuthApplication(input: {
  organizationId: string;
  createdByUserId: string;
  name: string;
  redirectUris: string[];
  scopes: OAuthScope[];
  resources?: OAuthResourceKind[];
  clientType: "public" | "confidential";
  offlineAccess?: boolean;
}) {
  await assertOrganizationMember(input.organizationId, input.createdByUserId);
  const name = input.name.trim();
  if (!name || name.length > 120) throw new OAuthApplicationAdministrationError("INVALID_INPUT", "Application name must be between 1 and 120 characters.", 400);
  const redirectUris = validateRedirectUris(input.redirectUris);
  const scopes = validateScopes(input.scopes);
  const resources = validateResources(input.resources ?? ["api"]);
  const clientId = randomSecret(24);
  const clientSecret = input.clientType === "confidential" ? randomSecret(36) : undefined;
  const storedScopes = ["openid", "profile", "email", ...scopes, ...(input.offlineAccess ? ["offline_access"] : [])];
  const storedSecret = clientSecret ? await hashOAuthSecret(clientSecret) : null;
  await authDatabase.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`content_automation_oauth_application_names:${input.organizationId}`}))`);
    const [existing] = await tx.select({ clientId: oauthClientTable.clientId }).from(oauthClientTable).where(and(
      eq(oauthClientTable.referenceId, input.organizationId),
      sql`lower(coalesce(${oauthClientTable.name}, '')) = lower(${name})`,
      sql`coalesce((${oauthClientTable.metadata} ->> 'managed_external_api')::boolean, false) = true`,
      sql`coalesce((${oauthClientTable.metadata} ->> 'service_principal')::boolean, false) = false`,
    )).limit(1);
    if (existing) {
      throw new OAuthApplicationAdministrationError("CONFLICT", "An OAuth application with this name already exists in this workspace. Choose a unique name and try again.", 409);
    }
    await tx.insert(oauthClientTable).values({
      id: crypto.randomUUID(),
      clientId,
      clientSecret: storedSecret,
      disabled: false,
      skipConsent: false,
      scopes: storedScopes,
      userId: input.createdByUserId,
      createdAt: sql`now()`,
      updatedAt: sql`now()`,
      name,
      redirectUris,
      tokenEndpointAuthMethod: input.clientType === "public" ? "none" : "client_secret_basic",
      grantTypes: ["authorization_code", ...(input.offlineAccess ? ["refresh_token"] : [])],
      responseTypes: ["code"],
      public: input.clientType === "public",
      type: "web",
      requirePKCE: true,
      referenceId: input.organizationId,
      metadata: {
        managed_external_api: true,
        allowed_resources: resources,
        created_by_user_id: input.createdByUserId,
      } satisfies ClientMetadata,
    });
  });
  return {
    clientId,
    clientSecret,
    clientType: input.clientType,
    redirectUris,
    scopes,
    resources,
    authorizationEndpoint: new URL("/api/auth/oauth2/authorize", OAUTH_AUTHORIZATION_ISSUER).toString(),
    tokenEndpoint: new URL("/api/auth/oauth2/token", OAUTH_AUTHORIZATION_ISSUER).toString(),
    resource: API_RESOURCE_URL,
  };
}

async function assertManagedClient(organizationId: string, clientId: string) {
  const [row] = await authDatabase.select({
    public: oauthClientTable.public,
    scopes: oauthClientTable.scopes,
    metadata: oauthClientTable.metadata,
  }).from(oauthClientTable).where(and(
    eq(oauthClientTable.clientId, clientId),
    eq(oauthClientTable.referenceId, organizationId),
  )).limit(1);
  const metadata = (row?.metadata ?? {}) as ClientMetadata;
  if (!row || metadata.managed_external_api !== true || metadata.service_principal) {
    throw new OAuthApplicationAdministrationError("NOT_FOUND", "OAuth application not found.", 404);
  }
  return row;
}

export async function updateExternalOAuthApplication(input: {
  organizationId: string;
  clientId: string;
  name?: string;
  redirectUris?: string[];
  scopes?: OAuthScope[];
  resources?: OAuthResourceKind[];
  offlineAccess?: boolean;
  disabled?: boolean;
}) {
  const current = await assertManagedClient(input.organizationId, input.clientId);
  const metadata = (current.metadata ?? {}) as ClientMetadata;
  const name = input.name?.trim();
  if (input.name !== undefined && (!name || name.length > 120)) throw new OAuthApplicationAdministrationError("INVALID_INPUT", "Application name must be between 1 and 120 characters.", 400);
  const scopes = input.scopes ? validateScopes(input.scopes) : undefined;
  const resources = input.resources ? validateResources(input.resources) : undefined;
  const currentScopes = Array.isArray(current.scopes) ? current.scopes.filter((value): value is string => typeof value === "string") : [];
  const currentPlatformScopes = currentScopes.filter((value): value is OAuthScope => PLATFORM_OAUTH_SCOPES.includes(value as OAuthScope));
  const shouldUpdateScopes = scopes !== undefined || input.offlineAccess !== undefined;
  const storedScopes = shouldUpdateScopes
    ? ["openid", "profile", "email", ...(scopes ?? currentPlatformScopes), ...((input.offlineAccess ?? currentScopes.includes("offline_access")) ? ["offline_access"] : [])]
    : undefined;
  await authDatabase.update(oauthClientTable).set({
    ...(name ? { name } : {}),
    ...(input.redirectUris ? { redirectUris: validateRedirectUris(input.redirectUris) } : {}),
    ...(storedScopes ? { scopes: storedScopes } : {}),
    ...(input.disabled !== undefined ? { disabled: input.disabled } : {}),
    ...(resources ? { metadata: { ...metadata, allowed_resources: resources } satisfies ClientMetadata } : {}),
    updatedAt: sql`now()`,
  }).where(and(
    eq(oauthClientTable.clientId, input.clientId),
    eq(oauthClientTable.referenceId, input.organizationId),
  ));
  return { clientId: input.clientId, updated: true };
}

export async function rotateExternalOAuthApplicationSecret(input: { organizationId: string; clientId: string }) {
  const current = await assertManagedClient(input.organizationId, input.clientId);
  if (current.public) throw new Error("Public PKCE applications do not have client secrets.");
  const clientSecret = randomSecret(36);
  await authDatabase.update(oauthClientTable).set({
    clientSecret: await hashOAuthSecret(clientSecret),
    updatedAt: sql`now()`,
  }).where(and(
    eq(oauthClientTable.clientId, input.clientId),
    eq(oauthClientTable.referenceId, input.organizationId),
  ));
  return { clientId: input.clientId, clientSecret };
}

export async function deleteExternalOAuthApplication(input: { organizationId: string; clientId: string }) {
  await assertManagedClient(input.organizationId, input.clientId);
  await authDatabase.delete(oauthClientTable).where(and(
    eq(oauthClientTable.clientId, input.clientId),
    eq(oauthClientTable.referenceId, input.organizationId),
  ));
  return { deleted: true };
}
