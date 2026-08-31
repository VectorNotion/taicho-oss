process.env.FALKORDB_URL = process.env.FALKORDB_URL ?? 'redis://localhost:6380';

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import {
  getSession,
  closeDriver,
  runWithGraphOrganization,
} from '@content-automation/platform/data/graph';
import { fetchOverview, fetchNeighborhood, searchNodes } from './brain-repository';

const ORGANIZATION_ID = `atlas-test-organization-${process.pid}`;
const P = `atlas-test-project-${process.pid}`;
const T = `atlas-test-topic-${process.pid}`;
const S = `atlas-test-source-${process.pid}`;
const R = `atlas-test-research-${process.pid}`;
const I = `atlas-test-idea-${process.pid}`;
const D = `atlas-test-draft-${process.pid}`;
const M = `atlas-test-media-${process.pid}`;
const L = `atlas-test-prospect-${process.pid}`;
const E = `atlas-test-entity-${process.pid}`;
const O = `atlas-test-object-${process.pid}`;
const C = `atlas-test-claim-${process.pid}`;
const RETIRED_C = `atlas-test-retired-claim-${process.pid}`;
const EV = `atlas-test-evidence-${process.pid}`;
const A = `atlas-test-artifact-${process.pid}`;

function inOrganization<T>(callback: () => T): T {
  return runWithGraphOrganization(ORGANIZATION_ID, callback);
}

