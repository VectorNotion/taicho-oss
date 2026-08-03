import { Pool } from "pg";
import {
  databaseFor,
  platform_catalog_snapshots as catalogSnapshotsTable,
} from "@content-automation/database";
import { eq } from "drizzle-orm";
import { platformCatalogSchema } from "./catalog-schema";
import type { PlatformCatalog } from "./catalog";

let pool: Pool | undefined;

function catalogPool(): Pool | null {
  if (pool) return pool;
  const connectionString = process.env.PLATFORM_CATALOG_DATABASE_URL?.trim();
  if (!connectionString && process.env.NODE_ENV === "production") {
    return null;
  }
  pool = new Pool(connectionString ? { connectionString } : {
    host: process.env.POSTGRES_HOST || "localhost",
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || "langgraph",
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD || "postgres",
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000,
  });
  return pool;
}

async function ensureSchema(): Promise<Pool | null> {
  return catalogPool();
}

export async function readPlatformCatalogSnapshot(): Promise<{ catalog: PlatformCatalog; syncedAt: Date } | null> {
  const currentPool = await ensureSchema();
  if (!currentPool) return null;
  const [row] = await databaseFor(currentPool)
    .select({
      catalog: catalogSnapshotsTable.catalog,
      syncedAt: catalogSnapshotsTable.synced_at,
    })
    .from(catalogSnapshotsTable)
    .where(eq(catalogSnapshotsTable.id, "published"))
    .limit(1);
  if (!row) return null;
  return { catalog: platformCatalogSchema.parse(row.catalog) as PlatformCatalog, syncedAt: new Date(row.syncedAt) };
}

export async function writePlatformCatalogSnapshot(catalog: PlatformCatalog): Promise<void> {
  const currentPool = await ensureSchema();
  if (!currentPool) return;
  const syncedAt = new Date().toISOString();
  await databaseFor(currentPool)
    .insert(catalogSnapshotsTable)
    .values({
      id: "published",
      catalog_version: catalog.catalogVersion,
      catalog,
      source_generated_at: catalog.generatedAt,
      synced_at: syncedAt,
    })
    .onConflictDoUpdate({
      target: catalogSnapshotsTable.id,
      set: {
        catalog_version: catalog.catalogVersion,
        catalog,
        source_generated_at: catalog.generatedAt,
        synced_at: syncedAt,
      },
    });
}
