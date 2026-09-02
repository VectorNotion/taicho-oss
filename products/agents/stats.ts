import {
  summarizeAgentUsage as platformSummarizeAgentUsage,
  type AgentUsageSummary,
} from '@content-automation/platform/commercial';
import type { AgentWithDeployments } from './domain';
import { listAgents as repositoryListAgents } from './repository';

export interface AgentsStats {
  totals: { agents: number; active: number; paused: number; deployments: number; activeDeployments: number };
  window: { days: number; from: string; to: string };
  messages: { current: number; previous: number };
  credits: { current: number; previous: number };
  daily: Array<{ date: string; deployed: number; playground: number }>;
  agents: Array<{ agentId: string; name: string; status: 'active' | 'paused'; messages: number; credits: number; lastMessageAt: string | null }>;
  channels: Array<{ channel: string; messages: number; credits: number; lastMessageAt: string | null }>;
  recent: Array<{ agentId: string; agentName: string; channel: string; credits: number; at: string }>;
}

interface StatsDeps {
  listAgents: (organizationId: string) => Promise<AgentWithDeployments[]>;
  summarizeAgentUsage: (organizationId: string, options?: { days?: number }) => Promise<AgentUsageSummary>;
}

const DELETED_AGENT_NAME = 'Deleted agent';

export async function getAgentsStats(
  organizationId: string,
  options?: { days?: number },
  deps: StatsDeps = { listAgents: repositoryListAgents, summarizeAgentUsage: platformSummarizeAgentUsage },
): Promise<AgentsStats> {
  const [roster, usage] = await Promise.all([
    deps.listAgents(organizationId),
    deps.summarizeAgentUsage(organizationId, { days: options?.days ?? 30 }),
  ]);
  const names = new Map(roster.map(({ agent }) => [agent.id, agent.name]));
  const usageByAgent = new Map(usage.perAgent.map((entry) => [entry.agentId, entry]));
  const deployments = roster.flatMap((item) => item.deployments);
  return {
    totals: {
      agents: roster.length,
      active: roster.filter(({ agent }) => agent.status === 'active').length,
      paused: roster.filter(({ agent }) => agent.status === 'paused').length,
      deployments: deployments.length,
      activeDeployments: deployments.filter((deployment) => deployment.status === 'active').length,
    },
    window: usage.window,
    messages: usage.messages,
    credits: usage.credits,
    daily: usage.daily,
    channels: usage.perChannel,
    agents: roster
      .map(({ agent }) => {
        const entry = usageByAgent.get(agent.id);
        return {
          agentId: agent.id, name: agent.name, status: agent.status,
          messages: entry?.messages ?? 0, credits: entry?.credits ?? 0,
          lastMessageAt: entry?.lastMessageAt ?? null,
        };
      })
      .sort((a, b) => b.messages - a.messages),
    recent: usage.recent.map((message) => ({
      ...message, agentName: names.get(message.agentId) ?? DELETED_AGENT_NAME,
    })),
  };
}
