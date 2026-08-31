import assert from "node:assert/strict";
import test from "node:test";
import type { GraphDocument } from "../domain/graph";
import {
  DEFAULT_SEND_WINDOW,
  applyAttemptSent,
  applyDecision,
  applyReply,
  applyWaitElapsed,
  clampIntoSendWindow,
  computeNextTouch,
  type MemberExecutionState,
} from "../domain/execution";

const TOUCH_A = "11111111-1111-4111-8111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";
const TOUCH_B = "33333333-3333-4333-8333-333333333333";
const GOAL = "44444444-4444-4444-8444-444444444444";
const CLOSED = "55555555-5555-4555-8555-555555555555";
const ROUTE = "66666666-6666-4666-8666-666666666666";
const WAIT = "77777777-7777-4777-8777-777777777777";
const OTHER_FUNNEL = "88888888-8888-4888-8888-888888888888";

/**
 * touch A (max 2, every 3d)
 *   responded → branch "interested?" (predicate) → yes: goal / no: touch B
 *   exhausted → wait 5d → next → touch B
 * touch B (max 1)
 *   responded → goal
 *   exhausted → route to other funnel
 * goal / closed are goals; route routes.
 */
const graph: GraphDocument = {
  entryNodeId: TOUCH_A,
  nodes: [
    { id: TOUCH_A, type: "touch", name: "Warm intro", config: { instruction: "intro", repeat: { maxAttempts: 2, intervalDays: 3 } } },
    { id: BRANCH, type: "branch", name: "Interested?", config: { condition: { kind: "predicate", prompt: "They sound interested" } } },
    { id: WAIT, type: "wait", name: "Cool off", config: { days: 5 } },
    { id: TOUCH_B, type: "touch", name: "Case study", config: { instruction: "case study", repeat: { maxAttempts: 1, intervalDays: 4 } } },
    { id: GOAL, type: "goal", name: "Booked", config: { outcome: "booked a call" } },
    { id: CLOSED, type: "goal", name: "Closed", config: { outcome: "no response" } },
    { id: ROUTE, type: "route", name: "Nurture", config: { toFunnelId: OTHER_FUNNEL } },
  ],
  edges: [
    { fromNodeId: TOUCH_A, toNodeId: BRANCH, label: "responded" },
    { fromNodeId: TOUCH_A, toNodeId: WAIT, label: "exhausted" },
    { fromNodeId: BRANCH, toNodeId: GOAL, label: "yes" },
    { fromNodeId: BRANCH, toNodeId: TOUCH_B, label: "no" },
    { fromNodeId: WAIT, toNodeId: TOUCH_B, label: "next" },
    { fromNodeId: TOUCH_B, toNodeId: GOAL, label: "responded" },
    { fromNodeId: TOUCH_B, toNodeId: ROUTE, label: "exhausted" },
  ],
  layout: {},
};

const NOW = new Date("2026-08-24T10:00:00Z"); // a Monday

function active(nodeId: string, attempt = 0): MemberExecutionState {
  return {
    currentNodeId: nodeId,
    status: "active",
    statusReason: null,
    attempt,
    enteredNodeAt: "2026-08-20T09:00:00Z",
    snoozedUntil: null,
  };
}

// --- send window clamping ---

test("a date inside the window is unchanged", () => {
  const date = new Date("2026-08-24T10:00:00Z"); // Monday 10:00 UTC
  assert.equal(clampIntoSendWindow(date, DEFAULT_SEND_WINDOW, "UTC").toISOString(), date.toISOString());
});

test("before the window opens moves to the same day's start hour", () => {
  const date = new Date("2026-08-24T06:30:00Z");
  assert.equal(clampIntoSendWindow(date, DEFAULT_SEND_WINDOW, "UTC").toISOString(), "2026-08-24T09:00:00.000Z");
});

