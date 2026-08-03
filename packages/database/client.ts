import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import * as schema from "./schema/index";

export type Database = NodePgDatabase<typeof schema>;

export function databaseFor(pool: Pool | PoolClient): Database {
  return drizzle(pool, { schema });
}
