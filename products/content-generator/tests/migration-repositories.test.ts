/**
 * Integration tests for the 13 repository gaps added for the Mastra migration.
 *
 * Runs against local FalkorDB. All fixture nodes use ids
 * (or names/titles) prefixed "migtest-"; every such node is DETACH DELETE'd in
 * before() and after() so the suite is idempotent and self-cleaning.
 */
import assert from "node:assert/strict";
import nodeTest, { after, before } from "node:test";
import {
  closeDriver,
  getSession,
  runWithGraphOrganization,
} from "@content-automation/platform/data/graph";
import {
  createContentDraft,
  getScheduledContentDrafts,
  queryContentGaps,
  queryHighPerformingContent,
  queryRelatedPublishedContent,
  repairLegacyContentIdeaStatuses,
  updateContentDraft,
} from "../data/content-repository";
import {
  getEntitiesByProjectCount,
  getProjectProcessingState,
  markProjectProcessed,
  storeProjectEntity,
} from "../data/project-repository";
import {
  createResearchItemFromAgent,
  getRecentResearchItems,
  getResearchItemsByTopicIds,
  linkResearchToMatchingTopics,
} from "../data/research-repository";
import {
  linkTopicToEntities,
  linkTopicToResearch,
} from "../data/topic-repository";

const ORGANIZATION_ID = `content-migration-test-organization-${process.pid}`;

function inOrganization<T>(callback: () => T): T {
  return runWithGraphOrganization(ORGANIZATION_ID, callback);
}

function test(name: string, body: () => void | Promise<void>) {
  return nodeTest(name, () => inOrganization(body));
}