test("after the window closes moves to the next allowed day", () => {
  const date = new Date("2026-08-24T18:30:00Z");
  assert.equal(clampIntoSendWindow(date, DEFAULT_SEND_WINDOW, "UTC").toISOString(), "2026-08-25T09:00:00.000Z");
});

test("weekends are skipped", () => {
  const saturday = new Date("2026-08-22T10:00:00Z");
  assert.equal(clampIntoSendWindow(saturday, DEFAULT_SEND_WINDOW, "UTC").toISOString(), "2026-08-24T09:00:00.000Z");
});

test("the window is evaluated in the member's timezone", () => {
  // 05:00 UTC on Monday is 10:30 in Kolkata — inside the window there.
  const date = new Date("2026-08-24T05:00:00Z");
  assert.equal(clampIntoSendWindow(date, DEFAULT_SEND_WINDOW, "Asia/Kolkata").toISOString(), date.toISOString());
  // 20:00 UTC on Monday is 01:30 Tuesday in Kolkata — clamps to Tuesday 09:00 IST (03:30 UTC).
  const late = new Date("2026-08-24T20:00:00Z");
  assert.equal(clampIntoSendWindow(late, DEFAULT_SEND_WINDOW, "Asia/Kolkata").toISOString(), "2026-08-25T03:30:00.000Z");
});

// --- due computation ---

test("first attempt is due at entry, clamped into the window", () => {
  const due = computeNextTouch({
    state: active(TOUCH_A),
    node: graph.nodes.find((node) => node.id === TOUCH_A)!,
    lastAttemptAt: null,
    window: DEFAULT_SEND_WINDOW,
    timeZone: "UTC",
  });
  assert.equal(due, "2026-08-20T09:00:00.000Z");
});

test("later attempts are due interval days after the last attempt", () => {
  const due = computeNextTouch({
    state: active(TOUCH_A, 1),
    node: graph.nodes.find((node) => node.id === TOUCH_A)!,
    lastAttemptAt: "2026-08-21T10:00:00Z", // Friday
    window: DEFAULT_SEND_WINDOW,
    timeZone: "UTC",
  });
  assert.equal(due, "2026-08-24T10:00:00.000Z"); // +3d lands Monday inside window
});

test("no attempt is due once the repeat is spent, off a touch node, paused, or snoozed", () => {
  const touchA = graph.nodes.find((node) => node.id === TOUCH_A)!;
  const base = { node: touchA, lastAttemptAt: null, window: DEFAULT_SEND_WINDOW, timeZone: "UTC" } as const;
  assert.equal(computeNextTouch({ ...base, state: active(TOUCH_A, 2) }), null);
  assert.equal(computeNextTouch({ ...base, state: { ...active(TOUCH_A), status: "paused" } }), null);
  assert.equal(computeNextTouch({ ...base, node: graph.nodes.find((node) => node.id === WAIT)! , state: active(WAIT) }), null);
  const snoozed = computeNextTouch({ ...base, state: { ...active(TOUCH_A), snoozedUntil: "2026-09-01T00:00:00Z" } });
  assert.equal(snoozed, "2026-09-01T09:00:00.000Z"); // snooze pushes the due date, not off the list
});

// --- attempt_sent walk ---

test("an attempt below the max stays on the touch awaiting the next attempt", () => {
  const result = applyAttemptSent({ graph, state: active(TOUCH_A, 0), now: NOW });
  assert.equal(result.state.attempt, 1);
  assert.equal(result.state.currentNodeId, TOUCH_A);
  assert.equal(result.state.status, "active");
});

test("the final attempt follows the exhausted edge and rests on the wait", () => {
  const result = applyAttemptSent({ graph, state: active(TOUCH_A, 1), now: NOW });
  assert.equal(result.state.currentNodeId, WAIT);
  assert.equal(result.state.attempt, 0); // reset on entering a new node
  assert.ok(result.effects.some((effect) => effect.kind === "move" && effect.edgeLabel === "exhausted"));
});

