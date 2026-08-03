import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

export const productIds = ["outreach", "content", "cascade"] as const;
export type ProductId = (typeof productIds)[number];

export const statement = {
  ...defaultStatements,
  outreach: [
    "read",
    "create",
    "update",
    "delete",
    "research",
    "qualify",
    "message",
  ],
  content: ["read", "create", "update", "delete", "research", "generate", "publish"],
  cascade: ["read", "create", "update", "delete", "approve"],
} as const;

export const ac = createAccessControl(statement);

const allOutreach = [...statement.outreach];
const allContent = [...statement.content];
const allCascade = [...statement.cascade];

export const owner = ac.newRole({
  ...ownerAc.statements,
  outreach: allOutreach,
  content: allContent,
  cascade: allCascade,
});

export const admin = ac.newRole({
  ...adminAc.statements,
  outreach: allOutreach,
  content: allContent,
  cascade: allCascade,
});

export const member = ac.newRole({
  ...memberAc.statements,
  outreach: ["read"],
  content: ["read"],
  cascade: ["read"],
});

export const outreachManager = ac.newRole({ outreach: allOutreach });
export const outreachOperator = ac.newRole({
  outreach: ["read", "create", "update", "research", "qualify", "message"],
});
export const contentManager = ac.newRole({ content: allContent });
export const contentEditor = ac.newRole({
  content: ["read", "create", "update", "research", "generate"],
});
export const teamAdmin = ac.newRole({
  outreach: ["read"],
  content: ["read"],
  cascade: ["read"],
});
export const viewer = ac.newRole({ outreach: ["read"], content: ["read"], cascade: ["read"] });

export const roles = {
  owner,
  admin,
  member,
  outreach_manager: outreachManager,
  outreach_operator: outreachOperator,
  content_manager: contentManager,
  content_editor: contentEditor,
  team_admin: teamAdmin,
  viewer,
};

export type RoleName = keyof typeof roles;
export type ProductAction =
  | (typeof statement.outreach)[number]
  | (typeof statement.content)[number]
  | (typeof statement.cascade)[number];

export const roleDefinitions: Array<{
  id: RoleName;
  label: string;
  description: string;
  level: "organization" | "team" | "product" | "basic";
}> = [
  { id: "owner", label: "Owner", description: "Full organization ownership and product access.", level: "organization" },
  { id: "admin", label: "Administrator", description: "Manages users, roles, teams, and both products.", level: "organization" },
  { id: "team_admin", label: "Team administrator", description: "Manages membership for specifically assigned teams.", level: "team" },
  { id: "outreach_manager", label: "Outreach manager", description: "Full Outreach targeting and operations.", level: "product" },
  { id: "outreach_operator", label: "Outreach operator", description: "Researches, qualifies, and contacts leads.", level: "product" },
  { id: "content_manager", label: "Content manager", description: "Full Content configuration and publishing.", level: "product" },
  { id: "content_editor", label: "Content editor", description: "Researches, generates, and edits content.", level: "product" },
  { id: "member", label: "Member", description: "Basic read access to entitled products.", level: "basic" },
  { id: "viewer", label: "Viewer", description: "Read-only access to entitled products.", level: "basic" },
];

export function hasAnyRole(roleValue: string, allowed: RoleName[]): boolean {
  const assigned = roleValue.split(",").map((role) => role.trim());
  return allowed.some((role) => assigned.includes(role));
}

export function canOpenAdmin(roleValue: string): boolean {
  return hasAnyRole(roleValue, ["owner", "admin", "team_admin"]);
}

export function canManageOrganization(roleValue: string): boolean {
  return hasAnyRole(roleValue, ["owner", "admin"]);
}

export function roleHasPermission(
  roleValue: string,
  product: ProductId,
  action: ProductAction,
): boolean {
  const names = roleValue.split(",").map((role) => role.trim()).filter(Boolean);
  return names.some((name) => {
    const role = roles[name as RoleName];
    return role ? role.authorize({ [product]: [action] }).success : false;
  });
}

export function permissionForRequest(pathname: string, method: string): {
  product: ProductId;
  action: ProductAction;
} | null {
  // Streaming endpoints are alternate transports for the same operation and
  // must never receive a weaker permission than their non-streaming sibling.
  const permissionPath = pathname.endsWith("/stream")
    ? pathname.slice(0, -"/stream".length)
    : pathname;
  const product: ProductId | null = pathname.startsWith("/api/outreach")
    ? "outreach"
    : pathname.startsWith("/api/content")
      ? "content"
      : pathname.startsWith("/api/cascade")
        ? "cascade"
        : null;

  if (!product) return null;

  if (product === "content") {
    // The OAuth provider redirects the browser here — session-gated, not publisher-gated.
    if (permissionPath.startsWith("/api/content/channels/callback/")) return { product, action: "read" };
    if (
      permissionPath.startsWith("/api/content/channels") ||
      permissionPath === "/api/content/publishing" ||
      /\/api\/content\/drafts\/[^/]+\/(publish|posts)$/.test(permissionPath)
    ) {
      return { product, action: "publish" };
    }
  }

  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return { product, action: "read" };

  if (product === "outreach") {
    if (permissionPath.endsWith("/research") || permissionPath === "/api/outreach/research") return { product, action: "research" };
    if (permissionPath.endsWith("/qualify")) return { product, action: "qualify" };
    if (/\/leads\/[^/]+\/outreach(?:\/|$)/.test(permissionPath)) return { product, action: "message" };
  }

  if (product === "content") {
    if (permissionPath.endsWith("/research/run")) return { product, action: "research" };
    if (permissionPath.includes("generate") || permissionPath.includes("/refine") || permissionPath.includes("/ingest") || /\/ideas\/[^/]+\/draft$/.test(permissionPath)) {
      return { product, action: "generate" };
    }
  }

  if (method === "POST") return { product, action: "create" };
  if (method === "DELETE") return { product, action: "delete" };
  return { product, action: "update" };
}
