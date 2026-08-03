import type { Pool } from "pg";
import "@/products/content-generator/publishing/adapters";
import {
  getPublishingAdminPool,
  getPublishingPool,
} from "@/products/content-generator/publishing/pool";
import { ensurePublishingSchema } from "@/products/content-generator/publishing/schema";
import { getAuthorizationContext } from "@content-automation/auth/server";

let schemaReady: Promise<void> | null = null;

/**
 * Returns the shared publishing pool after guaranteeing the schema exists.
 * The DDL runs once per process (module-level promise); a failed run resets
 * so the next request can retry instead of failing forever.
 */
export async function publishingDb(headers: Headers): Promise<Pool> {
  const context = await getAuthorizationContext(headers);
  if (!context) throw new Error("An authenticated organization is required for publishing access.");
  if (!schemaReady) {
    schemaReady = ensurePublishingSchema(getPublishingAdminPool()).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
  return getPublishingPool(context.organizationId);
}
