import { databaseFor } from '@content-automation/database';
import { getJobPool, validateJobOrganizationId } from '../jobs/pool';

/**
 * Database client whose PostgreSQL connection is pinned to one organization.
 * The runtime role remains subject to forced row-level security.
 */
export function tenantDatabase(organizationId: string) {
  return databaseFor(getJobPool(validateJobOrganizationId(organizationId)));
}
