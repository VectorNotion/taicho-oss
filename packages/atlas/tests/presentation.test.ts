import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAddProspect } from '../components/CommandBar';
import { actionsFor, subtitle } from '../components/Inspector';
import { entityBrainType } from '../data/brain-repository';
import type { BrainNode } from '../types';
import { LABEL_TO_TYPE, TYPE_COLOR, TYPE_RING, TYPE_WORD, nodeRadius } from '../palette';

test('add-prospect commands parse supported name, title, and company forms', () => {
  assert.deepEqual(parseAddProspect('+ Ada Lovelace'), { name: 'Ada Lovelace', title: undefined, company: undefined });
  assert.deepEqual(parseAddProspect('+ Ada Lovelace, CTO'), { name: 'Ada Lovelace', title: 'CTO', company: undefined });
  assert.deepEqual(parseAddProspect('+ Ada Lovelace, CTO @ Analytical Engines'), {
    name: 'Ada Lovelace', title: 'CTO', company: 'Analytical Engines',
  });
  assert.equal(parseAddProspect('+   '), null);
  assert.equal(parseAddProspect('+ Ada, CTO, Founder @ Analytical Engines'), null);
  assert.equal(parseAddProspect('+ Ada, CTO @ Analytical @ Engines'), null);
  assert.equal(parseAddProspect('+ Ada, @ Analytical Engines'), null);
  assert.equal(parseAddProspect('+ Ada, CTO @'), null);
});

test('canonical product roles retain their contextual Brain type', () => {
  assert.equal(entityBrainType(['core.person', 'outreach.prospect']), 'prospect');
  assert.equal(entityBrainType(['core.thing', 'content.project']), 'project');
  assert.equal(entityBrainType(['core.concept', 'content.topic']), 'topic');
  assert.equal(entityBrainType(['core.thing', 'content.idea']), 'idea');
  assert.equal(entityBrainType(['core.thing', 'content.draft']), 'draft');
});

test('contextual actions use the product identity rather than the graph identity', () => {
  const prospect = {
    id: 'canonical-prospect',
    label: 'Ada',
    type: 'prospect',
    degree: 1,
    createdAt: null,
    meta: { productId: 'product-prospect', status: 'new' },
  } satisfies BrainNode;
  assert.deepEqual(actionsFor(prospect), {
    streams: [{ label: 'Re-score fit', api: '/outreach/prospects/product-prospect/qualify' }],
    open: '/outreach/prospects/product-prospect',
  });
});

test('project subtitles do not turn missing processing metadata into a negative fact', () => {
  const project = (processed: string | null) => ({
    id: 'canonical-project', label: 'Project', type: 'project', degree: 1, createdAt: null,
    meta: { productId: 'product-project', processed },
  }) satisfies BrainNode;
  assert.equal(subtitle(project(null)), '');
  assert.equal(subtitle(project('false')), 'not processed yet');
  assert.equal(subtitle(project('true')), 'processed');
});

test('database labels map only to the supported user vocabulary', () => {
  assert.equal(LABEL_TO_TYPE.Project, 'project');
  assert.equal(LABEL_TO_TYPE.AIComponent, 'capability');
  assert.equal(LABEL_TO_TYPE.ProspectQualification, 'qualification');
  assert.equal(LABEL_TO_TYPE.CanonicalEntity, 'thing');
  assert.equal(LABEL_TO_TYPE.Claim, 'fact');
  assert.equal(LABEL_TO_TYPE.Evidence, 'evidence');
  assert.equal('UnknownInternalNode' in LABEL_TO_TYPE, false);
  for (const type of new Set(Object.values(LABEL_TO_TYPE))) {
    assert.ok(TYPE_COLOR[type]);
    assert.ok(TYPE_WORD[type]);
  }
  assert.deepEqual([...TYPE_RING].sort(), ['draft', 'source']);
});

test('node radius is bounded and monotonic for invalid, sparse, and dense nodes', () => {
  assert.equal(nodeRadius(-10), 5);
  assert.equal(nodeRadius(0), 5);
  assert.ok(nodeRadius(1) > nodeRadius(0));
  assert.ok(nodeRadius(9) > nodeRadius(1));
  assert.equal(nodeRadius(10_000), 18);
});