/** Run a Cypher statement in its own session (fixture setup / verification). */
async function run(cypher: string, params: Record<string, unknown> = {}) {
  const session = await getSession();
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

/** Remove everything this suite could have created. */
async function purgeMigTestNodes() {
  await run(
    `
    MATCH (n)
    WHERE coalesce(n.id, '') STARTS WITH 'migtest-'
       OR coalesce(n.name, '') STARTS WITH 'migtest-'
       OR coalesce(n.title, '') STARTS WITH 'migtest-'
    DETACH DELETE n
    `,
  );
}

before(() => inOrganization(purgeMigTestNodes));

after(() => inOrganization(async () => {
  await purgeMigTestNodes();
  await closeDriver();
}));

// ---------------------------------------------------------------------------
// project-repository: processing state + mark processed
// ---------------------------------------------------------------------------

test("getProjectProcessingState reflects markProjectProcessed and is null for unknown", async () => {
  await run(
    `CREATE (p:Project {id: 'migtest-proj-state', title: 'migtest-State', description: 'd'})`,
  );

  const before = await getProjectProcessingState("migtest-proj-state");
  assert.deepEqual(before, { processed: false, entityCount: 0 });

  assert.equal(await getProjectProcessingState("migtest-does-not-exist"), null);

  await markProjectProcessed("migtest-proj-state", 7);
  const after = await getProjectProcessingState("migtest-proj-state");
  assert.deepEqual(after, { processed: true, entityCount: 7 });
});

// ---------------------------------------------------------------------------
// project-repository: storeProjectEntity dedup + typed relationship
// ---------------------------------------------------------------------------

test("storeProjectEntity dedupes by (label, name) and writes the mapped typed rel", async () => {
  await run(
    `CREATE (p:Project {id: 'migtest-proj-ent', title: 'migtest-Ent', description: 'd'})`,
  );

  // Two calls with the same entity must reuse one node (dedup), not duplicate.
  await storeProjectEntity("migtest-proj-ent", { name: "migtest-React", type: "Framework" });
  await storeProjectEntity("migtest-proj-ent", { name: "migtest-React", type: "Framework" });

  const nodes = await run(
    `MATCH (e:Framework {name: 'migtest-React'}) RETURN count(e) as c, collect(e.id)[0] as id`,
  );
  assert.equal(nodes.records[0].get("c").toNumber(), 1);
  // Id follows the "{type_lower}-<uuid>" convention.
  assert.match(nodes.records[0].get("id"), /^framework-/);

  // Framework -> USES_FRAMEWORK, single MERGE'd edge.
  const rel = await run(
    `MATCH (:Project {id: 'migtest-proj-ent'})-[r:USES_FRAMEWORK]->(:Framework {name: 'migtest-React'})
     RETURN count(r) as c`,
  );
  assert.equal(rel.records[0].get("c").toNumber(), 1);

  // A different type maps to its own relationship (AIComponent -> IMPLEMENTS).
  await storeProjectEntity("migtest-proj-ent", { name: "migtest-RAG", type: "AIComponent" });
  const implemented = await run(
    `MATCH (:Project {id: 'migtest-proj-ent'})-[r:IMPLEMENTS]->(:AIComponent {name: 'migtest-RAG'})
     RETURN count(r) as c`,
  );
  assert.equal(implemented.records[0].get("c").toNumber(), 1);

  // Unknown entity types are rejected (no dynamic-label injection).
  await assert.rejects(
    storeProjectEntity("migtest-proj-ent", { name: "migtest-X", type: "Bogus" }),
    /Unknown project entity type/,
  );
});

// ---------------------------------------------------------------------------
// project-repository: getEntitiesByProjectCount aggregation
// ---------------------------------------------------------------------------

test("getEntitiesByProjectCount aggregates project counts for topic-bearing types only", async () => {
  await run(
    `CREATE (:Project {id: 'migtest-proj-a', title: 'migtest-Project A', description: 'd'})
     CREATE (:Project {id: 'migtest-proj-b', title: 'migtest-Project B', description: 'd'})`,
  );

  // Same AIComponent referenced by two projects.
  await storeProjectEntity("migtest-proj-a", { name: "migtest-VectorSearch", type: "AIComponent" });
  await storeProjectEntity("migtest-proj-b", { name: "migtest-VectorSearch", type: "AIComponent" });
  // A Feature on one project.
  await storeProjectEntity("migtest-proj-a", { name: "migtest-Auth", type: "Feature" });
  // A Database — must be excluded from the aggregation.
  await storeProjectEntity("migtest-proj-a", { name: "migtest-Postgres", type: "Database" });

  const rows = await getEntitiesByProjectCount();
  const byName = new Map(rows.map((r) => [r.name, r]));

  const vector = byName.get("migtest-VectorSearch");
  assert.ok(vector, "AIComponent entity present");
  assert.equal(vector!.entityType, "AIComponent");
  assert.equal(vector!.projectCount, 2);
  assert.deepEqual([...vector!.projectNames].sort(), ["migtest-Project A", "migtest-Project B"]);

  const auth = byName.get("migtest-Auth");
  assert.ok(auth, "Feature entity present");
  assert.equal(auth!.projectCount, 1);

  assert.equal(byName.has("migtest-Postgres"), false, "Database type excluded");
});

// ---------------------------------------------------------------------------
// research-repository: createResearchItemFromAgent dedup + YIELDED
// ---------------------------------------------------------------------------

test("createResearchItemFromAgent creates once, dedupes by URL, and yields from its source", async () => {
  await run(
    `CREATE (:ResearchSource {id: 'migtest-src-1', name: 'migtest-Source', type: 'website', url: 'https://migtest.example', enabled: true})`,
  );

  const first = await createResearchItemFromAgent({
    title: "migtest-Finding One",
    content: "a valuable finding",
    sourceUrl: "https://migtest.example/finding-1",
    sourceId: "migtest-src-1",
    tags: ["migtest-tag"],
    priority: "high",
  });
  assert.equal(first.deduped, false);
  assert.match(first.id, /^research-item-/);

  // Same URL -> existing id returned, nothing new written.
  const second = await createResearchItemFromAgent({
    title: "migtest-Finding One (dupe)",
    content: "different content, same url",
    sourceUrl: "https://migtest.example/finding-1",
    sourceId: "migtest-src-1",
  });
  assert.equal(second.deduped, true);
  assert.equal(second.id, first.id);

  const count = await run(
    `MATCH (i:ResearchItem {sourceUrl: 'https://migtest.example/finding-1'}) RETURN count(i) as c`,
  );
  assert.equal(count.records[0].get("c").toNumber(), 1);

  // Agent provenance + YIELDED edge from the source.
  const meta = await run(
    `MATCH (s:ResearchSource {id: 'migtest-src-1'})-[:YIELDED]->(i:ResearchItem {id: $id})
     RETURN i.addedBy as addedBy, i.status as status, i.priority as priority`,
    { id: first.id },
  );
  assert.equal(meta.records.length, 1);
  assert.equal(meta.records[0].get("addedBy"), "researcher_agent");
  assert.equal(meta.records[0].get("status"), "unprocessed");
  assert.equal(meta.records[0].get("priority"), "high");
});

// ---------------------------------------------------------------------------
// research-repository: linkResearchToMatchingTopics (COVERS_TOPIC via tags)
// ---------------------------------------------------------------------------

test("linkResearchToMatchingTopics links to active topics matching tags, and no-ops on empty", async () => {
  await run(
    `CREATE (:Topic {id: 'migtest-topic-ml', name: 'migtest-machine-learning', displayName: 'migtest-ML', status: 'active'})`,
  );
  const item = await createResearchItemFromAgent({
    title: "migtest-ML Finding",
    content: "about models",
    sourceUrl: "https://migtest.example/ml",
    tags: ["migtest-machine-learning"],
  });

  await linkResearchToMatchingTopics(item.id, ["migtest-machine-learning"]);

  const linked = await run(
    `MATCH (:ResearchItem {id: $id})-[r:COVERS_TOPIC]->(:Topic {id: 'migtest-topic-ml'}) RETURN count(r) as c`,
    { id: item.id },
  );
  assert.equal(linked.records[0].get("c").toNumber(), 1);

  // Empty tags is a no-op (must not throw, must not add edges).
  const item2 = await createResearchItemFromAgent({
    title: "migtest-No Tags",
    content: "x",
    sourceUrl: "https://migtest.example/notags",
  });
  await linkResearchToMatchingTopics(item2.id, []);
  const none = await run(
    `MATCH (:ResearchItem {id: $id})-[r:COVERS_TOPIC]->() RETURN count(r) as c`,
    { id: item2.id },
  );
  assert.equal(none.records[0].get("c").toNumber(), 0);
});

// ---------------------------------------------------------------------------
// research-repository: getRecentResearchItems + getResearchItemsByTopicIds
// ---------------------------------------------------------------------------

test("getRecentResearchItems windows by age; getResearchItemsByTopicIds joins via COVERS_TOPIC", async () => {
  const recent = await createResearchItemFromAgent({
    title: "migtest-Recent Item",
    content: "fresh",
    sourceUrl: "https://migtest.example/recent",
  });
  // An old item that must fall outside a 7-day window.
  await run(
    `CREATE (:ResearchItem {
        id: 'migtest-research-old', title: 'migtest-Old Item', content: 'stale',
        sourceUrl: 'https://migtest.example/old', sourceId: null, addedBy: 'researcher_agent',
        addedAt: localdatetime() - duration({days: 40}), tags: [], status: 'unprocessed',
        priority: 'medium', humanNote: null,
        createdAt: localdatetime() - duration({days: 40}), updatedAt: localdatetime() - duration({days: 40})
     })`,
  );

  const within7 = await getRecentResearchItems(7);
  const ids = new Set(within7.map((i) => i.id));
  assert.ok(ids.has(recent.id), "recent item is within the window");
  assert.equal(ids.has("migtest-research-old"), false, "old item is outside the window");
  // Returned items map to the ResearchItem shape.
  const mapped = within7.find((i) => i.id === recent.id)!;
  assert.equal(mapped.title, "migtest-Recent Item");
  assert.equal(mapped.addedBy, "researcher_agent");

  // getResearchItemsByTopicIds: link two items to a topic, respect the limit.
  await run(
    `CREATE (:Topic {id: 'migtest-topic-join', name: 'migtest-join', displayName: 'migtest-Join', status: 'active'})`,
  );
  const a = await createResearchItemFromAgent({
    title: "migtest-Join A",
    content: "content a",
    sourceUrl: "https://migtest.example/join-a",
  });
  const b = await createResearchItemFromAgent({
    title: "migtest-Join B",
    content: "content b",
    sourceUrl: "https://migtest.example/join-b",
  });
  await run(
    `MATCH (t:Topic {id: 'migtest-topic-join'})
     MATCH (ra:ResearchItem {id: $a}) MERGE (ra)-[:COVERS_TOPIC]->(t)
     WITH t MATCH (rb:ResearchItem {id: $b}) MERGE (rb)-[:COVERS_TOPIC]->(t)`,
    { a: a.id, b: b.id },
  );

  const joined = await getResearchItemsByTopicIds(["migtest-topic-join"]);
  assert.equal(joined.length, 2);
  const joinedIds = new Set(joined.map((r) => r.id));
  assert.ok(joinedIds.has(a.id) && joinedIds.has(b.id));
  assert.deepEqual(Object.keys(joined[0]).sort(), ["content", "id", "sourceUrl", "title"]);

  // limit is honored.
  const limited = await getResearchItemsByTopicIds(["migtest-topic-join"], 1);
  assert.equal(limited.length, 1);

  // Empty input short-circuits.
  assert.deepEqual(await getResearchItemsByTopicIds([]), []);
});

// ---------------------------------------------------------------------------
// topic-repository: linkTopicToEntities (DERIVED_FROM) + linkTopicToResearch
// ---------------------------------------------------------------------------

test("linkTopicToEntities links DERIVED_FROM for eligible types only", async () => {
  await run(
    `CREATE (:Topic {id: 'migtest-topic-de', name: 'migtest-de', displayName: 'migtest-DE', status: 'active'})
     CREATE (:AIComponent {id: 'migtest-ai-1', name: 'migtest-VectorDB'})
     CREATE (:Database {id: 'migtest-db-1', name: 'migtest-Redis'})`,
  );

  await linkTopicToEntities("migtest-topic-de", ["migtest-VectorDB", "migtest-Redis", "migtest-Unknown"]);

  const derived = await run(
    `MATCH (:Topic {id: 'migtest-topic-de'})-[:DERIVED_FROM]->(e) RETURN collect(e.name) as names`,
  );
  const names: string[] = derived.records[0].get("names");
  assert.deepEqual(names, ["migtest-VectorDB"]); // Database + unknown excluded

  // Empty list is a no-op.
  await linkTopicToEntities("migtest-topic-de", []);
  const still = await run(
    `MATCH (:Topic {id: 'migtest-topic-de'})-[r:DERIVED_FROM]->() RETURN count(r) as c`,
  );
  assert.equal(still.records[0].get("c").toNumber(), 1);
});

test("linkTopicToResearch matches items by tag/content/title with hyphen-normalized name", async () => {
  await run(
    `CREATE (:Topic {id: 'migtest-topic-gr', name: 'migtest-graph-rag', displayName: 'migtest-GraphRAG', status: 'active'})`,
  );
  // Content-match: the hyphenated name is normalized to spaces ("migtest graph rag").
  const byContent = await createResearchItemFromAgent({
    title: "migtest-Content Match",
    content: "a study of migtest graph rag systems",
    sourceUrl: "https://migtest.example/gr-content",
  });
  // Tag-match on the spaced form.
  const byTag = await createResearchItemFromAgent({
    title: "migtest-Tag Match",
    content: "unrelated body",
    sourceUrl: "https://migtest.example/gr-tag",
    tags: ["migtest graph rag"],
  });
  // Non-match must stay unlinked.
  const noMatch = await createResearchItemFromAgent({
    title: "migtest-No Match",
    content: "completely different",
    sourceUrl: "https://migtest.example/gr-none",
  });

  await linkTopicToResearch("migtest-topic-gr", "migtest-graph-rag");

  const linked = await run(
    `MATCH (r:ResearchItem)-[:COVERS_TOPIC]->(:Topic {id: 'migtest-topic-gr'}) RETURN collect(r.id) as ids`,
  );
  const linkedIds: string[] = linked.records[0].get("ids");
  assert.ok(linkedIds.includes(byContent.id), "content match linked");
  assert.ok(linkedIds.includes(byTag.id), "tag match linked");
  assert.equal(linkedIds.includes(noMatch.id), false, "non-match not linked");
});

// ---------------------------------------------------------------------------
// content-repository: gap + performance + related-content queries
// ---------------------------------------------------------------------------

test("draft creation preserves refined idea state and repairs legacy draft-state ideas", async () => {
  await run(
    `CREATE (current:ContentIdea {
       id: 'migtest-idea-current', title: 'migtest-Current idea', description: 'd', rationale: 'r', status: 'refined'
     })
     CREATE (legacy:ContentIdea {
       id: 'migtest-idea-legacy', title: 'migtest-Legacy idea', description: 'd', rationale: 'r', status: 'draft'
     })
     CREATE (legacyDraft:ContentDraft {
       id: 'migtest-draft-legacy', ideaId: 'migtest-idea-legacy', title: 'migtest-Legacy draft',
       type: 'blog_post', content: 'body', status: 'draft'
     })
     CREATE (unlinked:ContentIdea {
       id: 'migtest-idea-unlinked', title: 'migtest-Unlinked draft state', description: 'd', rationale: 'r', status: 'draft'
     })
     CREATE (legacyDraft)-[:DRAFT_OF]->(legacy)`,
  );

  await createContentDraft({
    ideaId: "migtest-idea-current",
    title: "migtest-New draft",
    type: "blog_post",
    content: "new body",
  });

  const afterCreate = await run(
    `MATCH (i:ContentIdea {id: 'migtest-idea-current'}) RETURN i.status AS status`,
  );
  assert.equal(afterCreate.records[0].get("status"), "refined");

  assert.ok(await repairLegacyContentIdeaStatuses() >= 1);
  const afterRepair = await run(
    `MATCH (legacy:ContentIdea {id: 'migtest-idea-legacy'})
     MATCH (unlinked:ContentIdea {id: 'migtest-idea-unlinked'})
     RETURN legacy.status AS legacy, unlinked.status AS unlinked`,
  );
  assert.equal(afterRepair.records[0].get("legacy"), "refined");
  assert.equal(afterRepair.records[0].get("unlinked"), "draft");
});

test("posting reminders are timezone-aware, ordered, and clearable", async () => {
  await run(
    `
    CREATE (:ContentDraft {
      id: 'migtest-draft-reminder',
      ideaId: 'migtest-idea-reminder',
      title: 'migtest-Reminder',
      type: 'linkedin_post',
      content: 'Ready to post',
      status: 'ready',
      createdAt: localdatetime(),
      updatedAt: localdatetime()
    })
    `,
  );

  const scheduledFor = "2026-08-01T04:30:00.000Z";
  const updated = await updateContentDraft(
    "migtest-draft-reminder",
    { scheduledFor },
  );
  assert.equal(new Date(updated?.scheduledFor ?? "").toISOString(), scheduledFor);

  const scheduled = await getScheduledContentDrafts();
  assert.ok(scheduled.some((draft) => draft.id === "migtest-draft-reminder"));

  const cleared = await updateContentDraft(
    "migtest-draft-reminder",
    { scheduledFor: null },
  );
  assert.equal(cleared?.scheduledFor, undefined);
  assert.equal(
    (await getScheduledContentDrafts())
      .some((draft) => draft.id === "migtest-draft-reminder"),
    false,
  );
});

test("queryContentGaps returns researched-but-idealess topics with a scaled priority", async () => {
  // Gap topic: 2 research items, 0 ideas -> medium.
  await run(
    `CREATE (t:Topic {id: 'migtest-topic-gap', name: 'migtest-gap', displayName: 'migtest-Gap Topic', status: 'active'})
     CREATE (r1:ResearchItem {id: 'migtest-r-gap-1', title: 'migtest-g1', sourceUrl: 'https://migtest.example/g1'})
     CREATE (r2:ResearchItem {id: 'migtest-r-gap-2', title: 'migtest-g2', sourceUrl: 'https://migtest.example/g2'})
     MERGE (r1)-[:COVERS_TOPIC]->(t)
     MERGE (r2)-[:COVERS_TOPIC]->(t)`,
  );
  // Covered topic: has research AND an idea -> excluded from gaps.
  await run(
    `CREATE (t:Topic {id: 'migtest-topic-covered', name: 'migtest-covered', displayName: 'migtest-Covered', status: 'active'})
     CREATE (r:ResearchItem {id: 'migtest-r-cov', title: 'migtest-cov', sourceUrl: 'https://migtest.example/cov'})
     CREATE (i:ContentIdea {id: 'migtest-idea-cov', title: 'migtest-Idea Cov', description: 'd', rationale: 'r', status: 'idea'})
     MERGE (r)-[:COVERS_TOPIC]->(t)
     MERGE (i)-[:INSPIRED_BY]->(t)`,
  );

  const gaps = await queryContentGaps(100);
  const byId = new Map(gaps.map((g) => [g.topicId, g]));

  const gap = byId.get("migtest-topic-gap");
  assert.ok(gap, "gap topic present");
  assert.equal(gap!.topicName, "migtest-Gap Topic");
  assert.equal(gap!.researchCount, 2);
  assert.equal(gap!.suggestedPriority, "medium");

  assert.equal(byId.has("migtest-topic-covered"), false, "topic with an idea is not a gap");
});

test("queryHighPerformingContent returns high-performance drafts with their topics", async () => {
  await run(
    `CREATE (t:Topic {id: 'migtest-topic-hp', name: 'migtest-hp', displayName: 'migtest-HP Topic', status: 'active'})
     CREATE (i:ContentIdea {id: 'migtest-idea-hp', title: 'migtest-Idea HP', description: 'd', rationale: 'r', status: 'refined'})
     CREATE (d:ContentDraft {id: 'migtest-draft-hp', ideaId: 'migtest-idea-hp', title: 'migtest-Draft HP', type: 'blog_post',
        content: 'body', status: 'published', performanceLevel: 'high', performanceInsights: 'migtest-insight',
        publishedAt: localdatetime()})
     CREATE (low:ContentDraft {id: 'migtest-draft-low', ideaId: 'migtest-idea-hp', title: 'migtest-Draft Low', type: 'blog_post',
        content: 'body', status: 'published', performanceLevel: 'low', publishedAt: localdatetime()})
     MERGE (i)-[:INSPIRED_BY]->(t)
     MERGE (d)-[:DRAFT_OF]->(i)
     MERGE (low)-[:DRAFT_OF]->(i)`,
  );

  const hp = await queryHighPerformingContent(100);
  const row = hp.find((r) => r.id === "migtest-draft-hp");
  assert.ok(row, "high-performing draft present");
  assert.equal(row!.performanceLevel, "high");
  assert.equal(row!.insights, "migtest-insight");
  assert.equal(row!.type, "blog_post");
  assert.deepEqual(row!.topics, ["migtest-HP Topic"]);

  assert.equal(hp.some((r) => r.id === "migtest-draft-low"), false, "low-performance draft excluded");
});

test("queryRelatedPublishedContent returns published drafts sharing the given topics", async () => {
  await run(
    `CREATE (t:Topic {id: 'migtest-topic-rel', name: 'migtest-rel', displayName: 'migtest-Rel', status: 'active'})
     CREATE (ip:ContentIdea {id: 'migtest-idea-rel-pub', title: 'migtest-Idea Rel Pub', description: 'd', rationale: 'r', status: 'refined'})
     CREATE (dp:ContentDraft {id: 'migtest-draft-rel-pub', ideaId: 'migtest-idea-rel-pub', title: 'migtest-Draft Rel Pub',
        type: 'blog_post', content: 'body', status: 'published', publishedUrl: 'https://migtest.example/published'})
     CREATE (iu:ContentIdea {id: 'migtest-idea-rel-unp', title: 'migtest-Idea Rel Unp', description: 'd', rationale: 'r', status: 'refined'})
     CREATE (du:ContentDraft {id: 'migtest-draft-rel-unp', ideaId: 'migtest-idea-rel-unp', title: 'migtest-Draft Rel Unp',
        type: 'blog_post', content: 'body', status: 'draft'})
     MERGE (ip)-[:INSPIRED_BY]->(t)
     MERGE (dp)-[:DRAFT_OF]->(ip)
     MERGE (iu)-[:INSPIRED_BY]->(t)
     MERGE (du)-[:DRAFT_OF]->(iu)`,
  );

  const related = await queryRelatedPublishedContent(["migtest-topic-rel"], 100);
  const pub = related.find((r) => r.id === "migtest-draft-rel-pub");
  assert.ok(pub, "published draft present");
  assert.equal(pub!.publishedUrl, "https://migtest.example/published");
  assert.equal(pub!.type, "blog_post");
  assert.equal(related.some((r) => r.id === "migtest-draft-rel-unp"), false, "unpublished draft excluded");

  // Empty input short-circuits.
  assert.deepEqual(await queryRelatedPublishedContent([]), []);
});
