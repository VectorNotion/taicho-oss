import { runWithGraphOrganization } from "@content-automation/platform/data/organization-context";
import { migrationPoolConfig } from "@content-automation/database";
import { Pool } from "pg";
import { getContentDrafts } from "../data/content-repository";
import { getPublishingPool } from "../publishing/pool";
import { backfillLegacyMediaOwnership } from "./repository";

export async function backfillAllLegacyMediaOwnership(): Promise<{ bases: number; posts: number; orphans: number }> {
  const releasePool = new Pool({ ...migrationPoolConfig(), max: 1 });
  try {
    const result = await releasePool.query<{ organization_id: string }>(
    `SELECT DISTINCT organization_id
       FROM (
         SELECT organization_id
           FROM publishing.content_generation_runs
          WHERE content_base_id IS NULL AND draft_id IS NOT NULL
         UNION
         SELECT organization_id
           FROM publishing.content_assets
          WHERE content_base_id IS NULL AND draft_id IS NOT NULL
       ) AS legacy_media
      ORDER BY organization_id`,
    );
    let bases = 0;
    let posts = 0;
    for (const { organization_id: organizationId } of result.rows) {
      const drafts = await runWithGraphOrganization(organizationId, () => getContentDrafts());
      const byBase = new Map<string, string[]>();
      for (const draft of drafts) {
        const group = byBase.get(draft.ideaId) ?? [];
        group.push(draft.id);
        byBase.set(draft.ideaId, group);
      }
      for (const [contentBaseId, postIds] of byBase) {
        await backfillLegacyMediaOwnership(getPublishingPool(organizationId), contentBaseId, postIds);
        bases += 1;
        posts += postIds.length;
      }
    }

    const unresolved = await releasePool.query<{ count: string }>(
    `SELECT (
       (SELECT count(*) FROM publishing.content_generation_runs WHERE content_base_id IS NULL AND draft_id IS NOT NULL)
       +
       (SELECT count(*) FROM publishing.content_assets WHERE content_base_id IS NULL AND draft_id IS NOT NULL)
     )::text AS count`,
    );
    const unresolvedCount = Number(unresolved.rows[0]?.count ?? 0);
    return { bases, posts, orphans: unresolvedCount };
  } finally {
    await releasePool.end();
  }
}
