import type { PoolConfig } from "pg";

/**
 * Production and strict local development must never silently fall back from a
 * tenant-scoped database role to the generic application connection.
 */
export function dedicatedDatabaseRolesRequired(): boolean {
  return process.env.NODE_ENV === "production"
    || process.env.DATABASE_ROLE_MODE?.trim().toLowerCase() === "strict";
}

function localDatabaseConfig(): PoolConfig {
  return {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? "postgres",
    password: process.env.POSTGRES_PASSWORD ?? "postgres",
    database: process.env.POSTGRES_DB ?? "langgraph",
  };
}

function requiredDatabaseUrl(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (dedicatedDatabaseRolesRequired()) {
    throw new Error(`${name} is required in production or strict database-role mode.`);
  }
  return undefined;
}

/** The single NOBYPASSRLS identity used by every long-running application. */
export function runtimePoolConfig(): PoolConfig {
  const connectionString = requiredDatabaseUrl("DATABASE_URL");
  return connectionString ? { connectionString } : localDatabaseConfig();
}

/** The single BYPASSRLS identity used only for bounded work discovery. */
export function controlPoolConfig(): PoolConfig {
  const connectionString = requiredDatabaseUrl("DATABASE_CONTROL_URL");
  return connectionString ? { connectionString } : localDatabaseConfig();
}

/** The short-lived release identity that owns every schema object and runs DDL. */
export function migrationPoolConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_MIGRATION_URL?.trim();

  if (connectionString) return { connectionString };
  if (dedicatedDatabaseRolesRequired()) {
    throw new Error(
      "DATABASE_MIGRATION_URL is required for production or strict database migrations.",
    );
  }
  return localDatabaseConfig();
}

/** @deprecated Migration callers should use migrationPoolConfig. */
export const adminPoolConfig = migrationPoolConfig;
