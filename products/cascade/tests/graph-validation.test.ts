import assert from "node:assert/strict";
import test from "node:test";
import { validateGraph, type GraphDocument, type GraphNode } from "../domain/graph";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const touch = (id: string): GraphNode => ({
  id,
  type: "touch",
  name: `touch-${id.slice(0, 4)}`,
  config: { instruction: "write something", repeat: { maxAttempts: 1, intervalDays: 3 } },
});
const goal = (id: string): GraphNode => ({ id, type: "goal", name: "goal", config: {} });
const edge = (from: string, to: string, label: "next" | "yes" | "no" | "responded" | "exhausted") => ({
  fromNodeId: from,
  toNodeId: to,
  label,
});
const doc = (partial: Partial<GraphDocument>): GraphDocument => ({
  entryNodeId: A,
  nodes: [],
  edges: [],
  layout: {},
  ...partial,
});

test("accepts a touch that exhausts into a goal", () => {
  assert.deepEqual(validateGraph(doc({ nodes: [touch(A), goal(B)], edges: [edge(A, B, "exhausted")] })), []);
});

test("rejects a missing entry node", () => {
  const errors = validateGraph(doc({ entryNodeId: null, nodes: [touch(A)] }));
  assert.match(errors[0] ?? "", /entry/i);
});

test("rejects edges to unknown nodes", () => {
  const errors = validateGraph(doc({ nodes: [touch(A)], edges: [edge(A, B, "exhausted")] }));
  assert.match(errors.join(" "), /unknown/i);
});

test("rejects labels illegal for the node type", () => {
  const errors = validateGraph(doc({ nodes: [touch(A), goal(B)], edges: [edge(A, B, "yes")] }));
  assert.match(errors.join(" "), /label|cannot/i);
});

test("requires both yes and no on a branch", () => {
  const branch: GraphNode = {
    id: B,
    type: "branch",
    name: "interested?",
    config: { condition: { kind: "event", event: "replied" } },
  };
  const errors = validateGraph(doc({
    nodes: [touch(A), branch, goal(C)],
    edges: [edge(A, B, "exhausted"), edge(B, C, "yes")],
  }));
  assert.match(errors.join(" "), /"no"/);
});

test("rejects unreachable nodes", () => {
  const errors = validateGraph(doc({ nodes: [touch(A), goal(B), goal(C)], edges: [edge(A, B, "exhausted")] }));
  assert.match(errors.join(" "), /unreachable/i);
});

test("rejects cycles because the funnel is forward-only", () => {
  const errors = validateGraph(doc({
    nodes: [touch(A), touch(B)],
    edges: [edge(A, B, "exhausted"), edge(B, A, "exhausted")],
  }));
  assert.ok(errors.some((message) => /loop|forward/i.test(message)), errors.join("; "));
});

test("rejects duplicate labels from one node", () => {
  const errors = validateGraph(doc({
    nodes: [touch(A), goal(B), goal(C)],
    edges: [edge(A, B, "exhausted"), edge(A, C, "exhausted")],
  }));
  assert.match(errors.join(" "), /two/i);
});
