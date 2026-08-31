import type { CompiledKnowledgeRegistry } from './types';
import { knowledgeRegistry } from './registry';

export type OrganizationRegistryResolver = (organizationId: string) => Promise<CompiledKnowledgeRegistry>;

let resolver: OrganizationRegistryResolver | null = null;

/**
 * Installed at boot by the capability layer (which owns overlay storage) so
 * that products can resolve the organization's registry — base manifests plus
 * enabled overlays, including the self-curated `learned` module — without a
 * package cycle. Falls back to the static compiled registry when no resolver
 * is installed (standalone apps, tests).
 */
export function setOrganizationRegistryResolver(next: OrganizationRegistryResolver): void {
  resolver = next;
}

export async function resolveOrganizationRegistry(organizationId: string): Promise<CompiledKnowledgeRegistry> {
  if (!resolver) return knowledgeRegistry.current();
  try {
    return await resolver(organizationId);
  } catch {
    return knowledgeRegistry.current();
  }
}