test("exhausting a touch whose exhausted edge leads to a route emits the route effect", () => {
  const result = applyAttemptSent({ graph, state: active(TOUCH_B, 0), now: NOW });
  const route = result.effects.find((effect) => effect.kind === "route");
  assert.ok(route && route.kind === "route" && route.toFunnelId === OTHER_FUNNEL);
  assert.equal(result.state.status, "exited");
});

// --- wait elapsed ---

test("an elapsed wait advances along next", () => {
  const result = applyWaitElapsed({ graph, state: active(WAIT), now: NOW });
  assert.equal(result.state.currentNodeId, TOUCH_B);
});

// --- replies ---

test("a reply on a touch with a responded edge halts at the predicate branch", () => {
  const result = applyReply({ graph, state: active(TOUCH_A, 1), classification: "positive", goalType: "reply", now: NOW });
  assert.equal(result.state.currentNodeId, BRANCH);
  assert.ok(result.pendingDecision);
  assert.equal(result.pendingDecision?.nodeId, BRANCH);
});

test("a resumed yes decision converts at the goal", () => {
  const result = applyDecision({ graph, state: active(BRANCH), nodeId: BRANCH, result: true, now: NOW });
  assert.equal(result.state.status, "converted");
  const converted = result.effects.find((effect) => effect.kind === "converted");
  assert.ok(converted && converted.kind === "converted" && converted.outcome === "booked a call");
});

test("a resumed no decision rests on the next touch", () => {
  const result = applyDecision({ graph, state: active(BRANCH), nodeId: BRANCH, result: false, now: NOW });
  assert.equal(result.state.currentNodeId, TOUCH_B);
  assert.equal(result.state.status, "active");
});

test("default routing: positive converts when the goal is reply-shaped", () => {
  const result = applyReply({ graph, state: active(TOUCH_B), classification: "positive", goalType: "positive_reply", now: NOW });
  // TOUCH_B has a responded edge to the goal, so it follows the graph.
  assert.equal(result.state.status, "converted");
});

test("default routing without a responded edge: neutral pauses, negative exits, ooo snoozes", () => {
  const bare: GraphDocument = {
    entryNodeId: TOUCH_A,
    nodes: [
      { id: TOUCH_A, type: "touch", name: "Solo", config: { instruction: "solo", repeat: { maxAttempts: 3, intervalDays: 2 } } },
      { id: CLOSED, type: "goal", name: "Closed", config: {} },
    ],
    edges: [{ fromNodeId: TOUCH_A, toNodeId: CLOSED, label: "exhausted" }],
    layout: {},
  };
  const neutral = applyReply({ graph: bare, state: active(TOUCH_A), classification: "neutral", goalType: "reply", note: "asked to circle back", now: NOW });
  assert.equal(neutral.state.status, "paused");
  assert.equal(neutral.state.statusReason, "asked to circle back");

  const negative = applyReply({ graph: bare, state: active(TOUCH_A), classification: "negative", goalType: "reply", now: NOW });
  assert.equal(negative.state.status, "exited");

  const ooo = applyReply({ graph: bare, state: active(TOUCH_A), classification: "ooo", goalType: "reply", snoozeUntil: "2026-09-02T00:00:00Z", now: NOW });
  assert.equal(ooo.state.status, "active");
  assert.equal(ooo.state.snoozedUntil, "2026-09-02T00:00:00.000Z");

  const positive = applyReply({ graph: bare, state: active(TOUCH_A), classification: "positive", goalType: "manual", now: NOW });
  assert.equal(positive.state.status, "paused"); // goal is not reply-shaped → a human decides
});

test("a negative reply never follows the responded arrow into a goal", () => {
  // TOUCH_B's responded arrow points straight at the goal.
  const result = applyReply({ graph, state: active(TOUCH_B), classification: "negative", goalType: "reply", now: NOW });
  assert.equal(result.state.status, "exited");
  assert.equal(result.state.currentNodeId, TOUCH_B);
});

