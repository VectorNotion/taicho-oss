import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const ddl = /\b(?:CREATE\s+(?:TABLE|SCHEMA|INDEX|POLICY)|ALTER\s+TABLE|DROP\s+(?:TABLE|SCHEMA)|GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|USAGE))\b/i;

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

test("database DDL exists only in generated Drizzle migrations", async () => {
  const files = (
    await Promise.all(["apps", "packages", "products"].map(sourceFiles))
  ).flat();
  const violations = [];

  for (const file of files) {
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
    ],
  );
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
