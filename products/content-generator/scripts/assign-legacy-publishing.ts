import { getPublishingAdminPool } from "../publishing/pool";
import { assignLegacyPublishingData } from "../publishing/schema";

const organizationId = process.env.LEGACY_ORGANIZATION_ID;
if (!organizationId) throw new Error("LEGACY_ORGANIZATION_ID is required.");
if (process.env.MIGRATION_CONFIRM_ASSIGN !== "yes") {
  throw new Error("Set MIGRATION_CONFIRM_ASSIGN=yes after verifying the target organization.");
}

const pool = getPublishingAdminPool();
try {
  await assignLegacyPublishingData(pool, organizationId);
  console.log(`Assigned NULL and legacy publishing rows to organization '${organizationId}'.`);
} finally {
  await pool.end();
}
