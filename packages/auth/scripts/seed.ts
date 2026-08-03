import {
  account,
  member,
  organization as organizationTable,
  organization_entitlement as organizationEntitlement,
  team,
  team_administrator as teamAdministrator,
  teamMember,
  user as userTable,
} from "@content-automation/database";
import { and, eq, sql } from "drizzle-orm";
import { auth, provisionOrganizationEntitlements } from "../server";
import { authDatabase, authPool, ensureAuthorizationSchema } from "../database";
import type { RoleName } from "../permissions";

if (process.env.NODE_ENV === "production") {
  throw new Error("The deterministic RBAC seed is forbidden in production.");
}

const password = process.env.AUTH_SEED_PASSWORD ?? "ContentAutomation123!";
const users: Array<{ name: string; email: string; role: RoleName }> = [
  { name: "Workspace Owner", email: "owner@local.test", role: "owner" },
  { name: "Outreach Operator", email: "outreach@local.test", role: "outreach_operator" },
  { name: "Content Editor", email: "content@local.test", role: "content_editor" },
  { name: "Read Only", email: "viewer@local.test", role: "viewer" },
  { name: "Growth Team Admin", email: "teamadmin@local.test", role: "team_admin" },
];
const boundaryUsers = [
  {
    name: "Expired Plan Owner",
    email: "expired@local.test",
    slug: "expired-workspace",
    workspace: "Expired Workspace",
    products: ["outreach", "content", "cascade"] as const,
  },
  {
    name: "Exhausted Credits Owner",
    email: "exhausted@local.test",
    slug: "exhausted-workspace",
    workspace: "Exhausted Workspace",
    products: ["outreach", "content", "cascade"] as const,
  },
  {
    name: "Content Only Owner",
    email: "unentitled@local.test",
    slug: "content-only-workspace",
    workspace: "Content Only Workspace",
    products: ["content"] as const,
  },
];

async function userId(user: { name: string; email: string }) {
  const [existing] = await authDatabase
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, user.email))
    .limit(1);
  if (existing) {
    const ctx = await auth.$context;
    await authDatabase
      .update(account)
      .set({ password: await ctx.password.hash(password), updatedAt: sql`now()` })
      .where(and(eq(account.userId, existing.id), eq(account.providerId, "credential")));
    return existing.id;
  }
  const created = await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password } });
  return created.user.id;
}

const ownerId = await userId(users[0]);
const ownerWorkspaceName = "Owner's Workspace";
const [existingOrg] = await authDatabase
  .select({ id: organizationTable.id })
  .from(organizationTable)
  .where(eq(organizationTable.slug, "local-workspace"))
  .limit(1);
const organization = existingOrg ?? await auth.api.createOrganization({ body: { name: ownerWorkspaceName, slug: "local-workspace", userId: ownerId } });
await authDatabase.update(organizationTable).set({ name: ownerWorkspaceName }).where(eq(organizationTable.id, organization.id));

for (const user of users) {
  const id = await userId(user);
  const updated = await authDatabase
    .update(member)
    .set({ role: user.role })
    .where(and(eq(member.organizationId, organization.id), eq(member.userId, id)))
    .returning({ id: member.id });
  if (updated.length === 0) {
    await authDatabase.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: organization.id,
      userId: id,
      role: user.role,
      createdAt: sql`now()`,
    });
  }
}

await provisionOrganizationEntitlements(organization.id, ["outreach", "content", "cascade"]);
await ensureAuthorizationSchema();

for (const fixture of boundaryUsers) {
  const id = await userId(fixture);
  const [existing] = await authDatabase
    .select({ id: organizationTable.id })
    .from(organizationTable)
    .where(eq(organizationTable.slug, fixture.slug))
    .limit(1);
  const fixtureOrganization =
    existing ??
    (await auth.api.createOrganization({
      body: {
        name: fixture.workspace,
        slug: fixture.slug,
        userId: id,
      },
    }));
  const membership = await authDatabase
    .update(member)
    .set({ role: "owner" })
    .where(and(eq(member.organizationId, fixtureOrganization.id), eq(member.userId, id)))
    .returning({ id: member.id });
  if (membership.length === 0) {
    await authDatabase.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: fixtureOrganization.id,
      userId: id,
      role: "owner",
      createdAt: sql`now()`,
    });
  }
  await authDatabase
    .update(organizationEntitlement)
    .set({ enabled: false, updated_at: sql`now()` })
    .where(eq(organizationEntitlement.organization_id, fixtureOrganization.id));
  await provisionOrganizationEntitlements(
    fixtureOrganization.id,
    [...fixture.products],
  );
}

async function ensureTeam(name: string) {
  const [existing] = await authDatabase
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.organizationId, organization.id), eq(team.name, name)))
    .limit(1);
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await authDatabase.insert(team).values({
    id,
    name,
    organizationId: organization.id,
    createdAt: sql`now()`,
    updatedAt: sql`now()`,
  });
  return id;
}

async function ensureTeamMember(teamId: string, userId: string) {
  await authDatabase
    .insert(teamMember)
    .values({ id: crypto.randomUUID(), teamId, userId, createdAt: sql`now()` })
    .onConflictDoNothing({ target: [teamMember.teamId, teamMember.userId] });
}

const growthTeamId = await ensureTeam("Growth");
const editorialTeamId = await ensureTeam("Editorial");
const outreachId = await userId(users[1]);
const contentId = await userId(users[2]);
const teamAdminId = await userId(users[4]);
await ensureTeamMember(growthTeamId, outreachId);
await ensureTeamMember(growthTeamId, teamAdminId);
await ensureTeamMember(editorialTeamId, contentId);

const [teamAdminMember] = await authDatabase
  .select({ id: member.id })
  .from(member)
  .where(and(eq(member.organizationId, organization.id), eq(member.userId, teamAdminId)))
  .limit(1);
if (!teamAdminMember) throw new Error("Team administrator membership was not created.");
await authDatabase
  .insert(teamAdministrator)
  .values({ team_id: growthTeamId, member_id: teamAdminMember.id })
  .onConflictDoNothing({ target: [teamAdministrator.team_id, teamAdministrator.member_id] });
await authPool.end();
console.log("Seeded local RBAC and entitlement-boundary users.");
