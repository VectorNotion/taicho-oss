import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DRIZZLE_DATABASE_URL ?? process.env.DATABASE_URL;
const schemaFilter = process.env.DRIZZLE_SCHEMA_FILTER?.split(",")
  .map((schema) => schema.trim())
  .filter(Boolean) ?? ["public", "assistant", "cascade", "publishing", "observability"];

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/database/schema/**/*.ts",
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
