import type { Pool } from "pg";
import { assistantSchemaName } from "./pool";

/** Schema creation is owned exclusively by the root Drizzle migrations. */
export async function ensureAssistantSchema(_pool: Pool): Promise<void> {
  return Promise.resolve();
}

/** Test databases are isolated at the database level; schemas are not dropped at runtime. */
export async function dropAssistantSchema(_pool: Pool): Promise<void> {
  return Promise.resolve();
}

export { assistantSchemaName };
