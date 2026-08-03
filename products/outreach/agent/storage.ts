import { PostgresStore } from '@mastra/pg';

declare global {
  // eslint-disable-next-line no-var
  var __outreachMemoryStore: PostgresStore | undefined;
}

/**
 * Resolve the Postgres connection string for Mastra memory.
 *
 * Uses DATABASE_URL when set, otherwise assembles a postgresql:// URL from the
 * POSTGRES_* env vars, matching the defaults in products/cascade/data/pool.ts.
 *
 * This stays local to Outreach because product packages must not cross-import
 * one another. Shared orchestration now lives in packages/intelligence; this
 * helper only owns Outreach's Mastra storage connection.
 */
export function resolveConnectionString(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const host = process.env.POSTGRES_HOST ?? 'localhost';
  const port = process.env.POSTGRES_PORT ?? '5432';
  const user = process.env.POSTGRES_USER ?? 'postgres';
  const password = process.env.POSTGRES_PASSWORD ?? 'postgres';
  const database = process.env.POSTGRES_DB ?? 'langgraph';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(
    password,
  )}@${host}:${port}/${database}`;
}

/**
 * Lazily-created singleton PostgresStore backing the outreach agents' memory.
 * Wired as `storage` on the Mastra instance, which auto-injects it into any
 * storage-less agent Memory and auto-creates the mastra_* tables on first use.
 */
export function getStorage(): PostgresStore {
  if (!globalThis.__outreachMemoryStore) {
    globalThis.__outreachMemoryStore = new PostgresStore({
      disableInit: true, // tables are created by scripts/migrate.ts at entrypoint — never at import/build time
      id: 'outreach-memory',
      connectionString: resolveConnectionString(),
    });
  }
  return globalThis.__outreachMemoryStore;
}
