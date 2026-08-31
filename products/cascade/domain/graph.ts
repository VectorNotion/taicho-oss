import { z } from "zod";

export const NODE_TYPES = ["touch", "wait", "branch", "goal", "route"] as const;
export const EDGE_LABELS = ["next", "yes", "no", "responded", "exhausted"] as const;
export const MEMBER_STATUSES = [
  "active",
  "paused",
  "converted",
  "exhausted",
  "exited",
  "unsubscribed",
] as const;

const touchConfig = z.object({
  instruction: z.string().max(20_000).default(""),
  repeat: z
    .object({
      maxAttempts: z.number().int().min(1).max(10).default(1),
      intervalDays: z.number().int().min(1).max(90).default(3),
    })
    .default({ maxAttempts: 1, intervalDays: 3 }),
});
const waitConfig = z.object({ days: z.number().int().min(0).max(365) });
const branchCondition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), event: z.enum(["replied", "positive_reply", "clicked", "opened"]) }),
  z.object({ kind: z.literal("attribute"), key: z.string().min(1).max(200), equals: z.string().max(500) }),
  z.object({ kind: z.literal("predicate"), prompt: z.string().min(1).max(5_000) }),
]);
const branchConfig = z.object({ condition: branchCondition });
const goalConfig = z.object({ outcome: z.string().max(200).optional() });
const routeConfig = z.object({ toFunnelId: z.string().uuid() });

const graphNodeSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().uuid(), type: z.literal("touch"), name: z.string().max(300), config: touchConfig }),
  z.object({ id: z.string().uuid(), type: z.literal("wait"), name: z.string().max(300), config: waitConfig }),
  z.object({ id: z.string().uuid(), type: z.literal("branch"), name: z.string().max(300), config: branchConfig }),
  z.object({ id: z.string().uuid(), type: z.literal("goal"), name: z.string().max(300), config: goalConfig }),
  z.object({ id: z.string().uuid(), type: z.literal("route"), name: z.string().max(300), config: routeConfig }),
]);
const graphEdgeSchema = z.object({
  fromNodeId: z.string().uuid(),
  toNodeId: z.string().uuid(),
  label: z.enum(EDGE_LABELS),
});
export const graphDocumentSchema = z.object({
  entryNodeId: z.string().uuid().nullable(),
  nodes: z.array(graphNodeSchema).max(200),
  edges: z.array(graphEdgeSchema).max(500),
  layout: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).default({}),
});

export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type GraphDocument = z.infer<typeof graphDocumentSchema>;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

const ALLOWED_OUT: Record<GraphNode["type"], readonly string[]> = {
  touch: ["responded", "exhausted"],
  wait: ["next"],
  branch: ["yes", "no"],
  goal: [],
  route: [],
};
const REQUIRED_OUT: Record<GraphNode["type"], readonly string[]> = {
  touch: ["exhausted"],
  wait: ["next"],
  branch: ["yes", "no"],
  goal: [],
  route: [],
};

function labelPhrase(label: string): string {
  if (label === "exhausted") return "no response";
  if (label === "responded") return "they responded";
  return label;
}

/** Returns human-readable violations; an empty array means the graph is publishable. */
export function validateGraph(doc: GraphDocument): string[] {
  const errors: string[] = [];
  if (doc.nodes.length === 0) return ["The funnel needs at least one step."];
  const nodeById = new Map(doc.nodes.map((node) => [node.id, node]));
  if (!doc.entryNodeId || !nodeById.has(doc.entryNodeId)) errors.push("The funnel has no entry step.");

  const seenLabels = new Set<string>();
  for (const edge of doc.edges) {
    const from = nodeById.get(edge.fromNodeId);
    if (!from || !nodeById.has(edge.toNodeId)) {
      errors.push("An arrow points at an unknown step.");
      continue;
    }
    if (!ALLOWED_OUT[from.type].includes(edge.label)) {
      errors.push(`"${from.name || from.type}" cannot have a "${labelPhrase(edge.label)}" arrow — illegal label for this step.`);
    }
    const key = `${edge.fromNodeId}:${edge.label}`;
    if (seenLabels.has(key)) errors.push(`"${from.name || from.type}" has two "${labelPhrase(edge.label)}" arrows.`);
    seenLabels.add(key);
  }

  for (const node of doc.nodes) {
    for (const required of REQUIRED_OUT[node.type]) {
      if (!doc.edges.some((edge) => edge.fromNodeId === node.id && edge.label === required)) {
        errors.push(`"${node.name || node.type}" is missing its "${labelPhrase(required)}" arrow.`);
      }
    }
  }

  if (doc.entryNodeId && nodeById.has(doc.entryNodeId)) {
    const reachable = new Set<string>([doc.entryNodeId]);
    const queue = [doc.entryNodeId];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const edge of doc.edges) {
        if (edge.fromNodeId === current && nodeById.has(edge.toNodeId) && !reachable.has(edge.toNodeId)) {
          reachable.add(edge.toNodeId);
          queue.push(edge.toNodeId);
        }
      }
    }
    for (const node of doc.nodes) {
      if (!reachable.has(node.id)) errors.push(`"${node.name || node.type}" is unreachable from the entry step.`);
    }
  }

  const color = new Map<string, 1 | 2>();
  const hasCycle = (id: string): boolean => {
    color.set(id, 1);
    for (const edge of doc.edges) {
      if (edge.fromNodeId !== id || !nodeById.has(edge.toNodeId)) continue;
      const state = color.get(edge.toNodeId);
      if (state === 1) return true;
      if (!state && hasCycle(edge.toNodeId)) return true;
    }
    color.set(id, 2);
    return false;
  };
  if (doc.nodes.some((node) => !color.has(node.id) && hasCycle(node.id))) {
    errors.push("The funnel loops back on itself — steps only ever move forward.");
  }

  return errors;
}
