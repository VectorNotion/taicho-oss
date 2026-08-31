import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { migrationPoolConfig } from "@content-automation/database";
import { Pool } from "pg";
import {
  attachContentAssetToPost,
  createContentAsset,
  createCreativeGenerationRun,
  deleteContentAsset,
  detachAllContentAssetsFromPost,
  detachContentAssetFromPost,
  getContentAsset,
  listContentAssetsForPost,
  listContentMediaUsageForBase,
  markCreativeRunPromptReady,
} from "../media/repository";

test("Content Base media survives Post detach and supports many-to-many usage", async () => {
  const organizationId = `media_test_${randomUUID()}`;
  const contentBaseId = `base_${randomUUID()}`;
  const postA = `post_${randomUUID()}`;
  const postB = `post_${randomUUID()}`;
  const pool = new Pool({
    ...migrationPoolConfig(),
    options: `-csearch_path=publishing -capp.organization_id=${organizationId}`,
  });

  let runId: string | undefined;
  try {
    const preparingRun = await createCreativeGenerationRun(pool, {
      organizationId,
      contentBaseId,
      mediaKind: "image",
      visualType: "diagram",
      visualBrief: { kind: "image", visualType: "diagram", exactOnMediaText: "One durable asset" },
      compiledPrompt: "",
      provider: "openrouter",
      deploymentId: "x-ai/grok-imagine-image-quality",
      modelKey: "x-ai/grok-imagine-image-quality",
      providerInput: {},
      creditReservationId: randomUUID(),
      estimatedCredits: 40,
      createdBy: "test-user",
      status: "preparing",
    });
    assert.equal(preparingRun.status, "preparing", "the run is durable before prompt preparation finishes");
    const run = await markCreativeRunPromptReady(pool, preparingRun.id, {
      compiledPrompt: "Render one durable asset.",
      providerInput: { prompt: "Render one durable asset." },
      providerParams: { resolution: "1K" },
    });
    assert.ok(run);
    assert.equal(run.status, "queued");
    assert.equal(run.compiledPrompt, "Render one durable asset.");
    runId = run.id;
    assert.equal(new Date(run.createdAt).toISOString(), run.createdAt, "run timestamps cross the API boundary as ISO datetimes");
    const asset = await createContentAsset(pool, {
      organizationId,
      generationRunId: run.id,
      outputIndex: 0,
      contentBaseId,
      mediaKind: "image",
      visualType: "diagram",
      fileName: "diagram.png",
      mimeType: "image/png",
      r2Key: `generated/${run.id}/diagram.png`,
      width: 1200,
      height: 1200,
      byteSize: 128,
      description: "A durable diagram.",
      altText: "A diagram showing one durable asset.",
    });
    assert.equal(new Date(asset.createdAt).toISOString(), asset.createdAt, "asset timestamps cross the API boundary as ISO datetimes");

    const firstLink = await attachContentAssetToPost(pool, { organizationId, postId: postA, assetId: asset.id });
    assert.equal(new Date(firstLink.createdAt).toISOString(), firstLink.createdAt, "usage timestamps cross the API boundary as ISO datetimes");
    await attachContentAssetToPost(pool, { organizationId, postId: postB, assetId: asset.id });
    await attachContentAssetToPost(pool, { organizationId, postId: postA, assetId: asset.id });

    assert.equal((await listContentAssetsForPost(pool, postA)).length, 1, "attaching twice is idempotent");
    assert.equal((await listContentAssetsForPost(pool, postB))[0]?.asset.contentBaseId, contentBaseId);
    assert.deepEqual(
      (await listContentMediaUsageForBase(pool, contentBaseId)).map(({ postId }) => postId).sort(),
      [postA, postB].sort(),
    );

    assert.equal(await detachContentAssetFromPost(pool, postA, asset.id), true);
    assert.ok(await getContentAsset(pool, asset.id), "detaching a Post keeps the Base-owned asset");
    assert.equal((await listContentAssetsForPost(pool, postB)).length, 1);

    await attachContentAssetToPost(pool, { organizationId, postId: postA, assetId: asset.id });
    await detachAllContentAssetsFromPost(pool, postA);
    assert.ok(await getContentAsset(pool, asset.id), "deleting a Post's links keeps the Base-owned asset");

    assert.equal(await deleteContentAsset(pool, asset.id), true);
    assert.equal(await getContentAsset(pool, asset.id), null);
    assert.equal((await listContentAssetsForPost(pool, postB)).length, 0, "asset deletion cascades usage links only");
  } finally {
    if (runId) await pool.query("DELETE FROM publishing.content_generation_runs WHERE id = $1", [runId]);
    await pool.end();
  }
});
