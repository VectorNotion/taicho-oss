import {
  mcp_service_principal as servicePrincipalTable,
  member as memberTable,
  oauthClient as oauthClientTable,
  team as teamTable,
  team_administrator as teamAdministratorTable,
  teamMember as teamMemberTable,
  user as userTable,
} from "@content-automation/database";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { authDatabase } from "./database";
import {
  API_RESOURCE_URL,
  MCP_RESOURCE_URL,
  OAUTH_AUTHORIZATION_ISSUER,
  PLATFORM_OAUTH_SCOPES,
  type McpScope,
  type OAuthResourceKind,
  type OAuthScope,
} from "./server";
import { roleDefinitions, type RoleName } from "./permissions";

const servicePrincipalRoles = new Set<RoleName>([
  "admin",
  "member",
  "outreach_manager",
  "outreach_operator",
  "content_manager",
  "content_editor",
  "viewer",
]);

type MemberRow = {
  id: string;
  userId: string;
  role: string;
  createdAt: Date;
  name: string;
  email: string;
  image: string | null;
};

type TeamRow = { id: string; name: string; createdAt: Date };

function randomSecret(bytes = 36) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return Buffer.from(value).toString("base64url");
}

async function hashOAuthSecret(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("base64url");
}

function assertRole(role: string): asserts role is RoleName {
  if (!roleDefinitions.some((definition) => definition.id === role)) throw new Error("Unknown organization role.");
}

function assertServicePrincipalRole(role: string): asserts role is RoleName {
  assertRole(role);
  if (!servicePrincipalRoles.has(role)) throw new Error("This role cannot be assigned to an MCP service principal.");
}

function validateServiceScopes(scopes: readonly string[]): OAuthScope[] {
  const supported = new Set<string>(PLATFORM_OAUTH_SCOPES);
  const unique = [...new Set(scopes)];
  if (unique.length === 0 || unique.some((scope) => !supported.has(scope))) throw new Error("One or more OAuth scopes are unsupported.");
  if (unique.includes("vn:commercial:operator")) throw new Error("Platform-operator scope cannot be delegated to an organization service principal.");
  return unique as OAuthScope[];
}

function validateResources(resources: readonly OAuthResourceKind[]): OAuthResourceKind[] {
  const unique = [...new Set(resources)];
  if (unique.length === 0 || unique.some((resource) => resource !== "api" && resource !== "mcp")) {
    throw new Error("At least one supported OAuth resource is required.");
  }
  return unique;
}

function resourceUrls(resources: readonly OAuthResourceKind[]) {
  return resources.map((resource) => resource === "api" ? API_RESOURCE_URL : MCP_RESOURCE_URL);
}

async function assertOrganizationMember(organizationId: string, userId: string) {
  const [member] = await authDatabase.select({ id: memberTable.id }).from(memberTable).where(and(
    eq(memberTable.organizationId, organizationId),
    eq(memberTable.userId, userId),
  )).limit(1);
  if (!member) throw new Error("Organization member not found.");
}

