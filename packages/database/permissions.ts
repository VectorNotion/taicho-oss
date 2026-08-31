import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { migrationPoolConfig } from "./config";

const excludedSchemas = new Set(["drizzle", "information_schema"]);

const controlGrants = [
  { schema: "public", relation: "organization", privileges: "SELECT" },
  { schema: "public", relation: "jobs", privileges: "SELECT, DELETE" },
  { schema: "public", relation: "product_events", privileges: "SELECT" },
  { schema: "public", relation: "product_event_projections", privileges: "SELECT" },
  { schema: "public", relation: "mcp_operation", privileges: "SELECT" },
  { schema: "public", relation: "mcp_media_upload", privileges: "SELECT" },
  { schema: "public", relation: "external_webhook_delivery", privileges: "SELECT" },
  { schema: "public", relation: "external_api_rate_limit", privileges: "SELECT, DELETE" },
  { schema: "publishing", relation: "content_generation_runs", privileges: "SELECT" },
  { schema: "publishing", relation: "posts", privileges: "SELECT" },
  { schema: "publishing", relation: "channels", privileges: "SELECT" },
  { schema: "cascade", relation: "funnels", privileges: "SELECT" },
  { schema: "automation", relation: "workflows", privileges: "SELECT" },
  { schema: "automation", relation: "workflow_runs", privileges: "SELECT" },
  { schema: "automation", relation: "event_fanout_cursor", privileges: "SELECT, UPDATE" },
] as const;

type RoleAttributes = {
  role: string;
  superuser: boolean;
  bypassRls: boolean;
  createDb: boolean;
  createRole: boolean;
};

function identifier(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_$-]{0,62}$/.test(value)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${value}`);
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function roleFromUrl(name: "DATABASE_URL" | "DATABASE_CONTROL_URL" | "DATABASE_MIGRATION_URL"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required by the database release contract.`);
  try {
    const role = decodeURIComponent(new URL(value).username).trim();
    if (!role) throw new Error("username is empty");
    identifier(role);
    return role;
  } catch (error) {
    throw new Error(`${name} must be a PostgreSQL URL with a valid role.`, { cause: error });
  }
}

async function roleAttributes(client: PoolClient, role: string): Promise<RoleAttributes> {
  const result = await client.query<{
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
  }>(
    `SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
       FROM pg_roles WHERE rolname = $1`,
    [role],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Required PostgreSQL role does not exist: ${role}`);
  return {
    role: row.rolname,
    superuser: row.rolsuper,
    bypassRls: row.rolbypassrls,
    createDb: row.rolcreatedb,
    createRole: row.rolcreaterole,
  };
}

async function applicationSchemas(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ schema: string }>(`
    SELECT nspname AS schema
      FROM pg_namespace
     WHERE nspname <> 'drizzle'
       AND nspname <> 'information_schema'
       AND nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
     ORDER BY nspname
  `);
  return result.rows.map((row) => row.schema);
}

async function relationExists(client: PoolClient, schema: string, relation: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass(format('%I.%I', $1::text, $2::text)) IS NOT NULL AS exists`,
    [schema, relation],
  );
  return result.rows[0]?.exists === true;
}

async function transferOwnership(client: PoolClient, schema: string, migrator: string): Promise<void> {
  await client.query(`ALTER SCHEMA ${identifier(schema)} OWNER TO ${identifier(migrator)}`);
  const types = await client.query<{ name: string }>(
    `SELECT t.typname AS name
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1
        AND t.typtype IN ('d', 'e')
      ORDER BY t.typname`,
    [schema],
  );
  for (const type of types.rows) {
    await client.query(
      `ALTER TYPE ${identifier(schema)}.${identifier(type.name)} OWNER TO ${identifier(migrator)}`,
    );
  }
  const relations = await client.query<{ name: string; kind: string }>(
    `SELECT c.relname AS name, c.relkind AS kind
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1
        AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
        AND (
          c.relkind <> 'S'
          OR NOT EXISTS (
            SELECT 1 FROM pg_depend d
             WHERE d.objid = c.oid AND d.deptype IN ('a', 'i')
          )
        )
      ORDER BY CASE WHEN c.relkind = 'S' THEN 1 ELSE 0 END`,
    [schema],
  );
  const objectKinds: Record<string, string> = {
    r: "TABLE",
    p: "TABLE",
    S: "SEQUENCE",
    v: "VIEW",
    m: "MATERIALIZED VIEW",
    f: "FOREIGN TABLE",
  };
  for (const relation of relations.rows) {
    const objectKind = objectKinds[relation.kind];
    if (!objectKind) throw new Error(`Unsupported PostgreSQL relation kind: ${relation.kind}`);
    await client.query(
      `ALTER ${objectKind} ${identifier(schema)}.${identifier(relation.name)} OWNER TO ${identifier(migrator)}`,
    );
  }
}

