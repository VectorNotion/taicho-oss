import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyAgentUsageSummary,
  summarizeAgentUsageRows,
  type AgentUsageEventRow,
} from "../commercial/agent-usage";

const NOW = new Date("2026-09-02T12:00:00.000Z");
const day = (offset: number, hour = 6) =>
  new Date(NOW.getTime() - offset * 86_400_000 + hour * 3_600_000 - 12 * 3_600_000).toISOString();

function row(overrides: Partial<AgentUsageEventRow>): AgentUsageEventRow {
  return { agentId: "agent-1", channel: "openai", credits: 10, createdAt: day(1), ...overrides };
}

test("empty summary has a full zero-filled daily window", () => {
  const summary = emptyAgentUsageSummary(30, NOW);
  assert.equal(summary.window.days, 30);
  assert.equal(summary.daily.length, 30);
  assert.ok(summary.daily.every((point) => point.deployed === 0 && point.playground === 0));
  assert.deepEqual(summary.messages, { current: 0, previous: 0 });
  assert.deepEqual(summary.credits, { current: 0, previous: 0 });
  assert.deepEqual(summary.perAgent, []);
  assert.deepEqual(summary.perChannel, []);
  assert.deepEqual(summary.recent, []);
});

test("splits current and previous windows and buckets by channel", () => {
  const rows = [
    row({ createdAt: day(1), channel: "playground" }),
    row({ createdAt: day(2), channel: "openai" }),
    row({ createdAt: day(2), channel: "openai", credits: 5 }),
    row({ createdAt: day(35), channel: "openai" }), // previous window
    row({ createdAt: day(70), channel: "openai" }), // outside both windows
  ];
  const summary = summarizeAgentUsageRows(rows, { days: 30, now: NOW });
  assert.equal(summary.messages.current, 3);
  assert.equal(summary.messages.previous, 1);
  assert.equal(summary.credits.current, 25);
  assert.equal(summary.credits.previous, 10);
  assert.equal(summary.daily.length, 30);
  const byDate = Object.fromEntries(summary.daily.map((p) => [p.date, p]));
  assert.equal(byDate[day(1).slice(0, 10)]?.playground, 1);
  assert.equal(byDate[day(2).slice(0, 10)]?.deployed, 2);
  assert.deepEqual(summary.perChannel.map((c) => c.channel), ['openai', 'playground']);
  assert.equal(summary.perChannel[0]?.messages, 2);
  assert.equal(summary.perChannel[0]?.credits, 15);
});

test("aggregates per agent and caps recent at 10 newest", () => {
  const rows: AgentUsageEventRow[] = [];
  for (let i = 0; i < 12; i += 1) rows.push(row({ createdAt: day(3, i % 10), agentId: i % 2 ? "agent-2" : "agent-1" }));
  const summary = summarizeAgentUsageRows(rows, { days: 30, now: NOW });
  assert.equal(summary.recent.length, 10);
  const newest = Math.max(...rows.map((r) => Date.parse(r.createdAt)));
  assert.equal(Date.parse(summary.recent[0]!.at), newest);
  const agentOne = summary.perAgent.find((entry) => entry.agentId === "agent-1");
  assert.equal(agentOne?.messages, 6);
  assert.equal(agentOne?.credits, 60);
  const agentOneNewest = Math.max(...rows.filter((r) => r.agentId === "agent-1").map((r) => Date.parse(r.createdAt)));
  assert.equal(Date.parse(agentOne?.lastMessageAt ?? ""), agentOneNewest);
});

import { UnmeteredCommercialProvider, summarizeAgentUsage, setCommercialProvider, commercialProvider } from "../commercial/provider";

test("unmetered provider returns an empty usage summary", async () => {
  const summary = await new UnmeteredCommercialProvider().summarizeAgentUsage("org-1", { days: 14 });
  assert.equal(summary.window.days, 14);
  assert.equal(summary.messages.current, 0);
  assert.equal(summary.daily.length, 14);
});

test("facade falls back to the empty summary when the installed provider lacks the method", async () => {
  const original = commercialProvider();
  try {
    setCommercialProvider({ ...original, summarizeAgentUsage: undefined } as never);
    const summary = await summarizeAgentUsage("org-1");
    assert.equal(summary.messages.current, 0);
    assert.equal(summary.window.days, 30);
  } finally {
    setCommercialProvider(original);
  }
});
