/**
 * Public permission model without Better Auth's generated access-control
 * internals. The concrete roles remain in permissions.ts for runtime use.
 */

export const productIds: readonly ["outreach", "content", "cascade"];
export type ProductId = (typeof productIds)[number];

export type ProductAction =
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

export type RoleName =
  | "owner"
  | "admin"
  | "member"
  | "outreach_manager"
  | "outreach_operator"
  | "content_manager"
  | "content_editor"
  | "team_admin"
  | "viewer";

export const roleDefinitions: Array<{
  id: RoleName;
  label: string;
  description: string;
  level: "organization" | "team" | "product" | "basic";
}>;

export function hasAnyRole(roleValue: string, allowed: RoleName[]): boolean;
export function canOpenAdmin(roleValue: string): boolean;
export function canManageOrganization(roleValue: string): boolean;
export function roleHasPermission(
  roleValue: string,
  product: ProductId,
  action: ProductAction,
): boolean;
export function permissionForRequest(
  pathname: string,
  method: string,
): { product: ProductId; action: ProductAction } | null;
