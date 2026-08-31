import type { GraphDocument } from "./graph";

export interface FunnelTemplate {
  key: string;
  name: string;
  description: string;
  /** Touch names in walk order, shown as the template preview. */
  stepSummary: string[];
  /** null seeds no graph — the funnel starts on an empty canvas. */
  build: (() => GraphDocument) | null;
}

const id = () => crypto.randomUUID();

export const blankTemplate: FunnelTemplate = {
  key: "blank",
  name: "Blank canvas",
  description: "Start empty and design every step yourself in the builder.",
  stepSummary: ["Your first touch"],
  build: null,
};

const followUpSequence: FunnelTemplate = {
  key: "follow-up-sequence",
  name: "Intro and follow-ups",
  description: "A warm intro that nudges up to three times, then one break-up note before closing out.",
  stepSummary: ["Warm intro", "Break-up note"],
  build: () => {
    const intro = id();
    const breakup = id();
    const replied = id();
    const closed = id();
    return {
      entryNodeId: intro,
      nodes: [
        {
          id: intro,
          type: "touch",
          name: "Warm intro",
          config: {
            instruction:
              "Write a short first-touch email referencing something recent and specific about their company from research.",
            repeat: { maxAttempts: 3, intervalDays: 3 },
          },
        },
        {
          id: breakup,
          type: "touch",
          name: "Break-up note",
          config: {
            instruction:
              "Write a brief, gracious break-up note: no hard feelings, leave the door open, one line on how to reach us later.",
            repeat: { maxAttempts: 1, intervalDays: 3 },
          },
        },
        { id: replied, type: "goal", name: "They replied", config: { outcome: "replied" } },
        { id: closed, type: "goal", name: "Closed — no response", config: { outcome: "no response" } },
      ],
      edges: [
        { fromNodeId: intro, toNodeId: replied, label: "responded" },
        { fromNodeId: intro, toNodeId: breakup, label: "exhausted" },
        { fromNodeId: breakup, toNodeId: replied, label: "responded" },
        { fromNodeId: breakup, toNodeId: closed, label: "exhausted" },
      ],
      layout: {
        [intro]: { x: 0, y: 170 },
        [replied]: { x: 460, y: 0 },
        [breakup]: { x: 460, y: 340 },
        [closed]: { x: 920, y: 340 },
      },
    };
  },
};

const replyDrivenBranch: FunnelTemplate = {
  key: "reply-driven-branch",
  name: "Branch on interest",
  description: "Intro, then the AI reads the reply: interested people go straight to the goal, everyone else gets a case study.",
  stepSummary: ["Warm intro", "Relevant case study"],
  build: () => {
    const intro = id();
    const interested = id();
    const caseStudy = id();
    const booked = id();
    const closed = id();
    return {
      entryNodeId: intro,
      nodes: [
        {
          id: intro,
          type: "touch",
          name: "Warm intro",
          config: {
            instruction:
              "Write a short first-touch email referencing something recent and specific about their company from research.",
            repeat: { maxAttempts: 3, intervalDays: 3 },
          },
        },
        {
          id: interested,
          type: "branch",
          name: "Did they sound interested?",
          config: { condition: { kind: "predicate", prompt: "They sound interested in working with us" } },
        },
        {
          id: caseStudy,
          type: "touch",
          name: "Relevant case study",
          config: {
            instruction:
              "Retell the closest case study from our library for their industry, ending with one concrete takeaway for them.",
            repeat: { maxAttempts: 2, intervalDays: 4 },
          },
        },
        { id: booked, type: "goal", name: "Booked a call", config: { outcome: "booked a call" } },
        { id: closed, type: "goal", name: "Closed — no response", config: { outcome: "no response" } },
      ],
      edges: [
        { fromNodeId: intro, toNodeId: interested, label: "responded" },
        { fromNodeId: intro, toNodeId: caseStudy, label: "exhausted" },
        { fromNodeId: interested, toNodeId: booked, label: "yes" },
        { fromNodeId: interested, toNodeId: caseStudy, label: "no" },
        { fromNodeId: caseStudy, toNodeId: booked, label: "responded" },
        { fromNodeId: caseStudy, toNodeId: closed, label: "exhausted" },
      ],
      layout: {
        [intro]: { x: 0, y: 170 },
        [interested]: { x: 460, y: 0 },
        [caseStudy]: { x: 460, y: 340 },
        [booked]: { x: 940, y: 0 },
        [closed]: { x: 940, y: 340 },
      },
    };
  },
};

const nurtureDrip: FunnelTemplate = {
  key: "nurture-drip",
  name: "Slow nurture drip",
  description: "Patient value notes weeks apart — for people worth staying in front of without pressure.",
  stepSummary: ["Value note", "Fresh value note"],
  build: () => {
    const settleIn = id();
    const firstNote = id();
    const quietMonth = id();
    const secondNote = id();
    const replied = id();
    const stayedQuiet = id();
    return {
      entryNodeId: settleIn,
      nodes: [
        { id: settleIn, type: "wait", name: "Give it a week", config: { days: 7 } },
        {
          id: firstNote,
          type: "touch",
          name: "Value note",
          config: {
            instruction:
              "Share one genuinely useful insight for their role or industry — no ask, no pitch, just value.",
            repeat: { maxAttempts: 1, intervalDays: 3 },
          },
        },
        { id: quietMonth, type: "wait", name: "Stay quiet a month", config: { days: 30 } },
        {
          id: secondNote,
          type: "touch",
          name: "Fresh value note",
          config: {
            instruction:
              "Share a different useful insight than last time, referencing anything new the workspace has learned about them.",
            repeat: { maxAttempts: 1, intervalDays: 3 },
          },
        },
        { id: replied, type: "goal", name: "They replied", config: { outcome: "replied" } },
        { id: stayedQuiet, type: "goal", name: "Closed — stayed quiet", config: { outcome: "no response" } },
      ],
      edges: [
        { fromNodeId: settleIn, toNodeId: firstNote, label: "next" },
        { fromNodeId: firstNote, toNodeId: replied, label: "responded" },
        { fromNodeId: firstNote, toNodeId: quietMonth, label: "exhausted" },
        { fromNodeId: quietMonth, toNodeId: secondNote, label: "next" },
        { fromNodeId: secondNote, toNodeId: replied, label: "responded" },
        { fromNodeId: secondNote, toNodeId: stayedQuiet, label: "exhausted" },
      ],
      layout: {
        [settleIn]: { x: 0, y: 170 },
        [firstNote]: { x: 420, y: 170 },
        [replied]: { x: 880, y: 0 },
        [quietMonth]: { x: 880, y: 340 },
        [secondNote]: { x: 1340, y: 340 },
        [stayedQuiet]: { x: 1800, y: 340 },
      },
    };
  },
};

export const FUNNEL_TEMPLATES: FunnelTemplate[] = [
  blankTemplate,
  followUpSequence,
  replyDrivenBranch,
  nurtureDrip,
];
