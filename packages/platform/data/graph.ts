import {
  closeFalkorDb,
  getFalkorSession,
  type SeamSession,
} from './falkordb-adapter';
import { currentGraphOrganizationId } from './organization-context';
export {
  currentGraphOrganizationId,
  organizationGraphName,
  requireGraphOrganizationId,
  runWithGraphOrganization,
} from './organization-context';

export const ORGANIZATION_REQUEST_HEADER = 'x-vector-notion-organization-id';

async function requestOrganizationId(): Promise<string | undefined> {
  try {
    // Next owns request context for the UI/REST surface. Proxies overwrite this
    // internal header after authenticating the request. MCP and workers use the
    // explicit AsyncLocalStorage boundary instead.
    const { headers } = await import('next/headers');
    return (await headers()).get(ORGANIZATION_REQUEST_HEADER) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The platform graph store is FalkorDB. Keep repository access behind this seam. */
export async function getSession(organizationId?: string): Promise<SeamSession> {
  const scopedOrganizationId = organizationId
    ?? currentGraphOrganizationId()
    ?? await requestOrganizationId();
  return getFalkorSession(scopedOrganizationId);
}

export function closeDriver(): Promise<void> {
  return closeFalkorDb();
}
