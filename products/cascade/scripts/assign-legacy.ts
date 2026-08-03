import { getCascadeAdminPool } from "../data/pool";
import { assignLegacyCascadeData, ensureCascadeSchema } from "../data/schema";

const organizationId = process.env.LEGACY_ORGANIZATION_ID;
if (!organizationId) throw new Error("LEGACY_ORGANIZATION_ID is required.");
if (process.env.MIGRATION_CONFIRM_ASSIGN !== "yes") throw new Error("Set MIGRATION_CONFIRM_ASSIGN=yes after verifying the target organization.");

const pool = getCascadeAdminPool();
try {
  await ensureCascadeSchema(pool);
  await assignLegacyCascadeData(pool, organizationId);
  console.log(`Assigned all unowned Cascade rows to organization '${organizationId}'.`);
} finally {
  await pool.end();
}
