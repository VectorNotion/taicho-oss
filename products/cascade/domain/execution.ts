import { z } from "zod";
import type { GraphDocument, GraphNode, GraphEdge, MemberStatus } from "./graph";

/**
 * Pure execution semantics for the funnel automation graph: send-window
 * clamping, due computation, and the cursor walk. No I/O, no clocks —
 * callers pass `now`. Repositories apply the returned effects
 * transactionally; nothing here schedules or sends.
 */

export type EdgeLabel = GraphEdge["label"];
export type BranchCondition = Extract<GraphNode, { type: "branch" }>["config"]["condition"];
export type ReplyClassification = "positive" | "neutral" | "negative" | "ooo" | "unsubscribe";
export type GoalType = "reply" | "positive_reply" | "meeting_booked" | "manual";

export interface SendWindow {
  /** Allowed weekdays, 0 = Sunday … 6 = Saturday. */
  days: number[];
  startHour: number;
  endHour: number;
}

export const DEFAULT_SEND_WINDOW: SendWindow = { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 };

export const sendWindowSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(1).max(24),
}).refine((window) => window.endHour > window.startHour, { message: "The window must close after it opens." });

export const GOAL_TYPES = ["reply", "positive_reply", "meeting_booked", "manual"] as const;
export const REPLY_CLASSIFICATIONS = ["positive", "neutral", "negative", "ooo", "unsubscribe"] as const;

export interface MemberExecutionState {
  currentNodeId: string | null;
  status: MemberStatus;
  statusReason: string | null;
  attempt: number;
  enteredNodeAt: string | null;
  snoozedUntil: string | null;
}

// --- timezone-aware send window -------------------------------------------

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function zonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: parts.hour === "24" ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday ?? "Sun"),
  };
}

/** The UTC instant reading as (year, month, day, hour):00:00 on the zone's wall clock. */
function instantAt(timeZone: string, year: number, month: number, day: number, hour: number): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, 0, 0);
  let guess = wanted;
  for (let pass = 0; pass < 3; pass += 1) {
    const read = zonedParts(new Date(guess), timeZone);
    const readMs = Date.UTC(read.year, read.month - 1, read.day, read.hour, read.minute, read.second);
    if (readMs === wanted) break;
    guess += wanted - readMs;
  }
  return new Date(guess);
}

/** The earliest instant at or after `date` inside the window, on the member's wall clock. */
export function clampIntoSendWindow(date: Date, window: SendWindow, timeZone: string): Date {
  const days = window.days.length > 0 ? window.days : DEFAULT_SEND_WINDOW.days;
  let candidate = date;
  for (let hop = 0; hop < 15; hop += 1) {
    const parts = zonedParts(candidate, timeZone);
    const dayAllowed = days.includes(parts.weekday);
    if (dayAllowed && parts.hour >= window.startHour && parts.hour < window.endHour) return candidate;
    if (dayAllowed && parts.hour < window.startHour) {
      return instantAt(timeZone, parts.year, parts.month, parts.day, window.startHour);
    }
    candidate = instantAt(timeZone, parts.year, parts.month, parts.day + 1, window.startHour);
  }
  return candidate;
}

// --- due computation --------------------------------------------------------

/**
 * When the member's next touch attempt is due (ISO), or null when nothing is
 * due: not standing on this touch, not active, or the repeat is spent.
 * A snooze pushes the due date; it never removes the member from the list.
 */
export function computeNextTouch(input: {
  state: MemberExecutionState;
  node: GraphNode;
  lastAttemptAt: string | null;
  window?: SendWindow | null;
  timeZone?: string | null;
}): string | null {
  const { state, node } = input;
  if (node.type !== "touch") return null;
  if (state.status !== "active") return null;
  if (state.currentNodeId !== node.id) return null;
  const repeat = node.config.repeat;
  if (state.attempt >= repeat.maxAttempts) return null;

  let candidateMs: number;
  if (state.attempt > 0 && input.lastAttemptAt) {
    candidateMs = Date.parse(input.lastAttemptAt) + repeat.intervalDays * 86_400_000;
  } else {
    candidateMs = state.enteredNodeAt ? Date.parse(state.enteredNodeAt) : Date.now();
  }
  if (state.snoozedUntil) candidateMs = Math.max(candidateMs, Date.parse(state.snoozedUntil));

  const window = input.window ?? DEFAULT_SEND_WINDOW;
  const timeZone = input.timeZone || "UTC";
  return clampIntoSendWindow(new Date(candidateMs), window, timeZone).toISOString();
}