export async function getMcpOrganizationAdministration(organizationId: string) {
  const [members, teams, memberships, administrators, servicePrincipals] = await Promise.all([
    authDatabase.select({
      id: memberTable.id, userId: memberTable.userId, role: memberTable.role,
      createdAt: memberTable.createdAt, name: userTable.name, email: userTable.email,
      image: userTable.image,
    }).from(memberTable).innerJoin(userTable, eq(userTable.id, memberTable.userId))
      .where(eq(memberTable.organizationId, organizationId))
      .orderBy(asc(userTable.name), asc(userTable.email)),
    authDatabase.select({ id: teamTable.id, name: teamTable.name, createdAt: teamTable.createdAt })
      .from(teamTable).where(eq(teamTable.organizationId, organizationId)).orderBy(asc(teamTable.name)),
    authDatabase.select({ teamId: teamMemberTable.teamId, userId: teamMemberTable.userId })
      .from(teamMemberTable).innerJoin(teamTable, eq(teamTable.id, teamMemberTable.teamId))
      .where(eq(teamTable.organizationId, organizationId)),
    authDatabase.select({ teamId: teamAdministratorTable.team_id, memberId: teamAdministratorTable.member_id })
      .from(teamAdministratorTable).innerJoin(teamTable, eq(teamTable.id, teamAdministratorTable.team_id))
      .where(eq(teamTable.organizationId, organizationId)),
    authDatabase.select({
      clientId: servicePrincipalTable.oauth_client_id,
      name: oauthClientTable.name,
      billingUserId: servicePrincipalTable.billing_user_id,
      billingEmail: userTable.email,
      role: servicePrincipalTable.role,
      allowedScopes: servicePrincipalTable.allowed_scopes,
      allowedResources: servicePrincipalTable.allowed_resources,
      enabled: servicePrincipalTable.enabled,
      createdAt: servicePrincipalTable.created_at,
      updatedAt: servicePrincipalTable.updated_at,
    }).from(servicePrincipalTable)
      .innerJoin(userTable, eq(userTable.id, servicePrincipalTable.billing_user_id))
      .leftJoin(oauthClientTable, eq(oauthClientTable.clientId, servicePrincipalTable.oauth_client_id))
      .where(eq(servicePrincipalTable.organization_id, organizationId))
      .orderBy(desc(servicePrincipalTable.created_at)),
  ]);

  return {
    roles: roleDefinitions,
    members: (members as unknown as MemberRow[]).map((member) => ({
      ...member,
      teamIds: memberships.filter((row) => row.userId === member.userId).map((row) => row.teamId),
      administeredTeamIds: administrators.filter((row) => row.memberId === member.id).map((row) => row.teamId),
    })),
    teams: teams as unknown as TeamRow[],
    servicePrincipals,
  };
}

export async function getMcpActorEmail(userId: string) {
  const [user] = await authDatabase.select({ email: userTable.email }).from(userTable)
    .where(eq(userTable.id, userId)).limit(1);
  return user?.email ?? null;
}

export async function addMcpOrganizationMember(input: { organizationId: string; email: string; role: RoleName }) {
  assertRole(input.role);
  if (input.role === "owner" || input.role === "team_admin") throw new Error("That role cannot be assigned while adding a member.");
  const [user] = await authDatabase.select({ id: userTable.id }).from(userTable)
    .where(sql`lower(${userTable.email}) = lower(${input.email})`).limit(1);
  if (!user) throw new Error("No account exists for that email. The user must create an account first.");
  const [created] = await authDatabase.insert(memberTable).values({
    id: crypto.randomUUID(), organizationId: input.organizationId, userId: user.id,
    role: input.role, createdAt: sql`now()`,
  }).onConflictDoNothing().returning({ id: memberTable.id });
  if (!created) throw new Error("This user is already an organization member.");
  return { memberId: created.id, userId: user.id };
}

export async function updateMcpOrganizationMemberRole(input: { organizationId: string; memberId: string; role: RoleName }) {
  assertRole(input.role);
  if (input.role === "owner" || input.role === "team_admin") throw new Error("That role cannot be assigned through this operation.");
  const [target] = await authDatabase.select({ role: memberTable.role }).from(memberTable).where(and(
    eq(memberTable.id, input.memberId), eq(memberTable.organizationId, input.organizationId),
  )).limit(1);
  if (!target) throw new Error("Organization member not found.");
  if (target.role.split(",").includes("owner")) throw new Error("The owner role cannot be changed.");
  const [teamAdmin] = await authDatabase.select({ memberId: teamAdministratorTable.member_id })
    .from(teamAdministratorTable).where(eq(teamAdministratorTable.member_id, input.memberId)).limit(1);
  const role = teamAdmin ? `${input.role},team_admin` : input.role;
  await authDatabase.update(memberTable).set({ role }).where(and(
    eq(memberTable.id, input.memberId), eq(memberTable.organizationId, input.organizationId),
  ));
  return { memberId: input.memberId, role };
}

