import { Pool } from "pg";
import { databaseFor } from "@content-automation/database";

declare global {
  // eslint-disable-next-line no-var
  var __contentAutomationAuthPool: Pool | undefined;
}

function databaseConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  return {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? "postgres",
    password: process.env.POSTGRES_PASSWORD ?? "postgres",
    database: process.env.POSTGRES_DB ?? "langgraph",
  };
}

export const authPool =
  globalThis.__contentAutomationAuthPool ?? new Pool(databaseConfig());
export const authDatabase = databaseFor(authPool);

if (process.env.NODE_ENV !== "production") {
  globalThis.__contentAutomationAuthPool = authPool;
}

/**
 * Compatibility guard for callers that previously triggered request-time DDL.
 * Schema creation now happens only through `pnpm db:migrate`.
 */
export async function ensureAuthorizationSchema(): Promise<void> {
  return Promise.resolve();
}
