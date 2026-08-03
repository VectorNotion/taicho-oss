/**
 * One signed-ingest token per organization.
 * Stored in platform Postgres with the standard org RLS policy — the same
 * home Cascade uses for org-scoped settings, not the per-org graph Settings
 * node (secrets must be readable outside a request context).
 */
import { randomUUID } from 'node:crypto';
import { databaseFor, metric_ingest_tokens as ingestTokensTable } from '@content-automation/database';
import { eq } from 'drizzle-orm';
import { getJobPool, validateJobOrganizationId } from '../jobs/pool';
import { ensureMetricsTables } from './snapshots';

export async function getOrCreateIngestToken(
  organizationId: string,
): Promise<{ token: string }> {
  const scoped = validateJobOrganizationId(organizationId);
  await ensureMetricsTables();
  const [row] = await databaseFor(getJobPool(scoped))
    .insert(ingestTokensTable)
    .values({ organization_id: scoped })
    .onConflictDoUpdate({
      target: ingestTokensTable.organization_id,
      set: { organization_id: scoped },
    })
    .returning({ token: ingestTokensTable.token });
  return row;
}

export async function rotateIngestToken(
  organizationId: string,
): Promise<{ token: string }> {
  const scoped = validateJobOrganizationId(organizationId);
  await ensureMetricsTables();
  const token = randomUUID();
  const rotatedAt = new Date().toISOString();
  const [rotated] = await databaseFor(getJobPool(scoped))
    .insert(ingestTokensTable)
    .values({ organization_id: scoped, token, rotated_at: rotatedAt })
    .onConflictDoUpdate({
      target: ingestTokensTable.organization_id,
      set: { token, rotated_at: rotatedAt },
    })
    .returning({ token: ingestTokensTable.token });
  return rotated;
}

/** Read-only lookup for verification: null when the org has no token yet. */
export async function getIngestToken(organizationId: string): Promise<string | null> {
  const scoped = validateJobOrganizationId(organizationId);
  await ensureMetricsTables();
  const [row] = await databaseFor(getJobPool(scoped))
    .select({ token: ingestTokensTable.token })
    .from(ingestTokensTable)
    .where(eq(ingestTokensTable.organization_id, scoped))
    .limit(1);
  return row?.token ?? null;
}