export async function removeMcpOrganizationMember(input: { organizationId: string; memberId: string }) {
  const [target] = await authDatabase.select({ role: memberTable.role }).from(memberTable).where(and(
    eq(memberTable.id, input.memberId), eq(memberTable.organizationId, input.organizationId),
  )).limit(1);
  if (!target) throw new Error("Organization member not found.");
  if (target.role.split(",").includes("owner")) throw new Error("The organization owner cannot be removed.");
  await authDatabase.delete(memberTable).where(and(
    eq(memberTable.id, input.memberId), eq(memberTable.organizationId, input.organizationId),
  ));
  return { deleted: true };
}

export async function createMcpOrganizationTeam(input: { organizationId: string; name: string }) {
  const [created] = await authDatabase.insert(teamTable).values({
    id: crypto.randomUUID(), name: input.name, organizationId: input.organizationId,
    createdAt: sql`now()`, updatedAt: sql`now()`,
  }).returning({ id: teamTable.id, name: teamTable.name, createdAt: teamTable.createdAt });
  return { ...created, createdAt: new Date(created.createdAt) };
}

export async function removeMcpOrganizationTeam(input: { organizationId: string; teamId: string }) {
  const [deleted] = await authDatabase.delete(teamTable).where(and(
    eq(teamTable.id, input.teamId), eq(teamTable.organizationId, input.organizationId),
  )).returning({ id: teamTable.id });
  if (!deleted) throw new Error("Organization team not found.");
  return { deleted: true };
}

export async function setMcpTeamMembership(input: { organizationId: string; teamId: string; userId: string; enabled: boolean }) {
  const [team] = await authDatabase.select({ id: teamTable.id }).from(teamTable).where(and(
    eq(teamTable.id, input.teamId), eq(teamTable.organizationId, input.organizationId),
  )).limit(1);
  if (!team) throw new Error("Organization team not found.");
  await assertOrganizationMember(input.organizationId, input.userId);
  if (input.enabled) {
    await authDatabase.insert(teamMemberTable).values({
      id: crypto.randomUUID(), teamId: input.teamId, userId: input.userId, createdAt: sql`now()`,
    }).onConflictDoNothing();
  } else {
    await authDatabase.delete(teamMemberTable).where(and(
      eq(teamMemberTable.teamId, input.teamId), eq(teamMemberTable.userId, input.userId),
    ));
  }
  return { enabled: input.enabled };
}

export async function setMcpTeamAdministrator(input: { organizationId: string; teamId: string; memberId: string; enabled: boolean }) {
  const [member] = await authDatabase.select({ userId: memberTable.userId, role: memberTable.role })
    .from(memberTable).where(and(
      eq(memberTable.id, input.memberId), eq(memberTable.organizationId, input.organizationId),
    )).limit(1);
  if (!member) throw new Error("Organization member not found.");
  const [team] = await authDatabase.select({ id: teamTable.id }).from(teamTable).where(and(
    eq(teamTable.id, input.teamId), eq(teamTable.organizationId, input.organizationId),
  )).limit(1);
  if (!team) throw new Error("Organization team not found.");
  if (input.enabled) {
    await authDatabase.insert(teamAdministratorTable).values({
      team_id: input.teamId, member_id: input.memberId,
    }).onConflictDoNothing();
    await setMcpTeamMembership({ organizationId: input.organizationId, teamId: input.teamId, userId: member.userId, enabled: true });
    if (!member.role.split(",").includes("team_admin")) {
      await authDatabase.update(memberTable).set({ role: `${member.role},team_admin` })
        .where(eq(memberTable.id, input.memberId));
    }
  } else {
    await authDatabase.delete(teamAdministratorTable).where(and(
      eq(teamAdministratorTable.team_id, input.teamId),
      eq(teamAdministratorTable.member_id, input.memberId),
    ));
    const [remaining] = await authDatabase.select({ memberId: teamAdministratorTable.member_id })
      .from(teamAdministratorTable).where(eq(teamAdministratorTable.member_id, input.memberId)).limit(1);
    if (!remaining) {
      const role = member.role.split(",").filter((value) => value !== "team_admin").join(",") || "member";
      await authDatabase.update(memberTable).set({ role }).where(eq(memberTable.id, input.memberId));
    }
  }
  return { enabled: input.enabled };
}

