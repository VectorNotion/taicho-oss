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
const L = `atlas-test-prospect-${process.pid}`;

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
       CREATE (l:Prospect {id: $l, name: 'Atlas Test Prospect', company: 'TestCo', title: 'CEO', status: 'new', priority: 'medium'})
       CREATE (p)-[:HAS_FEATURE]->(f)
       CREATE (t)-[:DERIVED_FROM]->(f)`,
      { p: P, t: T, l: L },
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

test('overview returns vocabulary-typed nodes and links, no raw labels', () => inOrganization(async () => {
  const g = await fetchOverview();
  const proj = g.nodes.find((n) => n.id === P);
  assert.ok(proj, 'seeded project present');
  assert.equal(proj!.type, 'project');
  assert.equal(proj!.label, 'Atlas Test Project');
  const topic = g.nodes.find((n) => n.id === T);
  assert.ok(topic, 'active topic present');
  assert.equal(topic!.type, 'topic');
  assert.equal(topic!.label, 'Atlas Test Topic');
  const prospect = g.nodes.find((n) => n.id === L);
  assert.ok(prospect, 'prospect present');
  assert.equal(prospect!.meta.company, 'TestCo');
  const feat = g.nodes.find((n) => n.id === P + '-feat');
  assert.ok(feat, 'topic-attached capability included');
  assert.equal(feat!.type, 'capability');
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const l of g.links) {
    assert.ok(ids.has(l.a) && ids.has(l.b), `dangling link ${l.a}->${l.b}`);
  }
  assert.ok(g.nodes.length <= 400);
}));

test('neighborhood returns the node plus 1-hop, capped', () => inOrganization(async () => {
  const g = await fetchNeighborhood(P);
  assert.ok(g.nodes.some((n) => n.id === P));
  assert.ok(g.nodes.some((n) => n.id === P + '-feat'));
  assert.ok(g.nodes.length <= 100);
  assert.ok(g.links.some((l) => (l.a === P && l.b === P + '-feat') || (l.b === P && l.a === P + '-feat')));
}));

test('search finds by partial name, case-insensitive, capped at 12', () => inOrganization(async () => {
  const r = await searchNodes('atlas test le');
  assert.ok(r.some((x) => x.id === L));
  assert.ok(r.length <= 12);
  const empty = await searchNodes('zz-no-such-thing-zz');
  assert.deepEqual(empty, []);
}));
