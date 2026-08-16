process.env.FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
process.env.FALKORDB_GRAPH = process.env.FALKORDB_GRAPH ?? "outreach_test";

import assert from "node:assert/strict";
import nodeTest, { after, before } from "node:test";
import {
  closeDriver,
  getSession,
  runWithGraphOrganization,
} from "@content-automation/platform/data/graph";
import {
  getAccountOpportunitySimilarityMatches,
  listAccountOpportunityAngles,
  listWorkspaceAccountOpportunityContexts,
  replaceAccountOpportunityAngles,
} from "../data/account-opportunity-repository";
import { syncOpportunityMatchEmbeddings } from "../services/account-opportunity-coverage";

const ORGANIZATION_ID = `outreach-opportunity-test-organization-${process.pid}`;

function inOrganization<T>(callback: () => T): T {
  return runWithGraphOrganization(ORGANIZATION_ID, callback);
}

function test(name: string, body: () => void | Promise<void>) {
  return nodeTest(name, () => inOrganization(body));
}

async function clearGraph() {
  const session = await getSession();
  try {
    await session.run("MATCH (n) DETACH DELETE n");
  } finally {
    await session.close();
  }
}

before(() => inOrganization(clearGraph));
after(() => inOrganization(async () => {
  await clearGraph();
  await closeDriver();
}));

test("account opportunities are replaced as a flat list and matched by exact cosine distance", async () => {
  const session = await getSession();
  try {
    await session.run(
      `CREATE (:Account {id: 'account-1', name: 'Northstar'})
       CREATE (:CatalogItem {
         id: 'catalog-near', name: 'Workflow automation', kind: 'service', status: 'active',
         summary: 'Reduce manual review work.'
       })
       CREATE (:CatalogItem {
         id: 'catalog-far', name: 'Unrelated service', kind: 'service', status: 'active',
         summary: 'A different commercial problem.'
       })
       CREATE (:CatalogItem {
         id: 'catalog-archived', name: 'Archived perfect match', kind: 'service', status: 'archived',
         opportunityEmbeddingModel: 'test-model', opportunityEmbeddingDimensions: 2,
         opportunityEmbedding: vecf32([1.0, 0.0])
       })
       CREATE (:ContentDraft {
         id: 'content-near', title: 'Automating operational reviews', type: 'blog_post',
         content: 'How to automate repeated review coordination.',
         status: 'published', publishedUrl: 'https://example.test/reviews'
       })
       CREATE (:ContentDraft {
         id: 'content-draft', title: 'Unpublished perfect match', type: 'blog_post',
         status: 'draft', publishedUrl: 'https://example.test/draft',
         opportunityEmbeddingModel: 'test-model', opportunityEmbeddingDimensions: 2,
         opportunityEmbedding: vecf32([1.0, 0.0])
       })`,
    );
    await session.run(
      `MATCH (account:Account {id: 'account-1'})
       CREATE (account)-[:HAS_SCORE]->(:AccountScore {
         contextKey: 'workspace', icpScore: 82, timingScore: 67, hardExcluded: false
       })`,
    );
  } finally {
    await session.close();
  }

  const embeddingConfig = {
    embeddingUrl: "https://embedding.test",
    embeddingModel: "test-model",
    embeddingDimensions: 2,
    queryInputType: "query",
    documentInputType: "passage",
  };
  const embeddedTexts: string[] = [];
  await syncOpportunityMatchEmbeddings(embeddingConfig, {
    embed: async (_config, texts, inputType) => {
      assert.equal(inputType, "passage");
      embeddedTexts.push(...texts);
      return texts.map((text) => {
        if (text.includes("Workflow automation")) return [1, 0];
        if (text.includes("Automating operational reviews")) return [0.9, 0.1];
        return [0, 1];
      });
    },
  });
  assert.equal(embeddedTexts.length, 3, "only active Catalog and published sendable content are embedded");
  await syncOpportunityMatchEmbeddings(embeddingConfig, {
    embed: async (_config, texts) => {
      assert.deepEqual(texts, [], "unchanged source embeddings are reused by content hash");
      return [];
    },
  });

  await replaceAccountOpportunityAngles("account-1", [{
    id: "opportunity-old",
    angle: "Reduce manual operational review coordination.",
    sourceDimensionKeys: ["human_process_intensity"],
    evidence: ["https://example.test/evidence"],
    evidenceConfidence: 0.8,
    researchRunId: "research-1",
    generatedAt: "2026-08-16T00:00:00.000Z",
    embedding: [1, 0],
    embeddingModel: embeddingConfig.embeddingModel,
    embeddingDimensions: embeddingConfig.embeddingDimensions,
  }]);

  const matches = await getAccountOpportunitySimilarityMatches({
    accountId: "account-1",
    embeddingModel: "test-model",
    embeddingDimensions: 2,
  });
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0]?.solutionMatches.map((match) => match.catalogItemId), [
    "catalog-near",
    "catalog-far",
  ]);
  assert.deepEqual(matches[0]?.contentMatches.map((match) => match.contentId), ["content-near"]);
  assert.ok((matches[0]?.solutionMatches[0]?.similarity ?? 0) > 0.99);
  assert.equal(matches[0]?.solutionMatches[0]?.summary, "Reduce manual review work.");

  const contexts = await listWorkspaceAccountOpportunityContexts();
  assert.equal(contexts.length, 1);
  assert.deepEqual(contexts[0]?.account, {
    id: "account-1",
    name: "Northstar",
    icpScore: 82,
    timingScore: 67,
    hardExcluded: false,
  });

  await replaceAccountOpportunityAngles("account-1", [{
    id: "opportunity-new",
    angle: "Create a repeatable review workflow.",
    sourceDimensionKeys: ["human_process_intensity"],
    evidence: [],
    evidenceConfidence: 0.7,
    researchRunId: "research-2",
    generatedAt: "2026-08-16T01:00:00.000Z",
    embedding: [1, 0],
    embeddingModel: "test-model",
    embeddingDimensions: 2,
  }]);

  assert.deepEqual(
    (await listAccountOpportunityAngles("account-1")).map((item) => item.id),
    ["opportunity-new"],
  );
});

test("account opportunity lists are isolated by organization graph", async () => {
  const otherOrganizationId = `${ORGANIZATION_ID}-other`;
  const other = await runWithGraphOrganization(otherOrganizationId, () =>
    listAccountOpportunityAngles("account-1"));
  assert.deepEqual(other, []);
});
