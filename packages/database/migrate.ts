import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, sql } from "drizzle-orm";
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

const runtimeGrantContracts = [
  {
    environmentName: "JOBS_DATABASE_ROLE",
    schema: "public",
    relations: [
      ["public.product_events", ["SELECT", "INSERT"]],
      ["public.job_workspace_member_ids", ["SELECT"]],
      ["public.attention_items", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
      ["public.intelligence_api_tokens", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
      ["public.intelligence_artifact_outcomes", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
      ["public.intelligence_artifacts", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
      ["public.intelligence_runs", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
      ["public.notification_preferences", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
      ["public.notification_recipients", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
      ["public.product_event_projections", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
      ["public.external_webhook_delivery", ["INSERT"]],
      ["public.external_webhook_endpoint", ["SELECT"]],
    ],
  },
  {
    environmentName: "CAPABILITY_DATABASE_ROLE",
    schema: "public",
    relations: [
      ["public.external_api_rate_limit", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
      ["public.external_webhook_delivery", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
      ["public.external_webhook_endpoint", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
    ],
  },
  {
    environmentName: "PUBLISHING_DATABASE_ROLE",
    schema: "publishing",
    relations: [
      ["publishing.content_assets", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
      ["publishing.content_generation_runs", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
    ],
  },
  {
    environmentName: "CASCADE_DATABASE_ROLE",
    schema: "cascade",
    relations: [
      ["cascade.funnel_members", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
      ["cascade.plain_text_emails", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
    ],
  },
] as const;

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

async function verifyRuntimeGrants(db: ReturnType<typeof databaseFor>) {
  const missing: string[] = [];
  for (const contract of runtimeGrantContracts) {
    const role = process.env[contract.environmentName]?.trim();
    if (!role) continue;
    const schemaGrant = await db.execute<{ allowed: boolean }>(sql`
      SELECT has_schema_privilege(${role}, ${contract.schema}, 'USAGE') AS allowed
    `);
    if (!schemaGrant.rows[0]?.allowed) {
      missing.push(`${contract.environmentName} lacks USAGE on ${contract.schema}`);
    }
    for (const [relation, privileges] of contract.relations) {
      for (const privilege of privileges) {
        const tableGrant = await db.execute<{ allowed: boolean }>(sql`
          SELECT has_table_privilege(${role}, ${relation}, ${privilege}) AS allowed
        `);
        if (!tableGrant.rows[0]?.allowed) {
          missing.push(`${contract.environmentName} lacks ${privilege} on ${relation}`);
        }
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`Runtime database grant verification failed:\n${missing.join("\n")}`);
  }
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
    await verifyRuntimeGrants(db);
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
