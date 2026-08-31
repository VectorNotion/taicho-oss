import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const ddl = /\b(?:CREATE\s+(?:TABLE|SCHEMA|INDEX|POLICY)|ALTER\s+TABLE|DROP\s+(?:TABLE|SCHEMA)|GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|USAGE))\b/i;
const payloadMigrationPrefix = "apps/cms/src/migrations/";
const approvedDirectPgScripts = new Set([
  // A one-shot migration tool must preserve legacy Payload password hashes and salts,
  // fields that the Payload Local API deliberately does not expose for writes.
  "apps/cms/scripts/import-legacy-control-plane.ts",
  // One-shot, pre-cutover evidence export reads tables that are intentionally
  // absent from the post-cutover schema and Payload configuration.
  "apps/cms/scripts/export-model-retirement-evidence.ts",
  // These two files execute only inside the short-lived release Job: flow owns
  // its raw SQL schema and the permission reconciler owns dynamic catalog DDL.
  "packages/flow/data/schema.ts",
  "packages/database/permissions.ts",
  "packages/flow/data/automation-repository.ts",
  // One-shot release backfill: discovers organization IDs only, then re-enters
  // the organization-scoped media repository for every mutable operation.
  "products/content-generator/media/backfill.ts",
  // ID-only work discovery for the ontology curation interval; tenant payloads
  // stay behind the per-organization graph and capability seams.
  "packages/capabilities/ontology-curation.ts",
]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        ["node_modules", ".next", ".turbo", "dist", "build", "test", "__tests__"].includes(entry.name)
        || entry.name.startsWith("tests")
      ) return [];
      return sourceFiles(path);
    }
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  }));
  return nested.flat();
}

test("database DDL exists only in migrations and the short-lived release reconciler", async () => {
  const files = (
    await Promise.all(["apps", "packages", "products"].map(sourceFiles))
  ).flat();
  const violations = [];

  for (const file of files) {
    if (file.startsWith(payloadMigrationPrefix)) continue;
    if (["packages/flow/data/schema.ts", "packages/database/permissions.ts"].includes(file)) continue;
    if (ddl.test(await readFile(file, "utf8"))) violations.push(file);
  }

  assert.deepEqual(violations, [], `Runtime DDL found in: ${violations.join(", ")}`);
});

