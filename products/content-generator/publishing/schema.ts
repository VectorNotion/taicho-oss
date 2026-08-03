import {
  channelsInPublishing,
  databaseFor,
  postsInPublishing,
} from "@content-automation/database";
import { eq, isNull, or } from "drizzle-orm";
import type { Pool } from "pg";

export interface EnsurePublishingSchemaOptions {
  /**
   * Explicit sole owner for rows created before publishing became tenant-aware.
   * Only NULL and the historical "legacy" sentinel are reassigned.
   */
  legacyOrganizationId?: string;
}

/** Publishing tables are provisioned exclusively by the root Drizzle migrations. */
export async function ensurePublishingSchema(
  _pool: Pool,
  _options: EnsurePublishingSchemaOptions = {},
): Promise<void> {
  return Promise.resolve();
}

function validateOrganizationId(organizationId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,255}$/.test(organizationId)) {
    throw new Error("Invalid organization ID.");
  }
}

export async function assignLegacyPublishingData(
  pool: Pool,
  organizationId: string,
): Promise<void> {
  validateOrganizationId(organizationId);
  await databaseFor(pool).transaction(async (tx) => {
    await tx
      .update(channelsInPublishing)
      .set({ org_id: organizationId })
      .where(or(
        isNull(channelsInPublishing.org_id),
        eq(channelsInPublishing.org_id, "legacy"),
      ));
    await tx
      .update(postsInPublishing)
      .set({ organization_id: organizationId })
      .where(or(
        isNull(postsInPublishing.organization_id),
        eq(postsInPublishing.organization_id, "legacy"),
      ));
  });
}