// --- the cursor walk ---------------------------------------------------------

export type WalkEffect =
  | { kind: "move"; nodeId: string; edgeLabel: EdgeLabel }
  | { kind: "converted"; nodeId: string; outcome: string }
  | { kind: "route"; nodeId: string; toFunnelId: string }
  | { kind: "decided"; nodeId: string; condition: BranchCondition; result: boolean; rationale: string }
  | { kind: "status"; status: MemberStatus; reason: string | null }
  | { kind: "snoozed"; until: string };

export interface WalkResult {
  state: MemberExecutionState;
  effects: WalkEffect[];
  /** A brain predicate the caller must evaluate, then resume with applyDecision. */
  pendingDecision?: { nodeId: string; condition: BranchCondition };
}

interface WalkContext {
  reply?: ReplyClassification;
  attributes?: Record<string, unknown>;
  signals?: { clicked?: boolean; opened?: boolean };
  decisions?: Record<string, boolean>;
}

function nodeById(graph: GraphDocument, id: string | null): GraphNode | undefined {
  return graph.nodes.find((node) => node.id === id);
}

function edgeFrom(graph: GraphDocument, fromNodeId: string, label: EdgeLabel): GraphEdge | undefined {
  return graph.edges.find((edge) => edge.fromNodeId === fromNodeId && edge.label === label);
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function evaluateInCode(condition: BranchCondition, ctx: WalkContext): { result: boolean; rationale: string } | null {
  if (condition.kind === "event") {
    if (condition.event === "replied") {
      const replied = ctx.reply !== undefined;
      return { result: replied, rationale: replied ? "they replied" : "no reply seen" };
    }
    if (condition.event === "positive_reply") {
      const positive = ctx.reply === "positive";
      return { result: positive, rationale: positive ? "their reply read positive" : `their reply read ${ctx.reply ?? "as nothing"}` };
    }
    const seen = Boolean(ctx.signals?.[condition.event]);
    return { result: seen, rationale: seen ? `${condition.event} signal reported` : `no ${condition.event} signal reported` };
  }
  if (condition.kind === "attribute") {
    const actual = normalized(ctx.attributes?.[condition.key]);
    const result = actual === normalized(condition.equals);
    return { result, rationale: `${condition.key} is "${actual || "unset"}"` };
  }
  return null; // predicates are the brain's job
}

function walk(
  graph: GraphDocument,
  initial: MemberExecutionState,
  fromNodeId: string,
  label: EdgeLabel,
  ctx: WalkContext,
  now: Date,
): WalkResult {
  let state = { ...initial };
  const effects: WalkEffect[] = [];

  let cursor: { fromNodeId: string; label: EdgeLabel } | null = { fromNodeId, label };
  for (let hop = 0; hop < graph.nodes.length + 1 && cursor; hop += 1) {
    const edge = edgeFrom(graph, cursor.fromNodeId, cursor.label);
    if (!edge) break; // validation guarantees required edges; stop rather than guess
    const node = nodeById(graph, edge.toNodeId);
    if (!node) break;

    effects.push({ kind: "move", nodeId: node.id, edgeLabel: cursor.label });
    state = { ...state, currentNodeId: node.id, attempt: 0, enteredNodeAt: now.toISOString() };
    cursor = null;

    if (node.type === "goal") {
      const outcome = node.config.outcome?.trim() || node.name || "converted";
      effects.push({ kind: "converted", nodeId: node.id, outcome });
      state = { ...state, status: "converted", statusReason: outcome };
    } else if (node.type === "route") {
      effects.push({ kind: "route", nodeId: node.id, toFunnelId: node.config.toFunnelId });
      state = { ...state, status: "exited", statusReason: `routed to another funnel` };
    } else if (node.type === "branch") {
      const condition = node.config.condition;
      const supplied = ctx.decisions?.[node.id];
      const evaluated = supplied !== undefined
        ? { result: supplied, rationale: "" }
        : evaluateInCode(condition, ctx);
      if (!evaluated) {
        return { state, effects, pendingDecision: { nodeId: node.id, condition } };
      }
      effects.push({ kind: "decided", nodeId: node.id, condition, result: evaluated.result, rationale: evaluated.rationale });
      cursor = { fromNodeId: node.id, label: evaluated.result ? "yes" : "no" };
    }
    // touch and wait are resting nodes: the walk ends here.
  }

  return { state, effects };
}

/** The executor reported one attempt sent for the member's current touch. */
export function applyAttemptSent(input: { graph: GraphDocument; state: MemberExecutionState; now: Date }): WalkResult {
  const { graph, state, now } = input;
  const node = nodeById(graph, state.currentNodeId);
  if (!node || node.type !== "touch") {
    return { state, effects: [] };
  }
  const attempt = state.attempt + 1;
  if (attempt < node.config.repeat.maxAttempts) {
    return { state: { ...state, attempt }, effects: [] };
  }
  return walk(graph, { ...state, attempt }, node.id, "exhausted", {}, now);
}

/** A wait node's days have elapsed; advance along its next arrow. */
export function applyWaitElapsed(input: { graph: GraphDocument; state: MemberExecutionState; now: Date }): WalkResult {
  const { graph, state, now } = input;
  const node = nodeById(graph, state.currentNodeId);
  if (!node || node.type !== "wait") return { state, effects: [] };
  return walk(graph, state, node.id, "next", {}, now);
}

/** A classified reply arrived. Global rails first, then the graph, then default routing. */
export function applyReply(input: {
  graph: GraphDocument;
  state: MemberExecutionState;
  classification: ReplyClassification;
  goalType: GoalType | string;
  note?: string;
  snoozeUntil?: string;
  attributes?: Record<string, unknown>;
  now: Date;
}): WalkResult {
  const { graph, state, classification, now } = input;

  if (classification === "unsubscribe") {
    const next = { ...state, status: "unsubscribed" as MemberStatus, statusReason: "unsubscribe request", snoozedUntil: null };
    return { state: next, effects: [{ kind: "status", status: "unsubscribed", reason: "unsubscribe request" }] };
  }

  // Only positive and neutral replies follow the author's responded arrow;
  // negative and out-of-office always take the default routing below, so a
  // "they responded → goal" wiring can never convert someone who said no.
  const node = nodeById(graph, state.currentNodeId);
  const followsGraph = classification === "positive" || classification === "neutral";
  if (followsGraph && node?.type === "touch" && edgeFrom(graph, node.id, "responded")) {
    return walk(graph, state, node.id, "responded", { reply: classification, attributes: input.attributes }, now);
  }

  // Default reply routing — no branch consumed the reply.
  if (classification === "positive") {
    const replyShaped = input.goalType === "reply" || input.goalType === "positive_reply";
    if (replyShaped) {
      const next = { ...state, status: "converted" as MemberStatus, statusReason: input.note ?? "positive reply" };
      return { state: next, effects: [{ kind: "status", status: "converted", reason: next.statusReason }] };
    }
    const reason = input.note ?? "positive reply — needs a human";
    return {
      state: { ...state, status: "paused", statusReason: reason },
      effects: [{ kind: "status", status: "paused", reason }],
    };
  }
  if (classification === "neutral") {
    const reason = input.note ?? "neutral reply — needs a human";
    return {
      state: { ...state, status: "paused", statusReason: reason },
      effects: [{ kind: "status", status: "paused", reason }],
    };
  }
  if (classification === "negative") {
    const reason = input.note ?? "negative reply";
    return {
      state: { ...state, status: "exited", statusReason: reason },
      effects: [{ kind: "status", status: "exited", reason }],
    };
  }
  // out of office
  const until = new Date(input.snoozeUntil ? Date.parse(input.snoozeUntil) : now.getTime() + 7 * 86_400_000).toISOString();
  return {
    state: { ...state, snoozedUntil: until },
    effects: [{ kind: "snoozed", until }],
  };
}

/** Resume a walk halted at a brain predicate with the evaluated answer. */
export function applyDecision(input: {
  graph: GraphDocument;
  state: MemberExecutionState;
  nodeId: string;
  result: boolean;
  rationale?: string;
  now: Date;
}): WalkResult {
  const { graph, state, nodeId, now } = input;
  const node = nodeById(graph, nodeId);
  if (!node || node.type !== "branch") return { state, effects: [] };
  const effects: WalkEffect[] = [{
    kind: "decided",
    nodeId,
    condition: node.config.condition,
    result: input.result,
    rationale: input.rationale ?? "",
  }];
  const walked = walk(graph, state, nodeId, input.result ? "yes" : "no", {}, now);
  return { state: walked.state, effects: [...effects, ...walked.effects], pendingDecision: walked.pendingDecision };
}