test("PostgreSQL access does not bypass Drizzle with direct pg query calls", async () => {
  const files = (
    await Promise.all(["apps", "packages", "products"].map(sourceFiles))
  ).flat();
  const violations = [];
  const importsPg = /(?:from\s+["']pg["']|require\(\s*["']pg["']\s*\))/;
  const callsQuery = /\.query\s*(?:<[^>]*>)?\s*\(/;

  for (const file of files) {
    if (approvedDirectPgScripts.has(file)) continue;
    const source = await readFile(file, "utf8");
    if (importsPg.test(source) && callsQuery.test(source)) violations.push(file);
  }

  assert.deepEqual(violations, [], `Direct pg query calls found in: ${violations.join(", ")}`);
});

test("the canonical Drizzle migration chain is checked in", async () => {
  const [manifest, journal] = await Promise.all([
    readFile("package.json", "utf8"),
    readFile("packages/database/migrations/meta/_journal.json", "utf8"),
  ]);
  assert.match(manifest, /"db:migrate"/);
  assert.deepEqual(
    JSON.parse(journal).entries.map((entry) => entry.tag),
    [
      "0000_baseline_existing_schema",
      "0001_remove_retired_automation_and_sync",
      "0002_force_tenant_row_level_security",
      "0003_amusing_forgotten_one",
      "0004_colorful_colossus",
      "0005_external_api_oauth_platform",
      "0006_violet_baron_strucker",
      "0007_calm_shotgun",
      "0008_restore_runtime_database_grants",
      "0009_restore_capability_admin_grants",
      "0010_add_billing_promotions",
      "0011_add_outreach_meeting_intelligence",
      "0012_expand_lead_insight_reasons",
      "0013_add_recall_meeting_provider",
      "0014_add_call_recording",
      "0015_register_call_recording_oauth_client",
      "0016_use_call_recording_loopback_oauth",
      "0017_drop_call_recording_backend",
      "0018_add_outreach_lead_source_identities",
      "0019_rename_lead_to_prospect",
      "0020_add_action_items",
      "0021_action_items_followup_unique",
      "0022_grant_renamed_outreach_tables",
      "0023_restore_jobs_runtime_grant",
      "0024_restore_jobs_admin_grant",
      "0025_register_prospect_capture_oauth_client",
      "0026_restore_mastra_agent_workflow_snapshots",
      "0027_drop_rate_limit_oauth_client_fk",
      "0028_grant_cascade_admin_missing_tables",
      "0029_durable_knowledge_event_projection",
      "0030_intelligence_artifact_lineage",
      "0031_organization_knowledge_module_overlays",
      "0032_restore_knowledge_module_runtime_grants",
      "0033_workspace_calendar_projection",
      "0034_drop_orphaned_cascade_tables",
      "0035_parallel_wolfpack",
      "0036_even_sugar_man",
      "0037_cold_miss_america",
      "0038_funnel_run_enabled",
      "0039_restore_automation_schema",
      "0040_wonderful_puppet_master",
      "0041_durable_page_guide_receipts",
      "0042_global_page_guide_receipts",
      "0043_sticky_iron_lad",
      "0044_content_base_media",
      "0045_pretty_gauntlet",
    ],
  );
});

test("page-guide receipts become global without losing cross-workspace history", async () => {
  const migration = await readFile(
    "packages/database/migrations/0042_global_page_guide_receipts.sql",
    "utf8",
  );
  assert.match(migration, /PRIMARY KEY\("user_id", "guide_key"\)/);
  assert.match(migration, /GROUP BY "user_id", "guide_key"/);
  assert.match(migration, /sum\("open_count"\)/);
  assert.match(migration, /latest_dismissal/);
  assert.match(migration, /DROP TABLE "page_guide_receipts"/);
  assert.doesNotMatch(migration, /DISABLE ROW LEVEL SECURITY|BYPASSRLS|SUPERUSER/i);
});

test("pricing CI bootstraps the same three release identities before applying migrations", async () => {
  let workflow;
  try {
    workflow = await readFile(".github/workflows/docker.yml", "utf8");
  } catch {
    return; // Private CI workflow; absent from the public mirror export.
  }
  assert.match(workflow, /\["taicho_migrator", "BYPASSRLS"\]/);
  assert.match(workflow, /\["taicho_runtime", "NOBYPASSRLS"\]/);
  assert.match(workflow, /\["taicho_control", "BYPASSRLS"\]/);
  assert.ok(
    workflow.indexOf('name: Create release database identities')
      < workflow.indexOf('name: Migrate pricing test database'),
  );
});

test("the production migration image contains its executor and the release gate fails fast", async () => {
  let databasePackage, entrypoint, releaseGate;
  try {
    [databasePackage, entrypoint, releaseGate] = await Promise.all([
      readFile("packages/database/package.json", "utf8").then(JSON.parse),
      readFile("docker/entrypoints/database-migrate.sh", "utf8"),
      readFile("ops/k8s/run-database-migrations.sh", "utf8"),
    ]);
  } catch {
    return; // Private release plumbing; absent from the public mirror export.
  }

  assert.equal(databasePackage.dependencies.tsx, "^4.23.1");
  assert.equal(databasePackage.devDependencies.tsx, undefined);
  assert.match(entrypoint, /packages\/database\/node_modules\/\.bin\/tsx/);
  assert.match(releaseGate, /jsonpath='\{\.status\.failed\}'/);
  assert.match(releaseGate, /database migration job failed/);
  assert.doesNotMatch(releaseGate, /wait --for=condition=complete/);
});

test("the cascade simplification drop retires only orphaned cascade tables", async () => {
  const migration = await readFile(
    "packages/database/migrations/0034_drop_orphaned_cascade_tables.sql",
    "utf8",
  );
  const drops = [...migration.matchAll(/DROP TABLE "([^"]+)"\."[^"]+"/gi)];
  assert.equal(drops.length, 18);
  for (const [, schema] of drops) assert.equal(schema, "cascade");
  for (const live of ["funnels", "funnel_members", "contacts", "plain_text_emails"]) {
    assert.doesNotMatch(migration, new RegExp(`DROP TABLE "cascade"\\."${live}"`, "i"));
  }
  assert.doesNotMatch(migration, /DISABLE ROW LEVEL SECURITY|BYPASSRLS|SUPERUSER/i);
});

test("the workspace calendar projection is tenant-scoped and payload-blind to the control plane", async () => {
  const migration = await readFile(
    "packages/database/migrations/0033_workspace_calendar_projection.sql",
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "calendar_entries"/i);
  assert.match(migration, /UNIQUE\("organization_id", "module_key", "source_id"\)/i);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/i);
  assert.match(migration, /calendar_entries_organization_policy/i);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE[^;]*"calendar_entries" TO jobs_app/is);
  assert.doesNotMatch(migration, /TO jobs_admin|BYPASSRLS|DISABLE ROW LEVEL SECURITY/i);

  const permissions = await readFile("packages/database/permissions.ts", "utf8");
  assert.match(permissions, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES/);
  assert.match(permissions, /ALTER DEFAULT PRIVILEGES FOR ROLE/);
});

