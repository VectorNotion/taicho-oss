import type { PoolConfig } from "pg";

/**
 * Production and strict local development must never silently fall back from a
 * tenant-scoped database role to the generic application connection.
 */
export function dedicatedDatabaseRolesRequired(): boolean {
  return process.env.NODE_ENV === "production"
    || process.env.DATABASE_ROLE_MODE?.trim().toLowerCase() === "strict";
}

export function adminPoolConfig(): PoolConfig {
  const connectionString =
    process.env.DRIZZLE_DATABASE_URL ??
    process.env.DATABASE_ADMIN_URL ??
    process.env.DATABASE_URL;

  if (connectionString) return { connectionString };

  return {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? "postgres",
    password: process.env.POSTGRES_PASSWORD ?? "postgres",
    database: process.env.POSTGRES_DB ?? "langgraph",
  };
}
