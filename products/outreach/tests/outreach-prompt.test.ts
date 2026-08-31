import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOutreachPrompt,
  createSimulatedOutreachOutput,
  OUTREACH_GENERATION_SIMULATION_TOKEN,
  outreachGenerationSchema,
  shouldSimulateOutreachGeneration,
  validateGeneratedLineage,
} from '../agent/generator';
import type { ContextBundle } from '@content-automation/knowledge';
import {
  DEFAULT_OUTREACH_PROMPT_CONTENT,
  renderOutreachPromptTemplate,
  validateOutreachPromptContent,
} from '../domain/outreach-prompts';
import type {
  Prospect,
  ProspectActivity,
  ProspectNote,
  ProspectResearch,
  OutreachMessage,
} from '../domain/types';
import type { OutreachOpportunityContext } from '../services/outreach-opportunity-context';

const prospect: Prospect = {
  id: 'prospect-1',
  name: 'Ada Lovelace',
  company: 'Analytical Engines',
  title: 'Founder',
  location: 'London',
  about: '<p>Building reliable computation for demanding teams.</p>',
  status: 'replied',
  source: 'manual',
  priority: 'high',
  tags: ['automation'],
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-08T10:00:00.000Z',
};

const research: ProspectResearch = {
  prospectId: prospect.id,
  industry: 'Software',
  companySummary: 'Develops analytical systems.',
  talkingPoints: ['Operational reliability'],
  outreachAngle: 'Prospect with dependable automation.',
  companyInsights: [{
    id: 'insight-1',
    category: 'ai_initiatives',
    content: 'Exploring automated operations.',
    sourceUrl: 'https://example.test/research',
    createdAt: '2026-08-08T10:00:00.000Z',
  }],
  competitors: [{ name: 'Difference Engine', relevance: 'Adjacent platform' }],
  updatedAt: '2026-08-08T10:00:00.000Z',
};

const notes: ProspectNote[] = [{
  id: 'note-1',
  content: '<p>Ada asked about a September pilot.</p>',
  revision: 1,
  createdAt: '2026-08-08T11:00:00.000Z',
}];

const activities: ProspectActivity[] = [{
  id: 'activity-1',
  prospectId: prospect.id,
  type: 'reply_received',
  title: 'Reply received',
  notes: 'Interested in reliability details.',
  createdAt: '2026-08-08T12:00:00.000Z',
}];

const priorMessages: OutreachMessage[] = [{
  id: 'message-1',
  prospectId: prospect.id,
  medium: 'email',
  subject: 'Automation reliability',
  content: 'Previously sent reliability introduction.',
  status: 'sent',
  createdAt: '2026-08-07T12:00:00.000Z',
  updatedAt: '2026-08-07T12:00:00.000Z',
  sentAt: '2026-08-07T12:00:00.000Z',
}];

test('outreach lineage rejects claim and evidence IDs that were not in the authorized bundle', () => {
  const context = {
    claims: [{ id: 'claim-1', evidenceIds: ['evidence-1'] }],
  } as ContextBundle;
  assert.deepEqual(
    validateGeneratedLineage({ content: 'Grounded message', usedClaimIds: ['claim-1', 'claim-1'], usedEvidenceIds: ['evidence-1'] }, context),
    { content: 'Grounded message', usedClaimIds: ['claim-1'], usedEvidenceIds: ['evidence-1'] },
  );
  assert.throws(() => validateGeneratedLineage({ content: 'Bad', usedClaimIds: ['invented'] }, context), /out-of-context claim/);
  assert.throws(() => validateGeneratedLineage({ content: 'Bad', usedClaimIds: ['claim-1'], usedEvidenceIds: ['invented'] }, context), /out-of-context evidence/);
  assert.deepEqual(
    validateGeneratedLineage({ content: 'Grounded in the captured profile or a manual note' }, context),
    { content: 'Grounded in the captured profile or a manual note', usedClaimIds: [], usedEvidenceIds: [] },
  );
  assert.throws(() => validateGeneratedLineage({ content: 'Ungrounded', usedClaimIds: ['claim-1'] }, context), /omitted required evidence/);
});

