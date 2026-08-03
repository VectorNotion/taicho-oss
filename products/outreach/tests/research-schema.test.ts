import assert from 'node:assert/strict';
import test from 'node:test';
import {
  companyInsightSchema,
  competitorSchema,
  leadResearchSchema,
  researchInputSchema,
} from '../domain/research-schema';
import { buildResearchInput } from '../agent/lead-research';

test('lead research accepts the complete structured provider contract', () => {
  const result = leadResearchSchema.parse({
    industry: 'Software',
    companySummary: 'A concise summary.',
    companyInsights: [
      { category: 'overview', content: 'Known fact.', sourceUrl: 'https://example.test/source' },
      { category: 'ai_initiatives', content: 'AI program.' },
    ],
    competitors: [{ name: 'Competitor', relevance: 'Same buyer', aiFocus: 'Automation' }],
    talkingPoints: ['Reliability', 'Governance'],
    outreachAngle: 'Lead with operational reliability.',
  });
  assert.equal(result.companyInsights.length, 2);
  assert.equal(result.competitors[0].name, 'Competitor');
});

test('research schemas reject unknown categories and missing required output', () => {
  assert.equal(companyInsightSchema.safeParse({ category: 'rumor', content: 'x' }).success, false);
  assert.equal(competitorSchema.safeParse({ name: 'Only a name' }).success, false);
  assert.equal(leadResearchSchema.safeParse({ industry: 'Software' }).success, false);
  assert.equal(researchInputSchema.safeParse({ leadId: 'lead-1', name: 'Ada' }).success, false);
});

test('research input is grounded only in persisted lead fields', () => {
  const input = buildResearchInput({
    id: 'lead-1', name: 'Ada', company: 'Analytical Engines', title: 'Founder',
    location: 'London', status: 'new', source: 'manual', priority: 'medium', tags: [],
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
  });
  assert.deepEqual(input, {
    leadId: 'lead-1', name: 'Ada', company: 'Analytical Engines', title: 'Founder', location: 'London',
  });
});