before(() => inOrganization(async () => {
  const s = await getSession();
  try {
    await s.run(
      `CREATE (p:Project {id: $p, title: 'Atlas Test Project', createdAt: localdatetime()})
       CREATE (f:Feature {id: $p + '-feat', name: 'Atlas Test Feature'})
       CREATE (t:Topic {id: $t, name: 'atlas-test-topic', displayName: 'Atlas Test Topic', status: 'active'})
       CREATE (s:ResearchSource {id: $s, name: 'Atlas Test Source', url: 'https://example.test/atlas'})
       CREATE (r:ResearchItem {id: $r, title: 'Atlas Test Research', content: 'Research about the Atlas topic.', status: 'unprocessed', priority: 'high', createdAt: localdatetime()})
       CREATE (i:ContentIdea:ContentBase {id: $i, title: 'Atlas Test Content Base', description: 'A directly connected Content Base.', status: 'refined', priority: 'high', createdAt: localdatetime(), updatedAt: localdatetime()})
       CREATE (d:ContentDraft {id: $d, ideaId: $i, title: 'Atlas Test Post', type: 'blog_post', status: 'draft', createdAt: localdatetime(), updatedAt: localdatetime()})
       CREATE (m:MediaAsset {id: $m, contentBaseId: $i, visualType: 'diagram', kind: 'image', description: 'Atlas durable media diagram', createdAt: localdatetime(), updatedAt: localdatetime()})
       CREATE (l:Prospect {id: $l, name: 'Atlas Test Prospect', company: 'TestCo', title: 'CEO', status: 'new', priority: 'medium'})
       CREATE (p)-[:HAS_FEATURE]->(f)
       CREATE (t)-[:DERIVED_FROM]->(f)
       CREATE (s)-[:YIELDED]->(r)
       CREATE (r)-[:COVERS_TOPIC]->(t)
       CREATE (i)-[:INSPIRED_BY]->(t)
       CREATE (i)-[:SOURCED_FROM]->(r)
       CREATE (d)-[:DRAFT_OF]->(i)
       CREATE (i)-[:HAS_POST]->(d)
       CREATE (i)-[:HAS_MEDIA]->(m)
       CREATE (d)-[:USES_MEDIA]->(m)
       CREATE (m)-[:GROUNDED_IN]->(r)`,
      { p: P, t: T, s: S, r: R, i: I, d: D, m: M, l: L },
    );
    const entity = {
      id: E, schemaVersion: 'knowledge.v1', organizationId: ORGANIZATION_ID,
      typeKey: 'core.concept', typeKeys: ['core.concept'], name: 'Atlas Semantic Search',
      normalizedName: 'atlas semantic search', aliases: [], externalIds: {}, sensitivity: 'workspace',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const claim = {
      id: C, schemaVersion: 'knowledge.v1', organizationId: ORGANIZATION_ID,
      ownerProfile: 'test.research', revisionId: 'atlas-test-revision', subjectEntityId: E,
      predicateKey: 'core.related_to', object: { kind: 'entity', entityId: O },
      statement: 'Atlas Semantic Search uses vectors.', evidenceIds: ['atlas-test-evidence'], status: 'accepted',
      confidence: 0.91, sensitivity: 'workspace', allowedUses: ['research'], extractionVersion: 'test@1',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const object = {
      ...entity,
      id: O,
      name: 'Atlas Vector Databases',
      normalizedName: 'atlas vector databases',
    };
    const retiredClaim = {
      ...claim,
      id: RETIRED_C,
      statement: 'Retired Atlas hallucination.',
      status: 'superseded',
    };
    const evidence = {
      id: EV, schemaVersion: 'knowledge.v1', organizationId: ORGANIZATION_ID,
      revisionId: 'atlas-test-revision', start: 0, end: 39,
      excerpt: 'Atlas uses vectors for semantic search.',
      locator: 'https://example.test/atlas-proof',
    };
    const artifact = {
      id: A, schemaVersion: 'knowledge.v1', organizationId: ORGANIZATION_ID,
      kind: 'content.idea', externalId: 'atlas-product-idea', usedClaimIds: [C],
      usedEvidenceIds: [EV], sensitivity: 'workspace', allowedUses: ['content'],
      metadata: { title: 'Atlas grounded idea', status: 'idea', priority: 'high' },
      createdAt: new Date().toISOString(),
    };
    await s.run(
      `CREATE (e:CanonicalEntity {id: $entityId, schemaVersion: 'knowledge.v1', organizationId: $organizationId, json: $entityJson, updatedAt: $now})
       CREATE (o:CanonicalEntity {id: $objectId, schemaVersion: 'knowledge.v1', organizationId: $organizationId, json: $objectJson, updatedAt: $now})
       CREATE (c:Claim {id: $claimId, schemaVersion: 'knowledge.v1', organizationId: $organizationId, json: $claimJson, status: 'accepted', updatedAt: $now})
       CREATE (retired:Claim {id: $retiredClaimId, schemaVersion: 'knowledge.v1', organizationId: $organizationId, json: $retiredClaimJson, status: 'superseded', updatedAt: $now})
       CREATE (evidence:Evidence {id: $evidenceId, schemaVersion: 'knowledge.v1', organizationId: $organizationId, json: $evidenceJson, revisionId: 'atlas-test-revision', updatedAt: $now})
       CREATE (artifact:Artifact {id: $artifactId, schemaVersion: 'knowledge.v1', organizationId: $organizationId, json: $artifactJson, kind: 'content.idea', externalId: 'atlas-product-idea', createdAt: $now})
       CREATE (c)-[:SUBJECT]->(e)
       CREATE (c)-[:OBJECT]->(o)
       CREATE (c)-[:SUPPORTED_BY]->(evidence)
       CREATE (artifact)-[:USES]->(c)
       CREATE (retired)-[:SUBJECT]->(e)`,
      { entityId: E, objectId: O, claimId: C, retiredClaimId: RETIRED_C, evidenceId: EV, artifactId: A, organizationId: ORGANIZATION_ID, entityJson: JSON.stringify(entity), objectJson: JSON.stringify(object), claimJson: JSON.stringify(claim), retiredClaimJson: JSON.stringify(retiredClaim), evidenceJson: JSON.stringify(evidence), artifactJson: JSON.stringify(artifact), now: new Date().toISOString() },
    );
  } finally { await s.close(); }
}));

after(() => inOrganization(async () => {
  const s = await getSession();
  try {
    await s.run(`MATCH (n) WHERE n.id STARTS WITH 'atlas-test-' DETACH DELETE n`);
  } finally {
    await s.close();
    await closeDriver();
  }
}));

test('overview combines direct content records with canonical knowledge and semantic links', () => inOrganization(async () => {
  const g = await fetchOverview();
  assert.equal(g.nodes.some((n) => n.id === L), false, 'unrelated legacy product nodes stay out');
  assert.equal(g.nodes.find((n) => n.id === R)?.type, 'research-item');
  assert.equal(g.nodes.find((n) => n.id === S)?.type, 'source');
  assert.equal(g.nodes.find((n) => n.id === I)?.type, 'idea');
  assert.equal(g.nodes.find((n) => n.id === D)?.type, 'draft');
  assert.equal(g.nodes.find((n) => n.id === M)?.type, 'media');
  assert.equal(g.nodes.find((n) => n.id === T)?.type, 'topic');
  assert.ok(g.links.some((link) => link.a === S && link.b === R && link.kind === 'YIELDED'));
  assert.ok(g.links.some((link) => link.a === R && link.b === T && link.kind === 'COVERS_TOPIC'));
  assert.ok(g.links.some((link) => link.a === I && link.b === R && link.kind === 'SOURCED_FROM'));
  assert.ok(g.links.some((link) => link.a === I && link.b === T && link.kind === 'INSPIRED_BY'));
  assert.ok(g.links.some((link) => link.a === D && link.b === I && link.kind === 'DRAFT_OF'));
  assert.ok(g.links.some((link) => link.a === I && link.b === M && link.kind === 'HAS_MEDIA'));
  assert.ok(g.links.some((link) => link.a === D && link.b === M && link.kind === 'USES_MEDIA'));
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const l of g.links) {
    assert.ok(ids.has(l.a) && ids.has(l.b), `dangling link ${l.a}->${l.b}`);
  }
  assert.ok(g.nodes.length <= 400);
  const entity = g.nodes.find((n) => n.id === E);
  assert.ok(entity, 'shared-registry entity present');
  assert.equal(entity!.label, 'Atlas Semantic Search');
  assert.equal(entity!.type, 'concept');
  const object = g.nodes.find((n) => n.id === O);
  assert.ok(object, 'claim object entity present');
  assert.equal(g.nodes.some((n) => n.id === C), false, 'provenance claim is not a noisy overview waypoint');
  assert.ok(g.links.some((link) => link.a === E && link.b === O && link.kind === 'core.related_to'));
  assert.equal(g.nodes.some((node) => node.id === A), false, 'content artifacts defer to their direct product records');
}));

test('direct Content Base neighborhoods expose research, topic, Post, and media lineage', () => inOrganization(async () => {
  const graph = await fetchNeighborhood(I);
  assert.ok(graph.nodes.some(({ id }) => id === I));
  assert.ok(graph.nodes.some(({ id }) => id === R));
  assert.ok(graph.nodes.some(({ id }) => id === T));
  assert.ok(graph.nodes.some(({ id }) => id === D));
  assert.ok(graph.nodes.some(({ id }) => id === M));
  assert.ok(graph.links.some(({ a, b, kind }) => a === I && b === M && kind === 'HAS_MEDIA'));
}));

test('neighborhood returns the canonical node plus accepted provenance, capped', () => inOrganization(async () => {
  const g = await fetchNeighborhood(E);
  assert.ok(g.nodes.some((n) => n.id === E));
  assert.ok(g.nodes.some((n) => n.id === C));
  assert.ok(g.nodes.length <= 100);
  assert.ok(g.links.some((l) => (l.a === E && l.b === C) || (l.b === E && l.a === C)));
}));

test('retired knowledge claims remain out of active neighborhoods and search', () => inOrganization(async () => {
  const neighborhood = await fetchNeighborhood(E);
  assert.equal(neighborhood.nodes.some(({ id }) => id === RETIRED_C), false);
  const claim = neighborhood.nodes.find(({ id }) => id === C);
  assert.deepEqual(claim?.proofs, [{
    id: EV,
    excerpt: 'Atlas uses vectors for semantic search.',
    url: 'https://example.test/atlas-proof',
  }]);
  const entity = neighborhood.nodes.find(({ id }) => id === E);
  assert.deepEqual(entity?.knowledge, [{
    id: C,
    statement: 'Atlas Semantic Search uses vectors.',
    proofs: [{
      id: EV,
      excerpt: 'Atlas uses vectors for semantic search.',
      url: 'https://example.test/atlas-proof',
    }],
  }]);
  const results = await searchNodes('retired atlas');
  assert.equal(results.some(({ id }) => id === RETIRED_C), false);
}));

test('search finds by partial name, case-insensitive, capped at 12', () => inOrganization(async () => {
  const semantic = await searchNodes('semantic search');
  assert.ok(semantic.some((x) => x.id === E && x.type === 'concept'));
  const contentBase = await searchNodes('test content base');
  assert.ok(contentBase.some((x) => x.id === I && x.type === 'idea'));
  const media = await searchNodes('durable media diagram');
  assert.ok(media.some((x) => x.id === M && x.type === 'media'));
  assert.ok(semantic.length <= 12);
  const empty = await searchNodes('zz-no-such-thing-zz');
  assert.deepEqual(empty, []);
}));

test('search filters in the graph before its result cap', () => inOrganization(async () => {
  const session = await getSession();
  const lateId = `atlas-test-late-idea-${process.pid}`;
  try {
    await session.run(
      `UNWIND range(1, 260) AS index
       CREATE (:ContentIdea {id: 'atlas-test-search-noise-' + toString(index) + '-${process.pid}', title: 'Unrelated search noise ' + toString(index)})
       WITH count(*) AS ignored
       CREATE (:ContentIdea {id: $lateId, title: 'Atlas Late Searchable Content Base'})`,
      { lateId },
    );
    const results = await searchNodes('late searchable content base');
    assert.ok(results.some(({ id, type }) => id === lateId && type === 'idea'));
  } finally {
    await session.run(
      `MATCH (n) WHERE n.id STARTS WITH 'atlas-test-search-noise-' OR n.id = $lateId DETACH DELETE n`,
      { lateId },
    );
    await session.close();
  }
}));
