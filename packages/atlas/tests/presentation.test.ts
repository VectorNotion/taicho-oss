import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAddLead } from '../components/CommandBar';
import { LABEL_TO_TYPE, TYPE_COLOR, TYPE_RING, TYPE_WORD, nodeRadius } from '../palette';

test('add-lead commands parse supported name, title, and company forms', () => {
  assert.deepEqual(parseAddLead('+ Ada Lovelace'), { name: 'Ada Lovelace', title: undefined, company: undefined });
  assert.deepEqual(parseAddLead('+ Ada Lovelace, CTO'), { name: 'Ada Lovelace', title: 'CTO', company: undefined });
  assert.deepEqual(parseAddLead('+ Ada Lovelace, CTO @ Analytical Engines'), {
    name: 'Ada Lovelace', title: 'CTO', company: 'Analytical Engines',
  });
  assert.equal(parseAddLead('+   '), null);
});

test('database labels map only to the supported user vocabulary', () => {
  assert.equal(LABEL_TO_TYPE.Project, 'project');
  assert.equal(LABEL_TO_TYPE.AIComponent, 'capability');
  assert.equal(LABEL_TO_TYPE.LeadQualification, 'qualification');
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
