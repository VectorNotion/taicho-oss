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
      ["public.outreach_lead_evidence", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
      ["public.outreach_lead_insight_snapshots", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
      ["public.outreach_lead_meeting_events", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
      ["public.outreach_lead_meetings", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
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
      ["public.outreach_lead_source_identities", ["SELECT", "INSERT", "UPDATE"]],
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

const capabilityAdminColumnGrants = [
  ["public.mcp_operation", [
    "id",
    "organization_id",
    "status",
    "lease_expires_at",
    "attempt",
    "max_attempts",
    "created_at",
  ]],
  ["public.mcp_media_upload", ["id", "organization_id"]],
  ["public.external_webhook_delivery", [
    "id",
    "organization_id",
    "status",
    "next_attempt_at",
    "lease_expires_at",
    "attempt",
    "max_attempts",
  ]],
  ["public.external_api_rate_limit", ["expires_at"]],
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

function configuredDatabaseRole(...environmentNames: string[]) {
  for (const environmentName of environmentNames) {
    const value = process.env[environmentName]?.trim();
    if (!value) continue;
    try {
      const role = decodeURIComponent(new URL(value).username).trim();
      if (role) return { environmentName, role };
    } catch {
      throw new Error(`${environmentName} must be a valid PostgreSQL URL.`);
    }
    throw new Error(`${environmentName} must include a database username.`);
  }
  return undefined;
}

async function verifyDatabaseGrants(db: ReturnType<typeof databaseFor>) {
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

  const capabilityAdmin = configuredDatabaseRole(
    "CAPABILITY_ADMIN_DATABASE_URL",
    "MCP_ADMIN_DATABASE_URL",
  );
  if (capabilityAdmin) {
    const roleAttributes = await db.execute<{
      bypassRls: boolean;
      superuser: boolean;
    }>(sql`
      SELECT rolbypassrls AS "bypassRls", rolsuper AS superuser
      FROM pg_roles
      WHERE rolname = ${capabilityAdmin.role}
    `);
    const attributes = roleAttributes.rows[0];
    if (!attributes?.bypassRls) {
      missing.push(`${capabilityAdmin.environmentName} role must have BYPASSRLS`);
    }
    if (attributes?.superuser) {
      missing.push(`${capabilityAdmin.environmentName} role must not be SUPERUSER`);
    }

    const schemaGrant = await db.execute<{ allowed: boolean }>(sql`
      SELECT has_schema_privilege(${capabilityAdmin.role}, 'public', 'USAGE') AS allowed
    `);
    if (!schemaGrant.rows[0]?.allowed) {
      missing.push(`${capabilityAdmin.environmentName} lacks USAGE on public`);
    }

    const deleteGrant = await db.execute<{ allowed: boolean }>(sql`
      SELECT has_table_privilege(
        ${capabilityAdmin.role},
        'public.external_api_rate_limit',
        'DELETE'
      ) AS allowed
    `);
    if (!deleteGrant.rows[0]?.allowed) {
      missing.push(
        `${capabilityAdmin.environmentName} lacks DELETE on public.external_api_rate_limit`,
      );
    }

    for (const [relation, columns] of capabilityAdminColumnGrants) {
      for (const column of columns) {
        const columnGrant = await db.execute<{ allowed: boolean }>(sql`
          SELECT has_column_privilege(
            ${capabilityAdmin.role},
            ${relation},
            ${column},
            'SELECT'
          ) AS allowed
        `);
        if (!columnGrant.rows[0]?.allowed) {
          missing.push(
            `${capabilityAdmin.environmentName} lacks SELECT (${column}) on ${relation}`,
          );
        }
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Database grant verification failed:\n${missing.join("\n")}`);
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
    await verifyDatabaseGrants(db);
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