test("an out-of-office reply snoozes instead of following the graph", () => {
  const result = applyReply({ graph, state: active(TOUCH_B), classification: "ooo", goalType: "reply", now: NOW });
  assert.equal(result.state.status, "active");
  assert.equal(result.state.currentNodeId, TOUCH_B);
  assert.ok(result.state.snoozedUntil);
});

test("an unsubscribe reply always unsubscribes, whatever the graph says", () => {
  const result = applyReply({ graph, state: active(TOUCH_A), classification: "unsubscribe", goalType: "reply", now: NOW });
  assert.equal(result.state.status, "unsubscribed");
  assert.equal(result.state.currentNodeId, TOUCH_A); // rails do not move the cursor
});

test("event branches consume the reply that triggered the walk", () => {
  const eventGraph: GraphDocument = {
    entryNodeId: TOUCH_A,
    nodes: [
      { id: TOUCH_A, type: "touch", name: "Intro", config: { instruction: "intro", repeat: { maxAttempts: 1, intervalDays: 2 } } },
      { id: BRANCH, type: "branch", name: "Was it positive?", config: { condition: { kind: "event", event: "positive_reply" } } },
      { id: GOAL, type: "goal", name: "Won", config: { outcome: "won" } },
      { id: CLOSED, type: "goal", name: "Closed", config: {} },
    ],
    edges: [
      { fromNodeId: TOUCH_A, toNodeId: BRANCH, label: "responded" },
      { fromNodeId: TOUCH_A, toNodeId: CLOSED, label: "exhausted" },
      { fromNodeId: BRANCH, toNodeId: GOAL, label: "yes" },
      { fromNodeId: BRANCH, toNodeId: CLOSED, label: "no" },
    ],
    layout: {},
  };
  const positive = applyReply({ graph: eventGraph, state: active(TOUCH_A), classification: "positive", goalType: "reply", now: NOW });
  assert.equal(positive.state.status, "converted");
  const neutral = applyReply({ graph: eventGraph, state: active(TOUCH_A), classification: "neutral", goalType: "reply", now: NOW });
  assert.equal(neutral.state.status, "converted"); // lands on Closed, still a goal
  const decided = neutral.effects.find((effect) => effect.kind === "decided");
  assert.ok(decided && decided.kind === "decided" && decided.result === false);
});

test("attribute branches compare contact attributes in code", () => {
  const attributeGraph: GraphDocument = {
    entryNodeId: TOUCH_A,
    nodes: [
      { id: TOUCH_A, type: "touch", name: "Intro", config: { instruction: "intro", repeat: { maxAttempts: 1, intervalDays: 2 } } },
      { id: BRANCH, type: "branch", name: "Enterprise?", config: { condition: { kind: "attribute", key: "segment", equals: "enterprise" } } },
      { id: GOAL, type: "goal", name: "Won", config: {} },
      { id: CLOSED, type: "goal", name: "Closed", config: {} },
    ],
    edges: [
      { fromNodeId: TOUCH_A, toNodeId: BRANCH, label: "responded" },
      { fromNodeId: TOUCH_A, toNodeId: CLOSED, label: "exhausted" },
      { fromNodeId: BRANCH, toNodeId: GOAL, label: "yes" },
      { fromNodeId: BRANCH, toNodeId: CLOSED, label: "no" },
    ],
    layout: {},
  };
  const yes = applyReply({
    graph: attributeGraph,
    state: active(TOUCH_A),
    classification: "neutral",
    goalType: "reply",
    attributes: { segment: "Enterprise" },
    now: NOW,
  });
  const decidedYes = yes.effects.find((effect) => effect.kind === "decided");
  assert.ok(decidedYes && decidedYes.kind === "decided" && decidedYes.result === true);
});