async function grantRuntime(client: PoolClient, schema: string, runtime: string, migrator: string): Promise<void> {
  const quotedSchema = identifier(schema);
  const quotedRuntime = identifier(runtime);
  const quotedMigrator = identifier(migrator);
  await client.query(`REVOKE CREATE ON SCHEMA ${quotedSchema} FROM PUBLIC, ${quotedRuntime}`);
  await client.query(`GRANT USAGE ON SCHEMA ${quotedSchema} TO ${quotedRuntime}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${quotedSchema} TO ${quotedRuntime}`,
  );
  await client.query(
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${quotedSchema} TO ${quotedRuntime}`,
  );
  await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${quotedSchema} TO ${quotedRuntime}`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedMigrator} IN SCHEMA ${quotedSchema}
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRuntime}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedMigrator} IN SCHEMA ${quotedSchema}
       GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${quotedRuntime}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedMigrator} IN SCHEMA ${quotedSchema}
       GRANT EXECUTE ON FUNCTIONS TO ${quotedRuntime}`,
  );
}

async function grantControl(client: PoolClient, schemas: string[], control: string): Promise<void> {
  const quotedControl = identifier(control);
  for (const schema of schemas) {
    const quotedSchema = identifier(schema);
    await client.query(`REVOKE CREATE ON SCHEMA ${quotedSchema} FROM ${quotedControl}`);
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${quotedSchema} FROM ${quotedControl}`);
  }
  for (const grant of controlGrants) {
    if (!schemas.includes(grant.schema) || !(await relationExists(client, grant.schema, grant.relation))) continue;
    await client.query(`GRANT USAGE ON SCHEMA ${identifier(grant.schema)} TO ${quotedControl}`);
    await client.query(
      `GRANT ${grant.privileges} ON TABLE ${identifier(grant.schema)}.${identifier(grant.relation)} TO ${quotedControl}`,
    );
  }
  if (schemas.includes("assistant")) {
    await client.query(`GRANT USAGE ON SCHEMA "assistant" TO ${quotedControl}`);
    await client.query(`GRANT SELECT, DELETE ON ALL TABLES IN SCHEMA "assistant" TO ${quotedControl}`);
  }
}

async function verifyContract(
  client: PoolClient,
  schemas: string[],
  roles: { migrator: string; runtime: string; control: string },
): Promise<void> {
  const failures: string[] = [];
  const databaseOwner = await client.query<{ owner: string }>(
    `SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = current_database()`,
  );
  if (databaseOwner.rows[0]?.owner !== roles.migrator) {
    failures.push(`database is owned by ${databaseOwner.rows[0]?.owner ?? "unknown"}, not ${roles.migrator}`);
  }
  for (const role of Object.values(roles)) {
    const connect = await client.query<{ allowed: boolean }>(
      "SELECT has_database_privilege($1, current_database(), 'CONNECT') AS allowed",
      [role],
    );
    if (!connect.rows[0]?.allowed) failures.push(`${role} lacks CONNECT on the application database`);
  }
  for (const role of [roles.runtime, roles.control]) {
    const create = await client.query<{ allowed: boolean }>(
      "SELECT has_database_privilege($1, current_database(), 'CREATE') AS allowed",
      [role],
    );
    if (create.rows[0]?.allowed) failures.push(`${role} can create schemas in the application database`);
  }
  const owners = await client.query<{ kind: string; object: string; owner: string }>(
    `SELECT 'schema' AS kind, n.nspname AS object, pg_get_userbyid(n.nspowner) AS owner
       FROM pg_namespace n
      WHERE n.nspname = ANY($1::text[])
     UNION ALL
     SELECT 'type' AS kind, format('%I.%I', n.nspname, t.typname) AS object,
            pg_get_userbyid(t.typowner) AS owner
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = ANY($1::text[])
        AND t.typtype IN ('d', 'e')
     UNION ALL
     SELECT 'relation' AS kind, format('%I.%I', n.nspname, c.relname) AS object,
            pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1::text[])
        AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')`,
    [schemas],
  );
  for (const object of owners.rows) {
    if (object.owner !== roles.migrator) {
      failures.push(`${object.kind} ${object.object} is owned by ${object.owner}, not ${roles.migrator}`);
    }
    if (object.owner === roles.runtime || object.owner === roles.control) {
      failures.push(`${object.kind} ${object.object} is owned by a long-running role`);
    }
  }

  for (const schema of schemas.filter((name) => !excludedSchemas.has(name))) {
    const tables = await client.query<{ relation: string }>(
      `SELECT format('%I.%I', schemaname, tablename) AS relation
         FROM pg_tables WHERE schemaname = $1`,
      [schema],
    );
    for (const { relation } of tables.rows) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"] as const) {
        const result = await client.query<{ allowed: boolean }>(
          `SELECT has_table_privilege($1, $2, $3) AS allowed`,
          [roles.runtime, relation, privilege],
        );
        if (!result.rows[0]?.allowed) failures.push(`${roles.runtime} lacks ${privilege} on ${relation}`);
      }
    }
  }
  if (failures.length) {
    throw new Error(`Database release contract failed:\n${failures.join("\n")}`);
  }
}

