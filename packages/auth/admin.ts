import {
  member as memberTable,
  team as teamTable,
  team_administrator as teamAdministratorTable,
  teamMember as teamMemberTable,
  user as userTable,
} from "@content-automation/database";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { authDatabase } from "./database";
import { canManageOrganization, hasAnyRole, roleDefinitions, roles, type RoleName } from "./permissions";
import { auth, getAuthorizationContext } from "./server";

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
type TeamMembershipRow = { teamId: string; userId: string };
type TeamAdminRow = { teamId: string; memberId: string };

const assignableRoles = roleDefinitions.map((role) => role.id).filter((role) => role !== "owner" && role !== "team_admin");

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_member"), email: z.string().email(), role: z.enum(assignableRoles as [RoleName, ...RoleName[]]) }),
  z.object({ action: z.literal("update_role"), memberId: z.string().min(1), role: z.enum(assignableRoles as [RoleName, ...RoleName[]]) }),
  z.object({ action: z.literal("remove_member"), memberId: z.string().min(1) }),
  z.object({ action: z.literal("create_team"), name: z.string().trim().min(2).max(80) }),
  z.object({ action: z.literal("remove_team"), teamId: z.string().min(1) }),
  z.object({ action: z.literal("add_team_member"), teamId: z.string().min(1), userId: z.string().min(1) }),
  z.object({ action: z.literal("remove_team_member"), teamId: z.string().min(1), userId: z.string().min(1) }),
  z.object({ action: z.literal("set_team_admin"), teamId: z.string().min(1), memberId: z.string().min(1), enabled: z.boolean() }),
]);

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

async function adminContext(headers: Headers) {
  const context = await getAuthorizationContext(headers);
  if (!context) return { error: json({ error: "Unauthenticated" }, 401), context: null };
  const organizationAdmin = canManageOrganization(context.role);
  const teamAdmin = hasAnyRole(context.role, ["team_admin"]);
  if (!organizationAdmin && !teamAdmin) return { error: json({ error: "Forbidden" }, 403), context: null };

  const assigned = teamAdmin
    ? await authDatabase
        .select({ teamId: teamAdministratorTable.team_id })
        .from(teamAdministratorTable)
        .innerJoin(memberTable, eq(memberTable.id, teamAdministratorTable.member_id))
        .where(and(
          eq(memberTable.userId, context.session.user.id),
          eq(memberTable.organizationId, context.organizationId),
        ))
    : [];
  return { error: null, context, organizationAdmin, assignedTeamIds: assigned.map((row) => row.teamId) };
}

async function overview(headers: Headers) {
  const access = await adminContext(headers);
  if (access.error || !access.context) return access.error;
  const { context, organizationAdmin, assignedTeamIds } = access;

  const [memberRows, teamRows, membershipRows, adminRows] = await Promise.all([
    authDatabase
      .select({
        id: memberTable.id,
        userId: memberTable.userId,
        role: memberTable.role,
        createdAt: memberTable.createdAt,
        name: userTable.name,
        email: userTable.email,
        image: userTable.image,
      })
      .from(memberTable)
      .innerJoin(userTable, eq(userTable.id, memberTable.userId))
      .where(eq(memberTable.organizationId, context.organizationId))
      .orderBy(asc(userTable.name)),
    authDatabase
      .select({ id: teamTable.id, name: teamTable.name, createdAt: teamTable.createdAt })
      .from(teamTable)
      .where(eq(teamTable.organizationId, context.organizationId))
      .orderBy(asc(teamTable.name)),
    authDatabase
      .select({ teamId: teamMemberTable.teamId, userId: teamMemberTable.userId })
      .from(teamMemberTable)
      .innerJoin(teamTable, eq(teamTable.id, teamMemberTable.teamId))
      .where(eq(teamTable.organizationId, context.organizationId)),
    authDatabase
      .select({ teamId: teamAdministratorTable.team_id, memberId: teamAdministratorTable.member_id })
      .from(teamAdministratorTable)
      .innerJoin(teamTable, eq(teamTable.id, teamAdministratorTable.team_id))
      .where(eq(teamTable.organizationId, context.organizationId)),
  ]);

  const membersResult = memberRows.map((row) => ({ ...row, createdAt: new Date(row.createdAt) })) as MemberRow[];
  const teamsResult = teamRows.map((row) => ({ ...row, createdAt: new Date(row.createdAt) })) as TeamRow[];
  const membershipResult = membershipRows as TeamMembershipRow[];
  const adminResult = adminRows as TeamAdminRow[];
  const visibleTeamIds = organizationAdmin ? teamsResult.map((team) => team.id) : assignedTeamIds;
  const visibleMemberships = membershipResult.filter((membership) => visibleTeamIds.includes(membership.teamId));
  const visibleUserIds = new Set(visibleMemberships.map((membership) => membership.userId));
  if (!organizationAdmin) visibleUserIds.add(context.session.user.id);
  const members = membersResult
    .filter((member) => organizationAdmin || visibleUserIds.has(member.userId))
    .map((member) => ({
      ...member,
      teams: visibleMemberships.filter((membership) => membership.userId === member.userId).map((membership) => membership.teamId),
      administeredTeams: adminResult.filter((admin) => admin.memberId === member.id).map((admin) => admin.teamId),
    }));

  return json({
    organization: { id: context.organizationId, name: context.organizationName },
    currentUser: { id: context.session.user.id, role: context.role },
    access: { organizationAdmin, assignedTeamIds },
    roles: roleDefinitions,
    assignableRoles,
    members,
    teams: teamsResult.filter((team) => visibleTeamIds.includes(team.id)),
  });
}

