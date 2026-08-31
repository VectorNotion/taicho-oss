import { getSession } from "@content-automation/platform/data/graph";
import type { ContentIdea } from "../domain/content";
import type { ContentAsset, CreativeGenerationRun } from "./repository";

export async function recordMediaAssetLineage(input: {
  base: ContentIdea;
  run: CreativeGenerationRun;
  asset: ContentAsset;
}): Promise<void> {
  const session = await getSession();
  const { base, run, asset } = input;
  try {
    await session.run(
      `MATCH (base:ContentIdea {id: $baseId})
       SET base:ContentBase
       MERGE (asset:MediaAsset {id: $assetId})
       SET asset.contentBaseId = $baseId,
           asset.generationRunId = $runId,
           asset.kind = $kind,
           asset.visualType = $visualType,
           asset.description = $description,
           asset.altText = $altText,
           asset.mimeType = $mimeType,
           asset.provider = $provider,
           asset.deploymentId = $deploymentId,
           asset.createdAt = localdatetime($createdAt),
           asset.updatedAt = localdatetime()
       MERGE (base)-[:HAS_MEDIA]->(asset)`,
      {
        baseId: base.id, assetId: asset.id, runId: run.id, kind: asset.mediaKind,
        visualType: asset.visualType, description: asset.description, altText: asset.altText,
        mimeType: asset.mimeType, provider: run.provider, deploymentId: run.deploymentId,
        createdAt: asset.createdAt.replace(/Z$/, ""),
      },
    );

    if (asset.parentAssetId) {
      await session.run(
        `MATCH (asset:MediaAsset {id: $assetId}), (parent:MediaAsset {id: $parentId})
         MERGE (asset)-[:DERIVED_FROM]->(parent)`,
        { assetId: asset.id, parentId: asset.parentAssetId },
      );
    }

    if (asset.originPostId) {
      await session.run(
        `MATCH (base:ContentIdea {id: $baseId}), (post:ContentDraft {id: $postId}), (asset:MediaAsset {id: $assetId})
         MERGE (base)-[:HAS_POST]->(post)
         MERGE (post)-[:USES_MEDIA]->(asset)`,
        { baseId: base.id, postId: asset.originPostId, assetId: asset.id },
      );
    }

    await session.run(
      `MATCH (base:ContentIdea {id: $baseId})-[:SOURCED_FROM]->(source:ResearchItem), (asset:MediaAsset {id: $assetId})
       MERGE (asset)-[:GROUNDED_IN]->(source)`,
      { baseId: base.id, assetId: asset.id },
    );

    if (base.sourceClaimIds?.length) {
      await session.run(
        `MATCH (asset:MediaAsset {id: $assetId})
         UNWIND $claimIds AS claimId
         MATCH (claim:Claim {id: claimId})
         MERGE (asset)-[:GROUNDED_IN]->(claim)
         WITH asset, claim
         OPTIONAL MATCH (claim)-[:SUBJECT|OBJECT]->(entity:CanonicalEntity)
         FOREACH (_ IN CASE WHEN entity IS NULL THEN [] ELSE [1] END |
           MERGE (asset)-[:GROUNDED_IN]->(entity))`,
        { assetId: asset.id, claimIds: base.sourceClaimIds },
      );
    }

    if (base.sourceEvidenceIds?.length) {
      await session.run(
        `MATCH (asset:MediaAsset {id: $assetId})
         UNWIND $evidenceIds AS evidenceId
         MATCH (evidence:Evidence {id: evidenceId})
         MERGE (asset)-[:GROUNDED_IN]->(evidence)`,
        { assetId: asset.id, evidenceIds: base.sourceEvidenceIds },
      );
    }
  } finally {
    await session.close();
  }
}

export async function recordPostMediaUsage(input: {
  baseId: string; postId: string; assetId: string; generatedFrom?: boolean;
}): Promise<void> {
  const session = await getSession();
  try {
    await session.run(
      `MATCH (base:ContentIdea {id: $baseId}), (post:ContentDraft {id: $postId}), (asset:MediaAsset {id: $assetId})
       SET base:ContentBase
       MERGE (base)-[:HAS_POST]->(post)
       MERGE (post)-[:USES_MEDIA]->(asset)
       FOREACH (_ IN CASE WHEN $generatedFrom THEN [1] ELSE [] END |
         MERGE (post)-[:GENERATED_FROM_MEDIA]->(asset))`,
      { ...input, generatedFrom: input.generatedFrom === true },
    );
  } finally {
    await session.close();
  }
}

export async function removePostMediaUsage(postId: string, assetId: string): Promise<void> {
  const session = await getSession();
  try {
    await session.run(
      `MATCH (:ContentDraft {id: $postId})-[relation:USES_MEDIA|GENERATED_FROM_MEDIA]->(:MediaAsset {id: $assetId})
       DELETE relation`,
      { postId, assetId },
    );
  } finally {
    await session.close();
  }
}

export async function removeMediaAssetLineage(assetId: string): Promise<void> {
  const session = await getSession();
  try {
    await session.run(`MATCH (asset:MediaAsset {id: $assetId}) DETACH DELETE asset`, { assetId });
  } finally {
    await session.close();
  }
}
