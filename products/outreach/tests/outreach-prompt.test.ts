import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOutreachPrompt } from '../agent/generator';
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
  const prompt = buildOutreachPrompt(prospect, research, 'email', undefined, undefined, {
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

  assert.match(prompt, /1\. THEIR PAIN/);
  assert.match(prompt, /2\. THE PATH/);
  assert.match(prompt, /3\. NEXT STEP/);
  assert.match(prompt, /recipient must remain the subject/i);
  assert.match(prompt, /never open with the sender/i);
  assert.match(prompt, /at most one compact verified proof clause/i);
  assert.match(prompt, /one concrete offer and one easy action/i);
  assert.match(prompt, /only place first-person language is allowed/i);
  assert.match(prompt, /Hi Ada,/);
  assert.match(prompt, /one or two sentences each/i);
  assert.match(prompt, /blank line between them/i);
  assert.match(prompt, /Do not write "I built"/i);
  assert.match(prompt, /merely adjacent rather than directly relevant, omit it/i);
  assert.doesNotMatch(prompt, /Open with something TRUE about your work/);
  assert.doesNotMatch(prompt, /Reference your ACTUAL documented work/);
});
