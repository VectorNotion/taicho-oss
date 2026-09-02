import assert from 'node:assert/strict';
import test from 'node:test';
import { getAgentsStats } from '../stats';
import type { AgentWithDeployments } from '../domain';

const agent = (id: string, name: string, status: 'active' | 'paused', deployments: Array<'active' | 'revoked'>): AgentWithDeployments => ({
  agent: {
    id, organizationId: 'org-1', slug: name.toLowerCase(), version: 1, status,
    createdBy: 'user-1', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    name, description: 'd', instructions: 'i'.repeat(10), channels: ['api-sdk'],
    projectionKeys: ['workspace'], allowedUses: ['content'], maxSensitivity: 'restricted',
    maxHops: 3, maxResults: 50, canWriteNotes: true,
  },
  deployments: deployments.map((s, index) => ({
    id: `dep-${id}-${index}`, organizationId: 'org-1', agentId: id, name: `d${index}`, channel: 'openai',
    tokenPrefix: 'ag_live_x', status: s, createdBy: 'user-1',
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  })),
});

const usage = {
  window: { days: 30, from: '2026-08-03T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' },
  messages: { current: 3, previous: 1 },
  credits: { current: 30, previous: 10 },
  daily: [{ date: '2026-09-01', deployed: 2, playground: 1 }],
  perAgent: [
    { agentId: 'a1', messages: 2, credits: 20, lastMessageAt: '2026-09-01T10:00:00.000Z' },
    { agentId: 'gone', messages: 1, credits: 10, lastMessageAt: '2026-09-01T09:00:00.000Z' },
  ],
  recent: [{ agentId: 'a1', channel: 'playground', credits: 10, at: '2026-09-01T10:00:00.000Z' }],
  perChannel: [{ channel: 'playground', messages: 3, credits: 30, lastMessageAt: '2026-09-01T10:00:00.000Z' }],
};

test('joins usage with the agent roster and totals deployments', async () => {
  const stats = await getAgentsStats('org-1', { days: 30 }, {
    listAgents: async () => [agent('a1', 'Analyst', 'active', ['active', 'revoked']), agent('a2', 'Scout', 'paused', [])],
    summarizeAgentUsage: async () => usage,
  });
  assert.deepEqual(stats.totals, { agents: 2, active: 1, paused: 1, deployments: 2, activeDeployments: 1 });
  assert.equal(stats.agents[0]?.agentId, 'a1');
  assert.equal(stats.agents[0]?.messages, 2);
  assert.equal(stats.agents[1]?.messages, 0);          // roster agent with no usage still listed
  assert.equal(stats.recent[0]?.agentName, 'Analyst');
  assert.equal(stats.messages.current, 3);
  assert.equal(stats.channels[0]?.channel, 'playground');
  assert.equal(stats.channels[0]?.messages, 3);
});

test('names usage from deleted agents safely', async () => {
  const stats = await getAgentsStats('org-1', undefined, {
    listAgents: async () => [],
    summarizeAgentUsage: async () => ({ ...usage, recent: [{ agentId: 'gone', channel: 'openai', credits: 10, at: '2026-09-01T09:00:00.000Z' }] }),
  });
  assert.equal(stats.recent[0]?.agentName, 'Deleted agent');
  assert.equal(stats.totals.agents, 0);
});
