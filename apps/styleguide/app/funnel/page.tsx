"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FunnelVisualBuilder } from "@/components/funnel/FunnelVisualBuilder";
import type { GraphDocument } from "../../../../products/cascade/domain/graph";

/**
 * The Cascade funnel steps builder on demo data — visual proof for the
 * funnel overhaul (spec 2026-08-23). Forward-only: no arrow points back.
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";
const E = "55555555-5555-4555-8555-555555555555";
const F = "66666666-6666-4666-8666-666666666666";

const demoGraph: GraphDocument = {
  entryNodeId: A,
  nodes: [
    {
      id: A,
      type: "touch",
      name: "Warm intro",
      config: {
        instruction: "Write a short first-touch email referencing something recent about their company from research.",
        repeat: { maxAttempts: 3, intervalDays: 3 },
      },
    },
    {
      id: B,
      type: "branch",
      name: "Did they sound interested?",
      config: { condition: { kind: "predicate", prompt: "They sound interested in working with us" } },
    },
    {
      id: C,
      type: "touch",
      name: "Relevant case study",
      config: {
        instruction: "Retell the closest case study from our library for their industry, ending with one concrete takeaway.",
        repeat: { maxAttempts: 2, intervalDays: 4 },
      },
    },
    {
      id: D,
      type: "touch",
      name: "Personalized ROI report",
      config: {
        instruction: "Generate a mini report estimating what our workflows would save them, grounded in company size and stack.",
        repeat: { maxAttempts: 2, intervalDays: 5 },
      },
    },
    { id: E, type: "goal", name: "Booked call", config: { outcome: "booked a call" } },
    { id: F, type: "route", name: "Long-term nurture", config: { toFunnelId: "77777777-7777-4777-8777-777777777777" } },
  ],
  edges: [
    { fromNodeId: A, toNodeId: B, label: "responded" },
    { fromNodeId: A, toNodeId: C, label: "exhausted" },
    { fromNodeId: B, toNodeId: E, label: "yes" },
    { fromNodeId: B, toNodeId: D, label: "no" },
    { fromNodeId: C, toNodeId: D, label: "responded" },
    { fromNodeId: C, toNodeId: F, label: "exhausted" },
    { fromNodeId: D, toNodeId: E, label: "responded" },
    { fromNodeId: D, toNodeId: F, label: "exhausted" },
  ],
  layout: {
    [A]: { x: 0, y: 160 },
    [B]: { x: 320, y: 40 },
    [C]: { x: 320, y: 320 },
    [D]: { x: 660, y: 180 },
    [E]: { x: 1000, y: 60 },
    [F]: { x: 1000, y: 340 },
  },
};

const demoFunnels = [
  { id: "77777777-7777-4777-8777-777777777777", name: "Long-term nurture" },
  { id: "88888888-8888-4888-8888-888888888888", name: "Booked-call handoff" },
];

const demoCounts = { [A]: 9, [B]: 0, [C]: 6, [D]: 2 };

export default function FunnelBuilderPage() {
  const [graph, setGraph] = useState(demoGraph);
  return (
    <div className="-m-8 h-screen max-md:-m-4">
      <FunnelVisualBuilder
        funnelId="demo-funnel"
        funnelName="Agency warm-up"
        graph={graph}
        funnels={demoFunnels}
        memberCounts={demoCounts}
        onSave={async (doc) => {
          setGraph(doc);
          toast.message("Demo save — the graph round-tripped in memory.");
        }}
      />
    </div>
  );
}
