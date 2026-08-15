import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOutreachPrompt } from '../agent/generator';
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