test("organization knowledge module overlays are tenant-scoped and capability-managed", async () => {
  const migration = await readFile(
    "packages/database/migrations/0031_organization_knowledge_module_overlays.sql",
    "utf8",
  );
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /knowledge_module_manifest_organization_policy/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE[^;]*TO capability_app/is);
  assert.doesNotMatch(migration, /BYPASSRLS|DISABLE ROW LEVEL SECURITY|TO jobs_admin/i);
});

test("knowledge module storage and publishing feedback have tenant runtime grants", async () => {
  const migration = await readFile(
    "packages/database/migrations/0032_restore_knowledge_module_runtime_grants.sql",
    "utf8",
  );
  for (const role of ["jobs_app", "capability_app", "mcp_app"]) {
    assert.match(migration, new RegExp(`['\"]${role}['\"]`));
  }
  for (const relation of [
    "knowledge_module_manifest",
    "metric_ingest_tokens",
    "post_metric_snapshots",
  ]) {
    assert.match(migration, new RegExp(`['\"]${relation}['\"]`));
  }
  assert.doesNotMatch(migration, /DISABLE\s+ROW\s+LEVEL\s+SECURITY|BYPASSRLS|SUPERUSER/i);
});

test("intelligence artifacts preserve exact knowledge lineage", async () => {
  const migration = await readFile(
    "packages/database/migrations/0030_intelligence_artifact_lineage.sql",
    "utf8",
  );
  assert.match(migration, /ADD COLUMN "used_claim_ids" text\[\].*NOT NULL/is);
  assert.match(migration, /ADD COLUMN "used_evidence_ids" text\[\].*NOT NULL/is);
});

test("the knowledge event projector has replay-safe storage and ID-only control-plane discovery", async () => {
  const migration = await readFile(
    "packages/database/migrations/0029_durable_knowledge_event_projection.sql",
    "utf8",
  );
  assert.match(migration, /product_events_internal_idempotency_key/);
  assert.match(migration, /'projected'::text/);
  assert.match(migration, /GRANT SELECT \("id", "organization_id", "name", "occurred_at"\)/i);
  assert.doesNotMatch(migration, /GRANT SELECT\s+ON TABLE "product_events"/i);
  assert.doesNotMatch(migration, /GRANT[^;]*(?:INSERT|UPDATE|DELETE|TRUNCATE)[^;]*TO jobs_admin/i);
});

