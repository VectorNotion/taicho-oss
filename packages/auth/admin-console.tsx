"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import {
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { ListRow, ListRows } from "@content-automation/ui/components/ListRow";
import {
  FilterSelect,
  ListSurface,
} from "@content-automation/ui/components/ListSurface";
import { PageHeader } from "@content-automation/ui/components/PageHeader";
import { StatRow } from "@content-automation/ui/components/StatRow";
import { Badge } from "@content-automation/ui/components/ui/badge";
import { Button } from "@content-automation/ui/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@content-automation/ui/components/ui/card";
import { Input } from "@content-automation/ui/components/ui/input";
import { Label } from "@content-automation/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@content-automation/ui/components/ui/select";
import { Switch } from "@content-automation/ui/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@content-automation/ui/components/ui/tabs";

type Role = {
  id: string;
  label: string;
  description: string;
  level: "organization" | "team" | "product" | "basic";
};

type Member = {
  id: string;
  userId: string;
  role: string;
  name: string;
  email: string;
  image: string | null;
  teams: string[];
  administeredTeams: string[];
};

type Team = { id: string; name: string; createdAt: string };
type Overview = {
  organization: { id: string; name: string };
  currentUser: { id: string; role: string };
  access: { organizationAdmin: boolean; assignedTeamIds: string[] };
  roles: Role[];
  assignableRoles: string[];
  members: Member[];
  teams: Team[];
};

type AdminAction = Record<string, unknown> & { action: string };
type View = "users" | "teams" | "roles";

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function baseRole(role: string) {
  return role.split(",").find((item) => item !== "team_admin") || "member";
}

const ROLE_LEVEL_LABELS: Record<Role["level"], string> = {
  organization: "Organization control",
  team: "Delegated team control",
  product: "Product operations",
  basic: "Basic access",
};

function Avatar({ name }: { name: string }) {
  return (
    <span className="grid size-9 place-items-center rounded-full border bg-muted text-xs font-semibold">
      {initials(name)}
    </span>
  );
}

function AdminLoading() {
  return (
    <div className="w-full min-w-0">
      <PageHeader
        description="Manage organization access, teams, and product responsibilities."
        title="Workspace administration"
      />
      <div className="space-y-8">
        <StatRow
          isLoading
          stats={[
            { featured: true, label: "Visible users", value: "0" },
            { label: "Teams", value: "0" },
            { label: "Team administrators", value: "0" },
          ]}
        />
        <ListSurface
          description="Organization membership and access level."
          isLoading
          title="Workspace users"
        />
      </div>
    </div>
  );
}

