import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_MIGRATION_URL;
const schemaFilter = process.env.DRIZZLE_SCHEMA_FILTER?.split(",")
  .map((schema) => schema.trim())
  .filter(Boolean) ?? ["public", "assistant", "cascade", "publishing", "observability"];

export default defineConfig({
  dialect: "postgresql",
  // Feed each declaration file once. Including schema/index.ts as well as the
  // files it re-exports makes Drizzle see job_workspace_member_ids twice.
  schema: [
    "./packages/database/schema/tables.ts",
    "./packages/database/schema/views.ts",
  ],
  out: process.env.DRIZZLE_OUT ?? "./packages/database/migrations",
  dbCredentials: databaseUrl
    ? { url: databaseUrl }
    : {
        host: process.env.POSTGRES_HOST ?? "localhost",
        port: Number(process.env.POSTGRES_PORT ?? 5432),
        user: process.env.POSTGRES_USER ?? "postgres",
        password: process.env.POSTGRES_PASSWORD ?? "postgres",
        database: process.env.POSTGRES_DB ?? "langgraph",
      },
  schemaFilter,
  migrations: {
    table: "__drizzle_migrations",
    schema: "drizzle",
  },
  introspect: {
    casing: "preserve",
  },
  strict: true,
  verbose: true,
});
