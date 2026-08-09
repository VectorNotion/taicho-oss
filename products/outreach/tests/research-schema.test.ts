import assert from 'node:assert/strict';
import test from 'node:test';
import {
  companyInsightSchema,
  competitorSchema,
  leadResearchSchema,
  researchInputSchema,
} from '../domain/research-schema';
import {
  buildLeadResearchPrompt,
  buildLeadResearchQueries,
  buildResearchInput,
  DEFAULT_LEAD_RESEARCH_MODEL,
} from '../agent/lead-research';
import {
  buildLeadResearchInstructions,
  LEAD_RESEARCH_MAX_STEPS,
} from '../agent/lead-research-agent';

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

test('research instructions use the current date and leave room for synthesis', () => {
  const instructions = buildLeadResearchInstructions(new Date('2026-08-09T00:00:00.000Z'));

  assert.match(instructions, /Today is 2026-08-09/);
  assert.match(instructions, /recent news 2026 2025/);
  assert.doesNotMatch(instructions, /recent news 2024 2025/);
  assert.ok(LEAD_RESEARCH_MAX_STEPS >= 6);
});

test('research prompt contains only the persisted lead identity supplied by the server', () => {
  const prompt = buildLeadResearchPrompt({
    leadId: 'lead-1',
    name: 'Ada Lovelace',
    company: 'Analytical Engines',
    title: 'Founder',
    location: 'London',
  });

  assert.equal(prompt, 'Research Ada Lovelace at Analytical Engines (Founder), London');
});

test('research retrieval plans exactly five current, independent evidence queries', () => {
  const queries = buildLeadResearchQueries({
    leadId: 'lead-1',
    name: 'Ada Lovelace',
    company: 'Analytical Engines',
  }, new Date('2026-08-09T00:00:00.000Z'));

  assert.deepEqual(queries.map(({ topic }) => topic), [
    'company',
    'news',
    'ai',
    'competitors',
    'industry',
  ]);
  assert.match(queries[1].query, /2026 2025/);
  assert.match(queries[4].query, /2026/);
  assert.equal(DEFAULT_LEAD_RESEARCH_MODEL, 'google/gemini-3.6-flash');
});