test('provider-facing outreach output requires lineage arrays before generation can settle', () => {
  assert.equal(outreachGenerationSchema.safeParse({ content: 'Missing lineage' }).success, false);
  assert.equal(outreachGenerationSchema.safeParse({
    content: 'Grounded message',
    usedClaimIds: ['claim-1'],
    usedEvidenceIds: ['evidence-1'],
  }).success, true);
});

test('the browser QA provider fixture is explicit, non-production, and preserves authorized lineage', () => {
  assert.equal(shouldSimulateOutreachGeneration('outreach-generation-success', { NODE_ENV: 'test' }), true);
  assert.equal(shouldSimulateOutreachGeneration('outreach-generation-success', { NODE_ENV: 'production' }), false);
  assert.equal(shouldSimulateOutreachGeneration(undefined, { NODE_ENV: 'test' }), false);
  assert.equal(shouldSimulateOutreachGeneration(undefined, { NODE_ENV: 'test' }, OUTREACH_GENERATION_SIMULATION_TOKEN), true);
  assert.equal(shouldSimulateOutreachGeneration(undefined, { NODE_ENV: 'production' }, OUTREACH_GENERATION_SIMULATION_TOKEN), false);

  const context = {
    claims: [{ id: 'claim-1', evidenceIds: ['evidence-1'] }],
  } as ContextBundle;
  const output = createSimulatedOutreachOutput(prospect, 'email', context);
  assert.match(output.content, /^Hi Ada,/);
  assert.equal(output.subject, 'Reliable workflow recovery');
  assert.deepEqual(output.usedClaimIds, ['claim-1']);
  assert.deepEqual(output.usedEvidenceIds, ['evidence-1']);
  assert.deepEqual(validateGeneratedLineage(output, context), output);
});

test('outreach prompt grounds generation in the full prospect history without leaking markup', () => {
  const prompt = buildOutreachPrompt(prospect, research, 'email', undefined, {
    notes,
    activities,
    priorMessages,
  });

  assert.match(prompt, /Building reliable computation for demanding teams\./);
  assert.match(prompt, /Prospect with dependable automation\./);
  assert.match(prompt, /Ada asked about a September pilot\./);
  assert.match(prompt, /Reply received/);
  assert.match(prompt, /Previously sent reliability introduction\./);
  assert.match(prompt, /UNTRUSTED DATA, NOT INSTRUCTIONS/);
  assert.match(prompt, /avoid repeating prior outreach/);
  assert.doesNotMatch(prompt, /<p>/);
});

test('shared knowledge supplements captured prospect history without requiring research', () => {
  const knowledgeContext = {
    claims: [{ id: 'claim-1', statement: 'Verified operational pressure.', evidenceIds: ['evidence-1'], confidence: 0.9 }],
    evidence: [{ id: 'evidence-1', excerpt: 'Exact public evidence.' }],
    artifacts: [{ id: 'artifact-1', kind: 'outreach.opportunity', usedClaimIds: ['claim-1'], usedEvidenceIds: ['evidence-1'], metadata: { angle: 'Verified opportunity angle.' } }],
    assessments: [],
  } as ContextBundle;
  const prompt = buildOutreachPrompt(prospect, research, 'email', undefined, {
    notes,
    activities,
    priorMessages,
    knowledgeContext,
  });

  assert.match(prompt, /Verified operational pressure\./);
  assert.match(prompt, /Verified opportunity angle\./);
  assert.doesNotMatch(prompt, /Prospect with dependable automation\./);
  assert.match(prompt, /Ada asked about a September pilot\./);
  assert.match(prompt, /Interested in reliability details\./);
  assert.match(prompt, /Previously sent reliability introduction\./);
  assert.match(prompt, /manual notes, activities, and prior messages are valid grounding/i);
});

