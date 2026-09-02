/**
 * Pure aggregation for external-agent usage. The metered commerce provider
 * fetches raw usage_event rows (kind='agent_action' with metadata.agentId)
 * and delegates all window/bucket math here so it is testable without a
 * database; the unmetered provider returns emptyAgentUsageSummary.
 */
export interface AgentUsageEventRow {
  agentId: string;
  channel: string;
  credits: number;
  createdAt: string;
}

export interface AgentUsageDailyPoint { date: string; deployed: number; playground: number }
export interface AgentUsagePerAgent { agentId: string; messages: number; credits: number; lastMessageAt: string | null }
export interface AgentUsageRecentMessage { agentId: string; channel: string; credits: number; at: string }
export interface AgentUsageChannelActivity { channel: string; messages: number; credits: number; lastMessageAt: string | null }

export interface AgentUsageSummary {
  window: { days: number; from: string; to: string };
  messages: { current: number; previous: number };
  credits: { current: number; previous: number };
  daily: AgentUsageDailyPoint[];
  perAgent: AgentUsagePerAgent[];
  perChannel: AgentUsageChannelActivity[];
  recent: AgentUsageRecentMessage[];
}

const DAY_MS = 86_400_000;
const RECENT_LIMIT = 10;

function dateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function zeroDaily(days: number, from: number): AgentUsageDailyPoint[] {
  return Array.from({ length: days }, (_, index) => ({
    date: dateKey(from + index * DAY_MS),
    deployed: 0,
    playground: 0,
  }));
}

export function emptyAgentUsageSummary(days: number, now: Date = new Date()): AgentUsageSummary {
  const to = now.getTime();
  const from = to - days * DAY_MS;
  return {
    window: { days, from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    messages: { current: 0, previous: 0 },
    credits: { current: 0, previous: 0 },
    daily: zeroDaily(days, from),
    perAgent: [],
    perChannel: [],
    recent: [],
  };
}

export function summarizeAgentUsageRows(
  rows: AgentUsageEventRow[],
  options: { days: number; now?: Date },
): AgentUsageSummary {
  const summary = emptyAgentUsageSummary(options.days, options.now);
  const to = Date.parse(summary.window.to);
  const from = Date.parse(summary.window.from);
  const previousFrom = from - options.days * DAY_MS;
  const byDate = new Map(summary.daily.map((point) => [point.date, point]));
  const perAgent = new Map<string, AgentUsagePerAgent>();
  const perChannel = new Map<string, AgentUsageChannelActivity>();
  const current: AgentUsageEventRow[] = [];

  for (const row of rows) {
    const at = Date.parse(row.createdAt);
    if (Number.isNaN(at) || at >= to || at < previousFrom) continue;
    if (at < from) {
      summary.messages.previous += 1;
      summary.credits.previous += row.credits;
      continue;
    }
    current.push(row);
    summary.messages.current += 1;
    summary.credits.current += row.credits;
    const point = byDate.get(dateKey(at));
    if (point) {
      if (row.channel === "playground") point.playground += 1;
      else point.deployed += 1;
    }
    const entry = perAgent.get(row.agentId) ?? { agentId: row.agentId, messages: 0, credits: 0, lastMessageAt: null };
    entry.messages += 1;
    entry.credits += row.credits;
    if (!entry.lastMessageAt || Date.parse(entry.lastMessageAt) < at) entry.lastMessageAt = row.createdAt;
    perAgent.set(row.agentId, entry);
    const channelEntry = perChannel.get(row.channel) ?? { channel: row.channel, messages: 0, credits: 0, lastMessageAt: null };
    channelEntry.messages += 1;
    channelEntry.credits += row.credits;
    if (!channelEntry.lastMessageAt || Date.parse(channelEntry.lastMessageAt) < at) channelEntry.lastMessageAt = row.createdAt;
    perChannel.set(row.channel, channelEntry);
  }

  summary.perAgent = [...perAgent.values()].sort((a, b) => b.messages - a.messages);
  summary.perChannel = [...perChannel.values()].sort((a, b) => b.messages - a.messages);
  summary.recent = current
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, RECENT_LIMIT)
    .map((row) => ({ agentId: row.agentId, channel: row.channel, credits: row.credits, at: row.createdAt }));
  return summary;
}