export async function createExternalServicePrincipal(input: {
  organizationId: string;
  name: string;
  billingUserId: string;
  role: RoleName;
  allowedScopes: OAuthScope[];
  allowedResources: OAuthResourceKind[];
  createdByUserId: string;
}) {
  assertServicePrincipalRole(input.role);
  const allowedScopes = validateServiceScopes(input.allowedScopes);
  const allowedResources = validateResources(input.allowedResources);
  await assertOrganizationMember(input.organizationId, input.billingUserId);
  await assertOrganizationMember(input.organizationId, input.createdByUserId);

  const clientId = randomSecret(24);
  const clientSecret = randomSecret(36);
  const storedSecret = await hashOAuthSecret(clientSecret);
  await authDatabase.transaction(async (tx) => {
    await tx.insert(oauthClientTable).values({
      id: crypto.randomUUID(),
      clientId,
      clientSecret: storedSecret,
      disabled: false,
      skipConsent: true,
      scopes: allowedScopes,
      createdAt: sql`now()`,
      updatedAt: sql`now()`,
      name: input.name,
      redirectUris: resourceUrls(allowedResources),
      tokenEndpointAuthMethod: "client_secret_basic",
      grantTypes: ["client_credentials"],
      responseTypes: [],
      public: false,
      type: "web",
      requirePKCE: false,
      referenceId: input.organizationId,
      metadata: {
        service_principal: true,
        mcp_service_principal: allowedResources.includes("mcp"),
        organization_id: input.organizationId,
        allowed_resources: allowedResources,
      },
    });
    await tx.insert(servicePrincipalTable).values({
      oauth_client_id: clientId,
      organization_id: input.organizationId,
      billing_user_id: input.billingUserId,
      role: input.role,
      allowed_scopes: allowedScopes,
      allowed_resources: allowedResources,
      created_by_user_id: input.createdByUserId,
    });
  });
  return {
    clientId,
    clientSecret,
    tokenEndpointAuthMethod: "client_secret_basic" as const,
    grantType: "client_credentials" as const,
    tokenEndpoint: new URL("/api/auth/oauth2/token", OAUTH_AUTHORIZATION_ISSUER).toString(),
    scopes: allowedScopes,
    resources: allowedResources,
  };
}

export async function createMcpServicePrincipal(input: {
  organizationId: string;
  name: string;
  billingUserId: string;
  role: RoleName;
  allowedScopes: McpScope[];
  createdByUserId: string;
}) {
  return createExternalServicePrincipal({ ...input, allowedResources: ["mcp"] });
}

