import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

type OrganizationGraphContext = {
  organizationId: string;
};

const storage = new AsyncLocalStorage<OrganizationGraphContext>();

function validateOrganizationId(organizationId: string): string {
  const normalized = organizationId.trim();
  if (!normalized) throw new Error("An organization is required for graph access.");
  if (normalized.length > 255) throw new Error("The organization identifier is invalid.");
  return normalized;
}

/**
 * Execute all graph work created by `callback` inside one organization boundary.
 * AsyncLocalStorage propagates through promises, timers, and background work created
 * inside the callback without leaking across concurrent requests.
 */
export function runWithGraphOrganization<T>(
  organizationId: string,
  callback: () => T,
): T {
  return storage.run({ organizationId: validateOrganizationId(organizationId) }, callback);
}

export function currentGraphOrganizationId(): string | null {
  return storage.getStore()?.organizationId ?? null;
}

export function requireGraphOrganizationId(explicitOrganizationId?: string): string {
  if (explicitOrganizationId) return validateOrganizationId(explicitOrganizationId);
  const organizationId = currentGraphOrganizationId();
  if (!organizationId) {
    throw new Error(
      "Organization-scoped graph access was attempted outside an organization context.",
    );
  }
  return organizationId;
}

/**
 * FalkorDB graph keys are infrastructure identifiers, not tenant identifiers. A
 * one-way digest keeps arbitrary OAuth organization IDs out of graph names while
 * producing a stable, collision-resistant namespace.
 */
export function organizationGraphName(
  organizationId: string,
  baseName = process.env.FALKORDB_GRAPH || "content",
): string {
  const digest = createHash("sha256")
    .update(validateOrganizationId(organizationId))
    .digest("hex")
    .slice(0, 32);
  const safeBase = baseName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48) || "content";
  return `${safeBase}__org_${digest}`;
}
