import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ARTIFACT_KINDS,
  CANONICAL_INTELLIGENCE_WORKFLOWS,
  INTELLIGENCE_WORKFLOW_DEFINITIONS,
  isCanonicalIntelligenceWorkflow,
  parseWorkflowInput,
} from '../intelligence/contracts';

test('canonical workflows have stable, one-to-one artifact contracts', () => {
  assert.equal(new Set(CANONICAL_INTELLIGENCE_WORKFLOWS).size, 7);
  assert.equal(new Set(ARTIFACT_KINDS).size, 7);
  for (const workflow of CANONICAL_INTELLIGENCE_WORKFLOWS) {
    const definition = INTELLIGENCE_WORKFLOW_DEFINITIONS[workflow];
    assert.equal(definition.key, workflow);
    assert.ok(ARTIFACT_KINDS.includes(definition.artifactKind));
  }
});

test('workflow identifiers and inputs are validated at the dispatcher boundary', () => {
  assert.equal(isCanonicalIntelligenceWorkflow('prospect_intelligence'), true);
  assert.equal(isCanonicalIntelligenceWorkflow('custom_user_workflow'), false);
  assert.deepEqual(parseWorkflowInput('prospect_intelligence', { prospectId: 'prospect-1' }), {
    prospectId: 'prospect-1',
  });
  assert.throws(
    () => parseWorkflowInput('funnel_intelligence', { funnelId: 'funnel-1' }),
    /Provide prospectId or contactId/,
  );
});