export async function updateExternalServicePrincipal(input: {
  organizationId: string;
  clientId: string;
  role?: RoleName;
  allowedScopes?: OAuthScope[];
  allowedResources?: OAuthResourceKind[];
  billingUserId?: string;
  enabled?: boolean;
}) {
  if (input.role) assertServicePrincipalRole(input.role);
  const allowedScopes = input.allowedScopes ? validateServiceScopes(input.allowedScopes) : undefined;
  const allowedResources = input.allowedResources ? validateResources(input.allowedResources) : undefined;
  if (input.billingUserId) await assertOrganizationMember(input.organizationId, input.billingUserId);
  return authDatabase.transaction(async (tx) => {
    const [current] = await tx.select({
      role: servicePrincipalTable.role,
      allowedScopes: servicePrincipalTable.allowed_scopes,
      allowedResources: servicePrincipalTable.allowed_resources,
      billingUserId: servicePrincipalTable.billing_user_id,
      enabled: servicePrincipalTable.enabled,
    }).from(servicePrincipalTable).where(and(
      eq(servicePrincipalTable.oauth_client_id, input.clientId),
      eq(servicePrincipalTable.organization_id, input.organizationId),
    )).limit(1).for("update");
    if (!current) throw new Error("OAuth service principal not found.");
    const nextScopes = allowedScopes ?? current.allowedScopes as OAuthScope[];
    const nextResources = allowedResources ?? current.allowedResources as OAuthResourceKind[];
    const nextEnabled = input.enabled ?? current.enabled;
    const nextRole = input.role ?? current.role as RoleName;
    await tx.update(servicePrincipalTable).set({
      role: nextRole,
      allowed_scopes: nextScopes,
      allowed_resources: nextResources,
      billing_user_id: input.billingUserId ?? current.billingUserId,
      enabled: nextEnabled,
      updated_at: sql`now()`,
    }).where(and(
      eq(servicePrincipalTable.oauth_client_id, input.clientId),
      eq(servicePrincipalTable.organization_id, input.organizationId),
    ));
    await tx.update(oauthClientTable).set({
      scopes: nextScopes,
      disabled: !nextEnabled,
      updatedAt: sql`now()`,
      redirectUris: resourceUrls(nextResources),
      metadata: {
        service_principal: true,
        mcp_service_principal: nextResources.includes("mcp"),
        organization_id: input.organizationId,
        allowed_resources: nextResources,
      },
    }).where(and(
      eq(oauthClientTable.clientId, input.clientId),
      eq(oauthClientTable.referenceId, input.organizationId),
    ));
    return {
      clientId: input.clientId,
      role: nextRole,
      allowedScopes: nextScopes,
      allowedResources: nextResources,
      enabled: nextEnabled,
    };
  });
}

export async function updateMcpServicePrincipal(input: {
  organizationId: string;
  clientId: string;
  role?: RoleName;
  allowedScopes?: McpScope[];
  billingUserId?: string;
  enabled?: boolean;
}) {
  return updateExternalServicePrincipal(input);
}

export async function rotateExternalServicePrincipalSecret(input: { organizationId: string; clientId: string }) {
  const clientSecret = randomSecret(36);
  const storedSecret = await hashOAuthSecret(clientSecret);
  const rotated = await authDatabase.transaction(async (tx) => {
    const [principal] = await tx.select({ clientId: servicePrincipalTable.oauth_client_id })
      .from(servicePrincipalTable).where(and(
        eq(servicePrincipalTable.oauth_client_id, input.clientId),
        eq(servicePrincipalTable.organization_id, input.organizationId),
      )).limit(1).for("update");
    if (!principal) return false;
    const [client] = await tx.update(oauthClientTable).set({
      clientSecret: storedSecret,
      updatedAt: sql`now()`,
    }).where(and(
      eq(oauthClientTable.clientId, input.clientId),
      eq(oauthClientTable.referenceId, input.organizationId),
    )).returning({ clientId: oauthClientTable.clientId });
    return Boolean(client);
  });
  if (!rotated) throw new Error("OAuth service principal not found.");
  return { clientId: input.clientId, clientSecret };
}

export const rotateMcpServicePrincipalSecret = rotateExternalServicePrincipalSecret;

export async function deleteExternalServicePrincipal(input: { organizationId: string; clientId: string }) {
  const [deleted] = await authDatabase.delete(oauthClientTable).where(and(
    eq(oauthClientTable.clientId, input.clientId),
    eq(oauthClientTable.referenceId, input.organizationId),
    sql`coalesce((${oauthClientTable.metadata} ->> 'service_principal')::boolean, (${oauthClientTable.metadata} ->> 'mcp_service_principal')::boolean, false) = true`,
  )).returning({ clientId: oauthClientTable.clientId });
  if (!deleted) throw new Error("OAuth service principal not found.");
  return { deleted: true };
}