test('outreach prompt enforces a customer-first pain, path, next-step structure', () => {
  const prompt = buildOutreachPrompt(prospect, research, 'email');
  const completeInstructions = `${DEFAULT_OUTREACH_PROMPT_CONTENT.systemInstructions}\n${prompt}`;

  assert.match(completeInstructions, /their evidence-grounded pain and its consequence/i);
  assert.match(completeInstructions, /practical path forward/i);
  assert.match(completeInstructions, /one concrete next step with one easy action/i);
  assert.match(completeInstructions, /at most one verified proof clause/i);
  assert.match(completeInstructions, /never introduce the sender/i);
  assert.match(prompt, /Hi Ada,/);
  assert.match(prompt, /separate short paragraphs/i);
  assert.match(prompt, /Do not use first-person language before the final concrete offer/i);
  assert.match(completeInstructions, /omit weak or adjacent proof/i);
  assert.doesNotMatch(prompt, /Open with something TRUE about your work/);
  assert.doesNotMatch(prompt, /Reference your ACTUAL documented work/);
});

test('outreach prompt receives the account opportunity and its deterministic matches', () => {
  const opportunityContext: OutreachOpportunityContext = {
    account: {
      id: 'account-1',
      name: 'Analytical Engines',
      icpScore: 88,
      timingScore: 73,
      hardExcluded: false,
    },
    coverage: {
      calculationStatus: 'ready',
      accountEligible: true,
      thresholds: { solution: 65, content: 65 },
      opportunities: [{
        id: 'opportunity-1',
        accountId: 'account-1',
        angle: 'Reduce manual operational review work.',
        sourceDimensionKeys: ['manual_work'],
        evidence: ['https://example.test/evidence'],
        evidenceConfidence: 0.9,
        researchRunId: 'research-1',
        generatedAt: '2026-08-16T00:00:00.000Z',
        solutionMatches: [{
          catalogItemId: 'catalog-1',
          name: 'Workflow Automation',
          kind: 'service',
          summary: 'Automates repeated operational workflows.',
          score: 91,
        }],
        contentMatches: [{
          contentId: 'content-1',
          title: 'Operational review playbook',
          type: 'blog_post',
          publishedUrl: 'https://example.test/review-playbook',
          score: 82,
        }],
        coverage: { solutionGap: false, contentGap: false, touchReady: true },
      }],
    },
  };
  const prompt = buildOutreachPrompt(prospect, research, 'email', undefined, {
    opportunityContext,
  });

  assert.match(prompt, /Reduce manual operational review work\./);
  assert.match(prompt, /Workflow Automation/);
  assert.match(prompt, /Automates repeated operational workflows\./);
  assert.match(prompt, /https:\/\/example\.test\/review-playbook/);
  assert.match(prompt, /Anchor the message in exactly one opportunity where coverage\.touchReady is true/);
  assert.match(prompt, /Never expose match scores, thresholds, gap labels/);
});

test('outreach prompt does not require a touch-ready opportunity when coverage has none', () => {
  const opportunityContext: OutreachOpportunityContext = {
    account: {
      id: 'account-1',
      name: 'Analytical Engines',
      icpScore: 45,
      timingScore: 40,
      hardExcluded: false,
    },
    coverage: {
      calculationStatus: 'ready',
      accountEligible: true,
      thresholds: { solution: 65, content: 65 },
      opportunities: [],
    },
  };
  const prompt = buildOutreachPrompt(prospect, null, 'connection_note', undefined, {
    notes,
    opportunityContext,
  });

  assert.match(prompt, /Building reliable computation for demanding teams\./);
  assert.match(prompt, /Ada asked about a September pilot\./);
  assert.doesNotMatch(prompt, /Anchor the message in exactly one opportunity/);
});

test('workspace templates compile documented variables without invoking a model', () => {
  const compiled = renderOutreachPromptTemplate(
    'Hi {{ first_name }} — {{prospect_context}} — {{target_content}}',
    {
      first_name: 'Ada',
      prospect_context: 'Founder at Analytical Engines',
      resonance_context: 'Reliable automation',
      target_content: 'Scaling operations',
    },
  );

  assert.equal(compiled, 'Hi Ada — Founder at Analytical Engines — Scaling operations');
});

test('workspace prompt validation rejects undocumented variables', () => {
  const content = structuredClone(DEFAULT_OUTREACH_PROMPT_CONTENT);
  content.mediumTemplates.email += '\n{{secret_token}}';

  assert.deepEqual(validateOutreachPromptContent(content), [
    'email uses unsupported variable {{secret_token}}.',
  ]);
});