export function AdminConsole() {
  const [data, setData] = useState<Overview | null>(null);
  const [view, setView] = useState<View>("users");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Unable to load administration data");
      }
      setData(body);
    } catch (cause) {
      setMessage({
        type: "error",
        text:
          cause instanceof Error
            ? cause.message
            : "Unable to load administration data",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function act(key: string, action: AdminAction, success: string) {
    setPending(key);
    setMessage(null);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "The operation could not be completed");
      }
      setMessage({ type: "success", text: success });
      await load();
    } catch (cause) {
      setMessage({
        type: "error",
        text:
          cause instanceof Error
            ? cause.message
            : "The operation could not be completed",
      });
    } finally {
      setPending("");
    }
  }

  if (loading && !data) return <AdminLoading />;

  if (!data) {
    return (
      <div className="w-full min-w-0">
        <PageHeader
          description="Manage organization access, teams, and product responsibilities."
          title="Workspace administration"
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <ShieldCheck className="size-8 text-muted-foreground" />
            <div>
              <p className="font-medium">Administration unavailable</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {message?.text}
              </p>
            </div>
            <Button onClick={() => void load()} variant="outline">
              <RefreshCw className="size-4" />
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const teamById = new Map(data.teams.map((team) => [team.id, team]));
  const roleById = new Map(data.roles.map((role) => [role.id, role]));
  const administered = data.members.filter(
    (member) => member.administeredTeams.length > 0,
  ).length;

  return (
    <div className="w-full min-w-0">
      <PageHeader
        actions={
          <Button
            aria-label="Refresh administration data"
            disabled={loading}
            onClick={() => void load()}
            size="icon"
            variant="outline"
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        }
        description={
          data.access.organizationAdmin
            ? `Manage access, teams, and responsibilities for ${data.organization.name}.`
            : `Manage membership for your assigned teams in ${data.organization.name}.`
        }
        title="Workspace administration"
      />

      <div className="space-y-8">
        <StatRow
          stats={[
            {
              description: "People visible to your role",
              featured: true,
              label: "Visible users",
              value: data.members.length.toLocaleString(),
            },
            {
              description: data.access.organizationAdmin
                ? "Workspace teams"
                : "Teams you administer",
              label: "Teams",
              value: data.teams.length.toLocaleString(),
            },
            {
              description: "People with delegated team control",
              label: "Team administrators",
              value: administered.toLocaleString(),
            },
          ]}
        />

        {message ? (
          <div
            className={
              message.type === "success"
                ? "flex items-center gap-2 rounded-lg border border-chart-2/30 bg-chart-2/10 px-4 py-3 text-sm text-chart-2"
                : "flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            }
            role="status"
          >
            {message.type === "success" ? (
              <Check className="size-4" />
            ) : (
              <ShieldCheck className="size-4" />
            )}
            {message.text}
          </div>
        ) : null}

        <Tabs
          onValueChange={(value) => setView(value as View)}
          value={view}
        >
          <TabsList>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="teams">Teams</TabsTrigger>
            <TabsTrigger value="roles">Roles</TabsTrigger>
          </TabsList>
          <TabsContent className="mt-6" value="users">
            <UsersView
              act={act}
              data={data}
              pending={pending}
              roleById={roleById}
              teamById={teamById}
            />
          </TabsContent>
          <TabsContent className="mt-6" value="teams">
            <TeamsView act={act} data={data} pending={pending} />
          </TabsContent>
          <TabsContent className="mt-6" value="roles">
            <RolesView roles={data.roles} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function UsersView({
  data,
  pending,
  roleById,
  teamById,
  act,
}: {
  data: Overview;
  pending: string;
  roleById: Map<string, Role>;
  teamById: Map<string, Team>;
  act: (
    key: string,
    action: AdminAction,
    success: string,
  ) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(
    data.assignableRoles.includes("member")
      ? "member"
      : data.assignableRoles[0] || "member",
  );
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  async function addMember(event: FormEvent) {
    event.preventDefault();
    await act(
      "add-member",
      { action: "add_member", email, role },
      "User added to the workspace",
    );
    setEmail("");
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filteredMembers = data.members.filter((member) => {
    const memberRole = baseRole(member.role);
    const matchesRole = roleFilter === "all" || memberRole === roleFilter;
    const teamNames = member.teams.map(
      (id) => teamById.get(id)?.name ?? "Team",
    );
    const matchesSearch =
      !normalizedQuery ||
      [member.name, member.email, memberRole, ...teamNames]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    return matchesRole && matchesSearch;
  });
  const hasFilters = query.trim().length > 0 || roleFilter !== "all";
  const clearFilters = () => {
    setQuery("");
    setRoleFilter("all");
  };

  return (
    <div className="space-y-6">
      {data.access.organizationAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a user</CardTitle>
            <CardDescription>
              Add an existing account to this workspace with an initial role.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid items-end gap-4 md:grid-cols-[minmax(0,1fr)_14rem_auto]"
              onSubmit={addMember}
            >
              <div className="grid gap-2">
                <Label htmlFor="admin-user-email">User email</Label>
                <Input
                  id="admin-user-email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="person@company.com"
                  required
                  type="email"
                  value={email}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="admin-user-role">Initial role</Label>
                <Select onValueChange={setRole} value={role}>
                  <SelectTrigger
                    className="w-full"
                    id="admin-user-role"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {data.assignableRoles.map((id) => (
                      <SelectItem key={id} value={id}>
                        {roleById.get(id)?.label || id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button disabled={pending === "add-member"} type="submit">
                {pending === "add-member" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <UserPlus />
                )}
                Add user
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <ListSurface
        count={filteredMembers.length}
        description="Organization membership, team assignments, and access level."
        emptyState={
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <UsersRound className="size-8 text-muted-foreground" />
            <p className="font-medium">
              {hasFilters
                ? "No users match these filters"
                : "No workspace users"}
            </p>
            <p className="text-sm text-muted-foreground">
              {hasFilters
                ? "Try another name, email, team, or role."
                : "Users appear here after they join the workspace."}
            </p>
            {hasFilters ? (
              <Button onClick={clearFilters} size="sm" variant="outline">
                Clear filters
              </Button>
            ) : null}
          </div>
        }
        filters={
          <>
            <FilterSelect
              label="Role"
              onValueChange={setRoleFilter}
              options={[
                { label: "All roles", value: "all" },
                ...data.roles.map((item) => ({
                  label: item.label,
                  value: item.id,
                })),
              ]}
              value={roleFilter}
            />
            {hasFilters ? (
              <Button onClick={clearFilters} size="sm" variant="ghost">
                Clear
              </Button>
            ) : null}
          </>
        }
        onSearchChange={setQuery}
        searchPlaceholder="Search users…"
        searchValue={query}
        title="Workspace users"
      >
        {filteredMembers.length > 0 ? (
          <ListRows>
            {filteredMembers.map((member) => {
              const owner = member.role.split(",").includes("owner");
              const teamNames = member.teams.map(
                (id) => teamById.get(id)?.name || "Team",
              );
              const roleId = baseRole(member.role);
              const roleLabel = owner
                ? "Owner"
                : roleById.get(roleId)?.label || roleId;
              return (
                <ListRow
                  actions={
                    data.access.organizationAdmin
                      ? [
                          {
                            destructive: true,
                            disabled:
                              owner || pending === `remove-${member.id}`,
                            icon: Trash2,
                            label: owner
                              ? "The workspace owner cannot be removed"
                              : `Remove ${member.name}`,
                            onSelect: () =>
                              void act(
                                `remove-${member.id}`,
                                {
                                  action: "remove_member",
                                  memberId: member.id,
                                },
                                "User removed from the workspace",
                              ),
                          },
                        ]
                      : []
                  }
                  badge={
                    data.access.organizationAdmin && !owner ? (
                      <Select
                        disabled={pending === `role-${member.id}`}
                        onValueChange={(nextRole) =>
                          void act(
                            `role-${member.id}`,
                            {
                              action: "update_role",
                              memberId: member.id,
                              role: nextRole,
                            },
                            "Role updated",
                          )
                        }
                        value={roleId}
                      >
                        <SelectTrigger
                          aria-label={`Role for ${member.name}`}
                          className="w-40"
                          size="sm"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {data.assignableRoles.map((id) => (
                            <SelectItem key={id} value={id}>
                              {roleById.get(id)?.label || id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={owner ? "default" : "secondary"}>
                        {roleLabel}
                      </Badge>
                    )
                  }
                  key={member.id}
                  leading={<Avatar name={member.name} />}
                  meta={[
                    member.email,
                    teamNames.length > 0
                      ? teamNames.join(", ")
                      : "No team assignment",
                    ...(member.administeredTeams.length > 0
                      ? ["Team administrator"]
                      : []),
                  ]}
                  title={member.name}
                />
              );
            })}
          </ListRows>
        ) : null}
      </ListSurface>
    </div>
  );
}

function TeamsView({
  data,
  pending,
  act,
}: {
  data: Overview;
  pending: string;
  act: (
    key: string,
    action: AdminAction,
    success: string,
  ) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [membershipFilter, setMembershipFilter] = useState("all");
  const [managedTeamId, setManagedTeamId] = useState<string | null>(null);

  async function createTeam(event: FormEvent) {
    event.preventDefault();
    await act(
      "create-team",
      { action: "create_team", name },
      "Team created",
    );
    setName("");
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filteredTeams = data.teams.filter((team) => {
    const members = data.members.filter((member) =>
      member.teams.includes(team.id),
    );
    const matchesMembership =
      membershipFilter === "all" ||
      (membershipFilter === "active" && members.length > 0) ||
      (membershipFilter === "empty" && members.length === 0);
    const memberNames = members.map((member) => member.name);
    const matchesSearch =
      !normalizedQuery ||
      [team.name, ...memberNames]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    return matchesMembership && matchesSearch;
  });
  const managedTeam =
    data.teams.find((team) => team.id === managedTeamId) ?? null;
  const hasFilters =
    query.trim().length > 0 || membershipFilter !== "all";
  const clearFilters = () => {
    setQuery("");
    setMembershipFilter("all");
  };

  return (
    <div className="space-y-6">
      {data.access.organizationAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Create a team</CardTitle>
            <CardDescription>
              Create a working group, then assign members and delegated
              administrators.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex max-w-xl items-end gap-3"
              onSubmit={createTeam}
            >
              <div className="grid min-w-0 flex-1 gap-2">
                <Label htmlFor="admin-team-name">Team name</Label>
                <Input
                  id="admin-team-name"
                  minLength={2}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Growth"
                  required
                  value={name}
                />
              </div>
              <Button disabled={pending === "create-team"} type="submit">
                {pending === "create-team" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Plus />
                )}
                Create team
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {managedTeam ? (
        <TeamManagementPanel
          act={act}
          data={data}
          onClose={() => setManagedTeamId(null)}
          pending={pending}
          team={managedTeam}
        />
      ) : null}

      <ListSurface
        count={filteredTeams.length}
        description="Working groups and delegated membership administration."
        emptyState={
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <UsersRound className="size-8 text-muted-foreground" />
            <p className="font-medium">
              {hasFilters
                ? "No teams match these filters"
                : "No teams available"}
            </p>
            <p className="text-sm text-muted-foreground">
              {hasFilters
                ? "Try another team name or membership state."
                : "Create a team to organize workspace access."}
            </p>
            {hasFilters ? (
              <Button
                onClick={clearFilters}
                size="sm"
                variant="outline"
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        }
        filters={
          <>
            <FilterSelect
              label="Members"
              onValueChange={setMembershipFilter}
              options={[
                { label: "All teams", value: "all" },
                { label: "Has members", value: "active" },
                { label: "No members", value: "empty" },
              ]}
              value={membershipFilter}
            />
            {hasFilters ? (
              <Button onClick={clearFilters} size="sm" variant="ghost">
                Clear
              </Button>
            ) : null}
          </>
        }
        onSearchChange={setQuery}
        searchPlaceholder="Search teams…"
        searchValue={query}
        title="Teams"
      >
        {filteredTeams.length > 0 ? (
          <ListRows>
            {filteredTeams.map((team) => {
              const members = data.members.filter((member) =>
                member.teams.includes(team.id),
              );
              const administratorCount = members.filter((member) =>
                member.administeredTeams.includes(team.id),
              ).length;

              return (
                <ListRow
                  actions={[
                    {
                      icon: Settings2,
                      label: `Manage ${team.name}`,
                      onSelect: () => setManagedTeamId(team.id),
                    },
                    ...(data.access.organizationAdmin
                      ? [
                          {
                            destructive: true,
                            disabled:
                              pending === `delete-team-${team.id}`,
                            icon: Trash2,
                            label: `Delete ${team.name}`,
                            onSelect: () =>
                              void act(
                                `delete-team-${team.id}`,
                                {
                                  action: "remove_team",
                                  teamId: team.id,
                                },
                                "Team removed",
                              ),
                          },
                        ]
                      : []),
                  ]}
                  badge={
                    managedTeamId === team.id ? (
                      <Badge variant="secondary">Managing</Badge>
                    ) : null
                  }
                  key={team.id}
                  leading={
                    <span className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary">
                      <UsersRound className="size-4" />
                    </span>
                  }
                  meta={[
                    `${members.length.toLocaleString()} ${
                      members.length === 1 ? "member" : "members"
                    }`,
                    `${administratorCount.toLocaleString()} ${
                      administratorCount === 1
                        ? "team administrator"
                        : "team administrators"
                    }`,
                    `Created ${new Date(team.createdAt).toLocaleDateString()}`,
                  ]}
                  title={team.name}
                />
              );
            })}
          </ListRows>
        ) : null}
      </ListSurface>
    </div>
  );
}

function TeamManagementPanel({
  data,
  team,
  pending,
  onClose,
  act,
}: {
  data: Overview;
  team: Team;
  pending: string;
  onClose: () => void;
  act: (
    key: string,
    action: AdminAction,
    success: string,
  ) => Promise<void>;
}) {
  const members = data.members.filter((member) =>
    member.teams.includes(team.id),
  );
  const available = data.members.filter(
    (member) => !member.teams.includes(team.id),
  );
  const [selectedUser, setSelectedUser] = useState(
    available[0]?.userId || "",
  );
  const selected = available.some(
    (member) => member.userId === selectedUser,
  )
    ? selectedUser
    : available[0]?.userId || "";

  return (
    <Card className="gap-0 py-0 shadow-none">
      <CardHeader className="border-b py-5">
        <CardTitle className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <UsersRound className="size-4" />
          </span>
          {team.name}
        </CardTitle>
        <CardDescription>
          {members.length.toLocaleString()}{" "}
          {members.length === 1 ? "member" : "members"}
        </CardDescription>
        <CardAction>
          <Button onClick={onClose} size="sm" variant="outline">
            Done
          </Button>
        </CardAction>
      </CardHeader>

      {available.length > 0 ? (
        <div className="flex gap-2 border-b p-4">
          <Select onValueChange={setSelectedUser} value={selected}>
            <SelectTrigger
              aria-label={`Add a member to ${team.name}`}
              className="min-w-0 flex-1"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {available.map((member) => (
                <SelectItem key={member.userId} value={member.userId}>
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            aria-label={`Add selected member to ${team.name}`}
            disabled={!selected || pending === `team-add-${team.id}`}
            onClick={() =>
              void act(
                `team-add-${team.id}`,
                {
                  action: "add_team_member",
                  teamId: team.id,
                  userId: selected,
                },
                "Team membership updated",
              )
            }
            size="icon"
          >
            {pending === `team-add-${team.id}` ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Plus />
            )}
          </Button>
        </div>
      ) : null}

      {members.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-muted-foreground">
          No members yet.
        </p>
      ) : (
        <ListRows>
          {members.map((member) => {
            const teamAdministrator = member.administeredTeams.includes(
              team.id,
            );
            return (
              <ListRow
                actions={[
                  {
                    destructive: true,
                    disabled:
                      pending ===
                      `team-remove-${team.id}-${member.userId}`,
                    icon: Trash2,
                    label: `Remove ${member.name} from ${team.name}`,
                    onSelect: () =>
                      void act(
                        `team-remove-${team.id}-${member.userId}`,
                        {
                          action: "remove_team_member",
                          teamId: team.id,
                          userId: member.userId,
                        },
                        "Team membership updated",
                      ),
                  },
                ]}
                badge={
                  data.access.organizationAdmin ? (
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      Team admin
                      <Switch
                        aria-label={`Team administrator for ${member.name}`}
                        checked={teamAdministrator}
                        disabled={
                          pending ===
                          `team-admin-${team.id}-${member.id}`
                        }
                        onCheckedChange={(enabled) =>
                          void act(
                            `team-admin-${team.id}-${member.id}`,
                            {
                              action: "set_team_admin",
                              teamId: team.id,
                              memberId: member.id,
                              enabled,
                            },
                            "Team administrator updated",
                          )
                        }
                      />
                    </span>
                  ) : teamAdministrator ? (
                    <Badge variant="secondary">Team administrator</Badge>
                  ) : null
                }
                key={member.id}
                leading={<Avatar name={member.name} />}
                meta={[
                  member.email,
                  teamAdministrator ? "Team administrator" : "Member",
                ]}
                title={member.name}
              />
            );
          })}
        </ListRows>
      )}
    </Card>
  );
}

function RolesView({ roles }: { roles: Role[] }) {
  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredRoles = roles.filter((role) => {
    const matchesLevel =
      levelFilter === "all" || role.level === levelFilter;
    const matchesSearch =
      !normalizedQuery ||
      [role.label, role.description, ROLE_LEVEL_LABELS[role.level]]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    return matchesLevel && matchesSearch;
  });
  const hasFilters = query.trim().length > 0 || levelFilter !== "all";
  const clearFilters = () => {
    setQuery("");
    setLevelFilter("all");
  };

  return (
    <ListSurface
      count={filteredRoles.length}
      description="Access flows from organization control to product-specific responsibilities."
      emptyState={
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <ShieldCheck className="size-8 text-muted-foreground" />
          <p className="font-medium">
            {hasFilters ? "No roles match these filters" : "No roles available"}
          </p>
          <p className="text-sm text-muted-foreground">
            {hasFilters
              ? "Try another role name or access level."
              : "Workspace roles appear here when they are configured."}
          </p>
          {hasFilters ? (
            <Button onClick={clearFilters} size="sm" variant="outline">
              Clear filters
            </Button>
          ) : null}
        </div>
      }
      filters={
        <>
          <FilterSelect
            label="Level"
            onValueChange={setLevelFilter}
            options={[
              { label: "All levels", value: "all" },
              ...(
                Object.entries(ROLE_LEVEL_LABELS) as Array<
                  [Role["level"], string]
                >
              ).map(([value, label]) => ({ label, value })),
            ]}
            value={levelFilter}
          />
          {hasFilters ? (
            <Button onClick={clearFilters} size="sm" variant="ghost">
              Clear
            </Button>
          ) : null}
        </>
      }
      onSearchChange={setQuery}
      searchPlaceholder="Search roles…"
      searchValue={query}
      title="Roles"
    >
      {filteredRoles.length > 0 ? (
        <ListRows>
          {filteredRoles.map((role) => (
            <ListRow
              badge={
                <Badge variant="secondary">
                  {ROLE_LEVEL_LABELS[role.level]}
                </Badge>
              }
              key={role.id}
              leading={
                <span className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary">
                  <ShieldCheck className="size-4" />
                </span>
              }
              meta={[role.description]}
              title={role.label}
            />
          ))}
        </ListRows>
      ) : null}
    </ListSurface>
  );
}