test("runtime grants for post-baseline tables are migration-managed", async () => {
  const migration = await readFile(
    "packages/database/migrations/0008_restore_runtime_database_grants.sql",
    "utf8",
  );
  for (const role of ["jobs_app", "capability_app", "mcp_app", "publishing_app", "cascade_app"]) {
    assert.match(migration, new RegExp(`['\"]${role}['\"]`));
  }
  for (const relation of [
    "attention_items",
    "intelligence_api_tokens",
    "intelligence_artifact_outcomes",
    "intelligence_artifacts",
    "intelligence_runs",
    "notification_preferences",
    "notification_recipients",
    "product_event_projections",
    "external_api_rate_limit",
    "external_webhook_delivery",
    "external_webhook_endpoint",
    "content_assets",
    "content_generation_runs",
    "funnel_members",
    "plain_text_emails",
  ]) {
    assert.match(migration, new RegExp(`['\"]${relation}['\"]`));
  }
  assert.match(migration, /job_workspace_member_ids/);
  assert.doesNotMatch(migration, /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.doesNotMatch(migration, /BYPASSRLS|SUPERUSER/i);
});

test("the tenant-scoped jobs runtime can manage durable job lifecycle rows", async () => {
  const migration = await readFile(
    "packages/database/migrations/0023_restore_jobs_runtime_grant.sql",
    "utf8",
  );
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "jobs" TO jobs_app/i);
  assert.doesNotMatch(migration, /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.doesNotMatch(migration, /BYPASSRLS|SUPERUSER/i);

  const permissions = await readFile("packages/database/permissions.ts", "utf8");
  assert.match(permissions, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES/);
});

test("the jobs control plane has bounded discovery and cleanup privileges", async () => {
  const migration = await readFile(
    "packages/database/migrations/0024_restore_jobs_admin_grant.sql",
    "utf8",
  );
  assert.match(migration, /GRANT SELECT, DELETE ON TABLE "jobs" TO jobs_admin/i);
  assert.doesNotMatch(migration, /GRANT[^;]*(?:INSERT|UPDATE|TRUNCATE)/i);
  assert.doesNotMatch(migration, /SUPERUSER/i);

  const permissions = await readFile("packages/database/permissions.ts", "utf8");
  assert.match(permissions, /relation: "jobs", privileges: "SELECT, DELETE"/);
  assert.match(permissions, /control\.bypassRls/);
  assert.doesNotMatch(permissions, /JOBS_ADMIN_DATABASE_URL/);
});

test("capability control-plane grants are migration-managed and column-restricted", async () => {
  const migration = await readFile(
    "packages/database/migrations/0009_restore_capability_admin_grants.sql",
    "utf8",
  );
  for (const role of ["capability_admin", "mcp_admin"]) {
    assert.match(migration, new RegExp(`['\"]${role}['\"]`));
  }
  for (const relation of [
    "mcp_operation",
    "mcp_media_upload",
    "external_webhook_delivery",
    "external_api_rate_limit",
  ]) {
    assert.match(migration, new RegExp(`['\"]${relation}['\"]`));
  }
  assert.match(migration, /GRANT SELECT \(/i);
  assert.match(migration, /GRANT SELECT \("expires_at"\), DELETE/i);
  assert.doesNotMatch(migration, /GRANT SELECT, INSERT, UPDATE, DELETE/i);
  assert.doesNotMatch(migration, /BYPASSRLS|SUPERUSER/i);
});

test("Sales Navigator source identities are tenant-scoped and duplicate-safe", async () => {
  const migration = await readFile(
    "packages/database/migrations/0018_add_outreach_lead_source_identities.sql",
    "utf8",
  );
  assert.match(migration, /PRIMARY KEY\("organization_id", "provider", "source_id"\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/i);
  assert.match(migration, /current_setting\('app\.organization_id'/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE/i);
  assert.doesNotMatch(migration, /GRANT[^;]*DELETE/i);
  assert.doesNotMatch(migration, /BYPASSRLS|SUPERUSER/i);
});
