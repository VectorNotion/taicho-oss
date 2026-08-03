import type { Pool } from "pg";
import {
  assetsInCascade as assetsTable,
  databaseFor,
} from "@content-automation/database";
import { sql } from "drizzle-orm";
import { runWithGraphOrganization } from "@content-automation/platform/data/organization-context";
import { listPublishedWorkspaceContent } from "@content-automation/platform/workspace/content";
import type { AssetInput } from "../domain/types";

/**
 * The content sync boundary (ADR 0006): Cascade pulls published assets from
 * the content engine and snapshots them locally. The engine renders only
 * from the local assets table, never from a foreign store.
 */
export interface ContentSource {
  listPublished(): Promise<AssetInput[]>;
}

/** In-memory source for tests, seeds, and manual curation. */
export class StaticContentSource implements ContentSource {
  constructor(private readonly assets: AssetInput[]) {}
  async listPublished(): Promise<AssetInput[]> {
    return this.assets;
  }
}

/** Live workspace source used by Nurture without importing Content internals. */
export class WorkspaceContentSource implements ContentSource {
  constructor(private readonly organizationId: string) {}

  async listPublished(): Promise<AssetInput[]> {
    const items = await runWithGraphOrganization(
      this.organizationId,
      listPublishedWorkspaceContent,
    );
    return items.map((item) => ({
      sourceId: item.id,
      type: item.format ?? "content",
      title: item.title,
      url: item.publishedUrl,
      topics: [],
      publishedAt: item.publishedAt ? new Date(item.publishedAt) : undefined,
    }));
  }
}

export async function syncAssets(pool: Pool, source: ContentSource): Promise<{ synced: number }> {
  const assets = await source.listPublished();
  const db = databaseFor(pool);
  for (const asset of assets) {
    await db.insert(assetsTable).values({
      source_id: asset.sourceId,
      type: asset.type,
      title: asset.title,
      url: asset.url,
      topics: asset.topics,
      published_at: asset.publishedAt?.toISOString() ?? null,
    }).onConflictDoUpdate({
      target: [assetsTable.organization_id, assetsTable.source_id],
      set: {
        type: sql`excluded.type`,
        title: sql`excluded.title`,
        url: sql`excluded.url`,
        topics: sql`excluded.topics`,
        published_at: sql`excluded.published_at`,
        synced_at: sql`now()`,
      },
    });
  }
  return { synced: assets.length };
}
