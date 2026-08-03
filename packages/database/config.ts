import type { PoolConfig } from "pg";

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
