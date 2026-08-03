import { publishingSchemaName } from "../publishing/pool";
import { adminPoolConfig, databaseFor, organization } from "@content-automation/database";
import { runMigrations } from "@content-automation/database/migrate";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { repairLegacyContentIdeaStatuses } from "../data/content-repository";
import { closeDriver, runWithGraphOrganization } from "@content-automation/platform/data/graph";
import { ensureWorkspaceContactLabels } from "@content-automation/platform/workspace/contacts";

const GRAPH_CLOSE_TIMEOUT_MS = 5_000;

async function closeGraphConnection(): Promise<void> {
  await Promise.race([
    closeDriver(),
    new Promise<void>((resolve) => {
      setTimeout(resolve, GRAPH_CLOSE_TIMEOUT_MS);
    }),
  ]);
}

async function main() {
  await runMigrations();
  // Cross-schema identity lookup must use the canonical admin connection.
  // The publishing admin pool intentionally restricts search_path to the
  // publishing schema and therefore cannot resolve public.organization.
  const pool = new Pool({ ...adminPoolConfig(), max: 1 });
  const e2eOrganizationSlug =
    process.env.NODE_ENV !== "production"
      ? process.env.CONTENT_MIGRATION_ORGANIZATION_SLUG
      : undefined;
  const organizationId = e2eOrganizationSlug
    ? (
        await databaseFor(pool)
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.slug, e2eOrganizationSlug))
          .limit(1)
      )[0]?.id
    : process.env.CONTENT_MIGRATION_ORGANIZATION_ID;
  if (!organizationId) {
    await pool.end();
    throw new Error(
      "CONTENT_MIGRATION_ORGANIZATION_ID is required for publishing and graph migration.",
    );
  }
  const skipGraph =
    process.env.NODE_ENV !== "production"
    && process.env.CONTENT_MIGRATION_SKIP_GRAPH === "1";

  console.log(`Publishing schema '${publishingSchemaName()}' is current.`);
  await pool.end();

  if (skipGraph) {
    console.log("Content graph migration skipped for deterministic E2E setup.");
    return;
  }

  try {
    const [repairedIdeas, promotedContacts] = await runWithGraphOrganization(
      organizationId,
      () => Promise.all([
        repairLegacyContentIdeaStatuses(),
        ensureWorkspaceContactLabels(),
      ]),
    );
    console.log(
      `Workspace graph is current (${repairedIdeas} legacy idea statuses repaired, ${promotedContacts} contacts promoted).`,
    );
  } finally {
    await closeGraphConnection();
  }
}

main()
  .then(() => {
    // This is a one-shot entrypoint migration. Force a clean exit after the
    // bounded graph shutdown so a stuck client close cannot block web startup.
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
