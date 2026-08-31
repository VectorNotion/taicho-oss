process.env.FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { closeDriver, getSession, runWithGraphOrganization } from "@content-automation/platform/data/graph";
import type { ContentIdea } from "../domain/content";
import {
  recordMediaAssetLineage,
  recordPostMediaUsage,
  removeMediaAssetLineage,
  removePostMediaUsage,
} from "../media/graph";
import type { ContentAsset, CreativeGenerationRun } from "../media/repository";

function number(value: unknown): number {
  return typeof value === "object" && value !== null && "toNumber" in value
    ? (value as { toNumber: () => number }).toNumber()
    : Number(value);
}

test("media lineage materializes direct Content Base, Post, and source relationships", async () => {
  const suffix = randomUUID();
  const organizationId = `media-graph-${suffix}`;
  const baseId = `media-base-${suffix}`;
  const postId = `media-post-${suffix}`;
  const assetId = `media-asset-${suffix}`;
  const parentId = `media-parent-${suffix}`;
  const researchId = `media-research-${suffix}`;
  const claimId = `media-claim-${suffix}`;
  const evidenceId = `media-evidence-${suffix}`;
  const entityId = `media-entity-${suffix}`;
  const now = new Date().toISOString();

  await runWithGraphOrganization(organizationId, async () => {
    const session = await getSession();
    try {
      await session.run(
        `CREATE (base:ContentIdea {id: $baseId, title: 'Media Base'})
         CREATE (post:ContentDraft {id: $postId, ideaId: $baseId, title: 'Media Post'})
         CREATE (parent:MediaAsset {id: $parentId, description: 'Parent'})
         CREATE (research:ResearchItem {id: $researchId, title: 'Grounded research'})
         CREATE (claim:Claim {id: $claimId, status: 'accepted'})
         CREATE (evidence:Evidence {id: $evidenceId})
         CREATE (entity:CanonicalEntity {id: $entityId})
         CREATE (base)-[:SOURCED_FROM]->(research)
         CREATE (claim)-[:SUBJECT]->(entity)`,
        { baseId, postId, parentId, researchId, claimId, evidenceId, entityId },
      );
    } finally {
      await session.close();
    }

    const base: ContentIdea = {
      id: baseId,
      title: "Media Base",
      description: "A grounded Content Base.",
      rationale: "Test direct lineage.",
      priority: "high",
      status: "refined",
      sourceClaimIds: [claimId],
      sourceEvidenceIds: [evidenceId],
      createdAt: now,
      updatedAt: now,
    };
    const run = {
      id: randomUUID(), organizationId, contentBaseId: baseId, originPostId: postId,
      parentAssetId: parentId, legacyDraftId: null, templateKey: "diagram", templateVersion: 1,
      mediaKind: "image", visualType: "diagram", assetRole: "primary",
      visualBrief: { kind: "image", visualType: "diagram" }, compiledPrompt: "A diagram.",
      negativePrompt: null, renderSpec: null, rendererVersion: null,
      modelKey: "x-ai/grok-imagine-image-quality", deploymentId: "x-ai/grok-imagine-image-quality", provider: "openrouter", providerParams: {},
      providerRequestId: null, providerRequestUrl: null, providerStatusUrl: null,
      providerResultUrl: null, providerCancelUrl: null, status: "succeeded", progress: 100,
      input: {}, providerResult: null, error: null, creditReservationId: null,
      estimatedCredits: 40, actualCredits: 40, createdBy: "test-user", createdAt: now,
      startedAt: now, completedAt: now, updatedAt: now,
    } satisfies CreativeGenerationRun;
    const asset = {
      id: assetId, organizationId, generationRunId: run.id, outputIndex: 0,
      contentBaseId: baseId, originPostId: postId, parentAssetId: parentId, legacyDraftId: null,
      assetRole: "primary", mediaKind: "image", visualType: "diagram", fileName: "diagram.png",
      mimeType: "image/png", r2Key: "generated/test/diagram.png", width: 1200, height: 1200,
      durationMs: null, byteSize: 100, description: "A grounded diagram.",
      altText: "A grounded diagram using research.", metadata: {}, createdAt: now, updatedAt: now,
    } satisfies ContentAsset;

    await recordMediaAssetLineage({ base, run, asset });
    await recordPostMediaUsage({ baseId, postId, assetId });
    await recordPostMediaUsage({ baseId, postId, assetId, generatedFrom: true });

    const inspect = await getSession();
    try {
      const result = await inspect.run(
        `MATCH (base:ContentBase {id: $baseId})-[:HAS_MEDIA]->(asset:MediaAsset {id: $assetId})
         MATCH (base)-[:HAS_POST]->(post:ContentDraft {id: $postId})
         MATCH (post)-[:USES_MEDIA]->(asset)
         MATCH (post)-[:GENERATED_FROM_MEDIA]->(asset)
         MATCH (asset)-[:DERIVED_FROM]->(:MediaAsset {id: $parentId})
         MATCH (asset)-[:GROUNDED_IN]->(:ResearchItem {id: $researchId})
         MATCH (asset)-[:GROUNDED_IN]->(:Claim {id: $claimId})
         MATCH (asset)-[:GROUNDED_IN]->(:Evidence {id: $evidenceId})
         MATCH (asset)-[:GROUNDED_IN]->(:CanonicalEntity {id: $entityId})
         RETURN count(asset) AS matches`,
        { baseId, postId, assetId, parentId, researchId, claimId, evidenceId, entityId },
      );
      assert.equal(number(result.records[0]?.get("matches")), 1);
    } finally {
      await inspect.close();
    }

    await removePostMediaUsage(postId, assetId);
    const afterDetach = await getSession();
    try {
      const result = await afterDetach.run(
        `MATCH (base:ContentBase {id: $baseId})-[:HAS_MEDIA]->(asset:MediaAsset {id: $assetId})
         OPTIONAL MATCH (:ContentDraft {id: $postId})-[usage:USES_MEDIA|GENERATED_FROM_MEDIA]->(asset)
         RETURN count(asset) AS assets, count(usage) AS usages`,
        { baseId, postId, assetId },
      );
      assert.equal(number(result.records[0]?.get("assets")), 1);
      assert.equal(number(result.records[0]?.get("usages")), 0);
    } finally {
      await afterDetach.close();
    }

    await removeMediaAssetLineage(assetId);
    const cleanup = await getSession();
    try {
      const result = await cleanup.run(
        `MATCH (node) WHERE node.id IN $ids DETACH DELETE node RETURN count(node) AS removed`,
        { ids: [baseId, postId, parentId, researchId, claimId, evidenceId, entityId] },
      );
      assert.equal(number(result.records[0]?.get("removed")), 7);
    } finally {
      await cleanup.close();
    }
  });
  await closeDriver();
});