export async function solidifyDatabasePermissions(): Promise<void> {
  const expected = {
    migrator: roleFromUrl("DATABASE_MIGRATION_URL"),
    runtime: roleFromUrl("DATABASE_URL"),
    control: roleFromUrl("DATABASE_CONTROL_URL"),
  };
  if (new Set(Object.values(expected)).size !== 3) {
    throw new Error("Migration, runtime, and control URLs must use three distinct PostgreSQL roles.");
  }

  const pool = new Pool({ ...migrationPoolConfig(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('taicho_database_release_contract'))");
    const identity = await client.query<{ current_user: string }>("SELECT current_user");
    if (identity.rows[0]?.current_user !== expected.migrator) {
      throw new Error(
        `Migration connection resolved to ${identity.rows[0]?.current_user ?? "unknown"}, expected ${expected.migrator}.`,
      );
    }
    const migrator = await roleAttributes(client, expected.migrator);
    const runtime = await roleAttributes(client, expected.runtime);
    const control = await roleAttributes(client, expected.control);
    if (migrator.superuser || !migrator.bypassRls || migrator.createDb || migrator.createRole) {
      throw new Error(`${migrator.role} must be NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE.`);
    }
    if (runtime.superuser || runtime.bypassRls || runtime.createDb || runtime.createRole) {
      throw new Error(`${runtime.role} must be NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE.`);
    }
    if (control.superuser || !control.bypassRls || control.createDb || control.createRole) {
      throw new Error(`${control.role} must be NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE.`);
    }

    const database = await client.query<{ name: string }>("SELECT current_database() AS name");
    const quotedDatabase = identifier(database.rows[0]!.name);
    await client.query(`REVOKE ALL ON DATABASE ${quotedDatabase} FROM PUBLIC`);
    await client.query(
      `GRANT CONNECT ON DATABASE ${quotedDatabase} TO ${identifier(expected.migrator)}, ${identifier(expected.runtime)}, ${identifier(expected.control)}`,
    );
    await client.query(
      `REVOKE CREATE, TEMPORARY ON DATABASE ${quotedDatabase} FROM ${identifier(expected.runtime)}, ${identifier(expected.control)}`,
    );

    const schemas = await applicationSchemas(client);
    const drizzle = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') AS exists",
    );
    const ownedSchemas = drizzle.rows[0]?.exists ? [...schemas, "drizzle"] : schemas;
    for (const schema of ownedSchemas) {
      await transferOwnership(client, schema, expected.migrator);
    }
    for (const schema of schemas) {
      await grantRuntime(client, schema, expected.runtime, expected.migrator);
    }
    await grantControl(client, schemas, expected.control);
    await verifyContract(client, ownedSchemas, expected);
    await client.query("COMMIT");
    console.info(
      `Database permissions solidified (${expected.migrator} owns DDL; ${expected.runtime} is runtime; ${expected.control} is control).`,
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const isDirectExecution = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isDirectExecution) {
  solidifyDatabasePermissions().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
