import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pgSchema, text } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { databaseFor } from "./client";
import { adminPoolConfig } from "./config";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(packageDirectory, "migrations");
const adoptionFolder = join(packageDirectory, "adoption");
const migrationOptions = {
  migrationsTable: "__drizzle_migrations",
  migrationsSchema: "drizzle",
} as const;

const informationSchema = pgSchema("information_schema");
const informationSchemaTables = informationSchema.table("tables", {
  tableSchema: text("table_schema").notNull(),
  tableName: text("table_name").notNull(),
  tableType: text("table_type").notNull(),
});

type BaselineSnapshot = {
  tables: Record<string, { name: string; schema: string }>;
};

async function listedTables(db: ReturnType<typeof databaseFor>, schemas: string[]) {
  const rows = await db
    .select({
      schema: informationSchemaTables.tableSchema,
      table: informationSchemaTables.tableName,
    })
    .from(informationSchemaTables)
    .where(
      and(
        eq(informationSchemaTables.tableType, "BASE TABLE"),
        inArray(informationSchemaTables.tableSchema, schemas),
      ),
    );

  return new Set(rows.map(({ schema, table }) => `${schema}.${table}`));
}

async function hasMigrationJournal(db: ReturnType<typeof databaseFor>) {
  const tables = await listedTables(db, ["drizzle"]);
  return tables.has("drizzle.__drizzle_migrations");
}

async function verifyBaseline(db: ReturnType<typeof databaseFor>) {
  const snapshotPath = join(migrationsFolder, "meta", "0000_snapshot.json");
  const snapshot = JSON.parse(
    await readFile(snapshotPath, "utf8"),
  ) as BaselineSnapshot;
  const expected = new Set(
    Object.values(snapshot.tables).map(({ schema, name }) =>
      `${schema || "public"}.${name}`,
    ),
  );
  const schemas = [...new Set([...expected].map((table) => table.split(".")[0]!))];
  const actual = await listedTables(db, schemas);
  const missing = [...expected].filter((table) => !actual.has(table)).sort();
  const unexpected = [...actual].filter((table) => !expected.has(table)).sort();

  if (missing.length || unexpected.length) {
    throw new Error(
      [
        "The existing database does not match the generated Drizzle baseline.",
        missing.length ? `Missing: ${missing.join(", ")}` : undefined,
        unexpected.length ? `Unexpected: ${unexpected.join(", ")}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

async function hasExistingApplicationTables(db: ReturnType<typeof databaseFor>) {
  const tables = await listedTables(db, [
    "public",
    "assistant",
    "automation",
    "cascade",
    "observability",
    "publishing",
    "sync",
  ]);
  return tables.size > 0;
}

export async function runMigrations({ adoptExisting = false } = {}) {
  const pool = new Pool({ ...adminPoolConfig(), max: 1 });
  const db = databaseFor(pool);

  try {
    if (!(await hasMigrationJournal(db)) && (await hasExistingApplicationTables(db))) {
      if (!adoptExisting) {
        throw new Error(
          "This database predates Drizzle. Run `pnpm db:adopt` once to verify and adopt the existing schema before migrating.",
        );
      }

      await verifyBaseline(db);
      await migrate(db, {
        migrationsFolder: adoptionFolder,
        ...migrationOptions,
      });
    }

    await migrate(db, { migrationsFolder, ...migrationOptions });
  } finally {
    await pool.end();
  }
}

const isDirectExecution = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isDirectExecution) {
  runMigrations({ adoptExisting: process.argv.includes("--adopt-existing") })
    .then(() => {
      console.info("Database migrations are up to date.");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