async function assertTeamScope(organizationId: string, teamId: string, organizationAdmin: boolean, assignedTeamIds: string[]) {
  const [team] = await authDatabase
    .select({ id: teamTable.id })
    .from(teamTable)
    .where(and(eq(teamTable.id, teamId), eq(teamTable.organizationId, organizationId)))
    .limit(1);
  if (!team) throw new Error("Team not found");
  if (!organizationAdmin && !assignedTeamIds.includes(teamId)) throw new Error("Team access denied");
}

async function mutate(request: Request) {
  const access = await adminContext(request.headers);
  if (access.error || !access.context) return access.error;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid administration request", issues: parsed.error.issues }, 400);

  const { context, organizationAdmin, assignedTeamIds } = access;
  const action = parsed.data;
  try {
    switch (action.action) {
      case "add_member": { // Existing accounts can be attached without issuing insecure temporary credentials.
        if (!organizationAdmin) return json({ error: "Only organization administrators can add users" }, 403);
        const [user] = await authDatabase.select({ id: userTable.id }).from(userTable)
          .where(sql`lower(${userTable.email}) = lower(${action.email})`).limit(1);
        if (!user) return json({ error: "No account exists for that email. Ask the user to create an account first." }, 404);
        const [existing] = await authDatabase.select({ id: memberTable.id }).from(memberTable).where(and(
          eq(memberTable.organizationId, context.organizationId), eq(memberTable.userId, user.id),
        )).limit(1);
        if (existing) return json({ error: "This user is already a member" }, 409);
        await auth.api.addMember({ body: { userId: user.id, role: action.role, organizationId: context.organizationId } });
        break;
      }
      case "update_role": {
        if (!organizationAdmin) return json({ error: "Only organization administrators can change roles" }, 403);
        const [target] = await authDatabase.select({ role: memberTable.role }).from(memberTable).where(and(
          eq(memberTable.id, action.memberId), eq(memberTable.organizationId, context.organizationId),
        )).limit(1);
        if (!target) return json({ error: "Member not found" }, 404);
        if (hasAnyRole(target.role, ["owner"])) return json({ error: "The owner role cannot be changed here" }, 403);
        const [teamAdminAssignment] = await authDatabase.select({ memberId: teamAdministratorTable.member_id })
          .from(teamAdministratorTable).where(eq(teamAdministratorTable.member_id, action.memberId)).limit(1);
        const role = teamAdminAssignment ? `${action.role},team_admin` : action.role;
        await auth.api.updateMemberRole({ headers: request.headers, body: { memberId: action.memberId, role, organizationId: context.organizationId } });
        break;
      }
      case "remove_member": {
        if (!organizationAdmin) return json({ error: "Only organization administrators can remove users" }, 403);
        const [target] = await authDatabase.select({ role: memberTable.role }).from(memberTable).where(and(
          eq(memberTable.id, action.memberId), eq(memberTable.organizationId, context.organizationId),
        )).limit(1);
        if (!target) return json({ error: "Member not found" }, 404);
        if (hasAnyRole(target.role, ["owner"])) return json({ error: "The organization owner cannot be removed" }, 403);
        await auth.api.removeMember({ headers: request.headers, body: { memberIdOrEmail: action.memberId, organizationId: context.organizationId } });
        break;
      }
      case "create_team":
        if (!organizationAdmin) return json({ error: "Only organization administrators can create teams" }, 403);
        await auth.api.createTeam({ headers: request.headers, body: { name: action.name, organizationId: context.organizationId } });
        break;
      case "remove_team":
        if (!organizationAdmin) return json({ error: "Only organization administrators can remove teams" }, 403);
        await auth.api.removeTeam({ headers: request.headers, body: { teamId: action.teamId, organizationId: context.organizationId } });
        break;
      case "add_team_member":
        await assertTeamScope(context.organizationId, action.teamId, organizationAdmin, assignedTeamIds);
        {
          const [organizationMember] = await authDatabase
            .select({ userId: memberTable.userId })
            .from(memberTable)
            .where(and(
              eq(memberTable.userId, action.userId),
              eq(memberTable.organizationId, context.organizationId),
            ))
            .limit(1);
          if (organizationMember) {
            await authDatabase.insert(teamMemberTable).values({
              id: crypto.randomUUID(),
              teamId: action.teamId,
              userId: organizationMember.userId,
              createdAt: sql`now()`,
            }).onConflictDoNothing();
          }
        }
        break;
      case "remove_team_member":
        await assertTeamScope(context.organizationId, action.teamId, organizationAdmin, assignedTeamIds);
        await authDatabase.delete(teamMemberTable).where(and(
          eq(teamMemberTable.teamId, action.teamId), eq(teamMemberTable.userId, action.userId),
        ));
        break;
      case "set_team_admin": {
        if (!organizationAdmin) return json({ error: "Only organization administrators can assign team administrators" }, 403);
        const [member] = await authDatabase.select({ userId: memberTable.userId, role: memberTable.role })
          .from(memberTable).where(and(
            eq(memberTable.id, action.memberId), eq(memberTable.organizationId, context.organizationId),
          )).limit(1);
        if (!member) return json({ error: "Member not found" }, 404);
        await assertTeamScope(context.organizationId, action.teamId, true, []);
        if (action.enabled) {
          await authDatabase.insert(teamAdministratorTable).values({
            team_id: action.teamId, member_id: action.memberId,
          }).onConflictDoNothing();
          await authDatabase.insert(teamMemberTable).values({
            id: crypto.randomUUID(), teamId: action.teamId, userId: member.userId,
            createdAt: sql`now()`,
          }).onConflictDoNothing();
          if (!hasAnyRole(member.role, ["team_admin"])) {
            await authDatabase.update(memberTable).set({ role: `${member.role},team_admin` })
              .where(eq(memberTable.id, action.memberId));
          }
        } else {
          await authDatabase.delete(teamAdministratorTable).where(and(
            eq(teamAdministratorTable.team_id, action.teamId),
            eq(teamAdministratorTable.member_id, action.memberId),
          ));
          const [remaining] = await authDatabase.select({ memberId: teamAdministratorTable.member_id })
            .from(teamAdministratorTable).where(eq(teamAdministratorTable.member_id, action.memberId)).limit(1);
          if (!remaining) {
            const nextRole = member.role.split(",").filter((role) => role !== "team_admin").join(",") || "member";
            await authDatabase.update(memberTable).set({ role: nextRole }).where(eq(memberTable.id, action.memberId));
          }
        }
        break;
      }
    }
    return json({ ok: true });
  } catch (cause) {
    return json({ error: cause instanceof Error ? cause.message : "Administration operation failed" }, 400);
  }
}

export async function handleAdminRequest(request: Request) {
  return request.method === "GET" ? overview(request.headers) : mutate(request);
}
