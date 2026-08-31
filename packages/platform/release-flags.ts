/**
 * Environment-level module release flags.
 *
 * RELEASED_MODULES is a comma-separated list naming which product modules an
 * ENVIRONMENT serves (e.g. production ships outreach before the rest).
 * Unset, empty, or "all" releases everything — dev and staging default open.
 *
 * This gate sits ABOVE commercial gating: a module absent from the
 * environment's release set is invisible regardless of plan, entitlement, or
 * role. Enforcement lives at the capability registry (every surface — UI
 * data, REST, MCP, agent gateways — executes through it), in the page proxy,
 * and in the sidebar. Core platform modules (workspace, billing, auth,
 * admin, operations, integrations, webhooks, the assistant, and the Brain
 * explorer) are never gateable: they are platform features, not product
 * modules. Resonance is platform infrastructure too, but its composer only
 * scores content drafts/ideas, so it surfaces under the content flag.
 */

export const RELEASABLE_MODULES = [
  "agents",
  "outreach",
  "content",
  "nurture",
  "intelligence",
] as const;

export type ReleasableModule = (typeof RELEASABLE_MODULES)[number];

/** Capability-id first segment → module. Absent ⇒ core (never gated). */
const CAPABILITY_PREFIX_MODULES: Record<string, ReleasableModule> = {
  agents: "agents",
  outreach: "outreach",
  content: "content",
  publishing: "content",
  // Resonance scores content drafts/ideas — it is unusable without the
  // content module, so it rides content's flag.
  resonance: "content",
  cascade: "nurture",
  intelligence: "intelligence",
};

/** Page path first segment → module. Absent ⇒ core (never gated). */
const PAGE_PREFIX_MODULES: Record<string, ReleasableModule> = {
  agents: "agents",
  outreach: "outreach",
  catalog: "outreach",
  personas: "outreach",
  content: "content",
  resonance: "content",
  cascade: "nurture",
};

export function releasedModules(): ReadonlySet<ReleasableModule> {
  const configured = process.env.RELEASED_MODULES?.trim().toLowerCase();
  if (!configured || configured === "all") return new Set(RELEASABLE_MODULES);
  const names = new Set(configured.split(",").map((name) => name.trim()).filter(Boolean));
  return new Set(RELEASABLE_MODULES.filter((module) => names.has(module)));
}

export function moduleForCapability(capabilityId: string): ReleasableModule | null {
  return CAPABILITY_PREFIX_MODULES[capabilityId.split(".", 1)[0]] ?? null;
}

export function moduleForPagePath(pathname: string): ReleasableModule | null {
  const segment = pathname.replace(/^\/+/, "").split("/", 1)[0];
  return PAGE_PREFIX_MODULES[segment] ?? null;
}

export function isCapabilityReleased(capabilityId: string): boolean {
  const module = moduleForCapability(capabilityId);
  return module === null || releasedModules().has(module);
}

export function isPageReleased(pathname: string): boolean {
  const module = moduleForPagePath(pathname);
  return module === null || releasedModules().has(module);
}
