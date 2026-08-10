"use client";

import { Bar, BarChart, CartesianGrid, Cell, ErrorBar, LabelList, ReferenceLine, XAxis, YAxis } from "recharts";
import { ListCard } from "@/components/ListCard";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Section, Spec } from "../../components/section";
import { StatRow, type Stat } from "@/components/StatRow";
import { axisTick, ChartCard, percent } from "./view-primitives";

/*
 * Pipeline & Nurture views — grounded in the real shapes:
 * - ProspectStatus (7 ordered values) from getProspectCounts().byStatus
 * - Cascade funnelMetrics(): per-step sends/opens/clicks/interests; the bandit's
 *   objective is interest-per-send (thompsonPick samples Beta(1+interests, 1+sends−interests))
 * - Variant lifecycle: draft|validated|active|retired, minSends=50, retire below best×0.5
 * - Enrollment state: active | at frontier | completed | stopped (open-ended queues park at the frontier)
 * - ProspectQualification.score 0-100 with 80/50 priority cuts, one score per prospect (argmax persona)
 */

const KPIS: Stat[] = [
  { label: "Prospects in pipeline", value: "94", delta: "+11", direction: "up", trend: [61, 68, 72, 79, 83, 88, 94] },
  { label: "Replied", value: "7", delta: "this week", direction: "up", trend: [2, 4, 3, 5, 4, 6, 7] },
  { label: "Qualified", value: "9", delta: "+2", direction: "up", featured: true, trend: [3, 4, 4, 6, 7, 7, 9] },
  { label: "Active enrollments", value: "605", delta: "3 funnels", direction: "up", trend: [480, 495, 520, 548, 566, 590, 605] },
];

/* getProspectCounts().byStatus in canonical ProspectStatus order. */
const PROSPECT_STAGES = [
  { stage: "New", count: 41 },
  { stage: "Researched", count: 18 },
  { stage: "Contacted", count: 15 },
  { stage: "Replied", count: 7 },
  { stage: "Unresponsive", count: 4 },
  { stage: "Qualified", count: 6 },
  { stage: "Converted", count: 3 },
];

/* funnelMetrics() for one funnel — the chart carries the DECISION metric (interest rate); the table carries the rest. */
const STEP_ENGAGEMENT = [
  { step: "Step 1 · Welcome", rate: 8.2, sends: 412, opens: 214, clicks: 61 },
  { step: "Step 2 · Case study", rate: 6.1, sends: 380, opens: 178, clicks: 44 },
  { step: "Step 3 · Objections", rate: 4.4, sends: 344, opens: 142, clicks: 30 },
  { step: "Step 4 · Offer", rate: 5.3, sends: 301, opens: 133, clicks: 38 },
];

/* Variant arms with Beta(1+interests, 1+sends−interests) 90% credible intervals. */
const VARIANTS = [
  { variant: "gen3-B", rate: 9.1, ci: [2.3, 2.8], sends: 214, interests: 19, status: "active", createdBy: "agent" },
  { variant: "gen4-E", rate: 8.0, ci: [4.9, 7.4], sends: 41, interests: 3, status: "validated", createdBy: "agent" },
  { variant: "gen3-A", rate: 7.4, ci: [2.3, 3.0], sends: 198, interests: 15, status: "active", createdBy: "human" },
  { variant: "gen2-D", rate: 4.2, ci: [1.3, 1.7], sends: 310, interests: 13, status: "retired", createdBy: "agent" },
];
const RETIREMENT_LINE = 4.55; // best rate × 0.5

const ENROLLMENT_MIX = [
  { funnel: "Onboarding", active: 24, frontier: 2, completed: 108, stopped: 9 },
  { funnel: "Newsletter", active: 61, frontier: 451, completed: 0, stopped: 12 },
  { funnel: "Discovery", active: 8, frontier: 1, completed: 3, stopped: 2 },
];

/* ProspectQualification.score histogram per matched persona; 50/80 are the priority cut lines. */
const QUAL_BUCKETS = [
  {
    persona: "Founder CTO",
    buckets: [
      { bucket: "0–20", count: 1 },
      { bucket: "20–40", count: 2 },
      { bucket: "40–60", count: 5 },
      { bucket: "60–80", count: 7 },
      { bucket: "80–100", count: 4 },
    ],
  },
  {
    persona: "Growth operator",
    buckets: [
      { bucket: "0–20", count: 3 },
      { bucket: "20–40", count: 6 },
      { bucket: "40–60", count: 8 },
      { bucket: "60–80", count: 3 },
      { bucket: "80–100", count: 1 },
    ],
  },
];

const stageConfig = { count: { label: "Prospects", color: "var(--chart-2)" } } satisfies ChartConfig;
const rateConfig = { rate: { label: "Interest rate", color: "var(--chart-2)" } } satisfies ChartConfig;
const mixConfig = {
  active: { label: "Active", color: "var(--chart-2)" },
  frontier: { label: "At frontier", color: "var(--chart-6)" },
  completed: { label: "Completed", color: "var(--chart-3)" },
  stopped: { label: "Stopped", color: "var(--muted-foreground)" },
} satisfies ChartConfig;
const qualConfig = { count: { label: "Prospects", color: "var(--chart-2)" } } satisfies ChartConfig;

const VARIANT_FILL: Record<string, string> = {
  active: "var(--chart-2)",
  validated: "var(--chart-6)",
  retired: "var(--muted-foreground)",
};

export function NurtureViews() {
  return (
    <div className="space-y-12">
      <StatRow stats={KPIS} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Pipeline stages"
          description="Prospects by status in the canonical order — current stock per stage. Stage velocity isn't chartable yet: status changes write no activity log."
        >
          <ChartCard title="Prospects by stage" description="getProspectCounts().byStatus, all sources">
            <ChartContainer className="h-64 w-full" config={stageConfig}>
              <BarChart data={PROSPECT_STAGES} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis axisLine={false} tick={axisTick} tickLine={false} type="number" />
                <YAxis axisLine={false} dataKey="stage" tick={axisTick} tickLine={false} type="category" width={92} />
                <ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={{ fill: "var(--muted)", opacity: 0.35 }} />
                <Bar barSize={16} dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="count" fill="var(--foreground)" fontSize={11} position="right" />
                </Bar>
              </BarChart>
            </ChartContainer>
          </ChartCard>
        </Section>

        <Section
          title="Step engagement"
          description="The chart carries the decision metric — interest-per-send, the exact quantity the bandit optimizes. Opens and clicks live in the tooltip and table, not as competing bars."
        >
          <ChartCard title="Onboarding · interest rate per step" description="funnelMetrics(): interests ÷ sends, n on each bar">
            <ChartContainer className="h-64 w-full" config={rateConfig}>
              <BarChart data={STEP_ENGAGEMENT} layout="vertical" margin={{ left: 8, right: 40 }}>
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis axisLine={false} tick={axisTick} tickFormatter={percent} tickLine={false} type="number" />
                <YAxis axisLine={false} dataKey="step" tick={axisTick} tickLine={false} type="category" width={124} />
                <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "var(--muted)", opacity: 0.35 }} />
                <Bar barSize={18} dataKey="rate" fill="var(--color-rate)" radius={[0, 4, 4, 0]}>
                  <LabelList
                    dataKey="sends"
                    fill="var(--muted-foreground)"
                    fontSize={10}
                    formatter={(value: number) => `n=${value}`}
                    position="right"
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          </ChartCard>
        </Section>
      </div>

      <Section
        title="Variant arm race"
        description="Each arm's interest rate with its Beta 90% credible interval — the same posterior thompsonPick samples. The dashed line is the retirement threshold (best × 0.5); arms under 50 sends (minSends) still have wide intervals and survive on uncertainty."
      >
        <ChartCard
          title="Step 2 · Case study — arms"
          description="listVariantsDetailed(): rate, CI, sends, lifecycle status"
          aside={<Badge variant="tint">bandit objective: interest / send</Badge>}
        >
          <ChartContainer className="h-56 w-full" config={rateConfig}>
            <BarChart data={VARIANTS} layout="vertical" margin={{ left: 8, right: 40 }}>
              <CartesianGrid horizontal={false} stroke="var(--border)" />
              <XAxis axisLine={false} tick={axisTick} tickFormatter={percent} tickLine={false} type="number" />
              <YAxis axisLine={false} dataKey="variant" tick={axisTick} tickLine={false} type="category" width={72} />
              <ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={{ fill: "var(--muted)", opacity: 0.35 }} />
              <ReferenceLine stroke="var(--muted-foreground)" strokeDasharray="4 4" x={RETIREMENT_LINE} />
              <Bar barSize={16} dataKey="rate" radius={[0, 4, 4, 0]}>
                {VARIANTS.map((row) => (
                  <Cell fill={VARIANT_FILL[row.status]} key={row.variant} />
                ))}
                <LabelList
                  dataKey="sends"
                  fill="var(--muted-foreground)"
                  fontSize={10}
                  formatter={(value: number) => `n=${value}`}
                  position="right"
                />
                <ErrorBar dataKey="ci" direction="x" stroke="var(--muted-foreground)" strokeWidth={1.5} width={4} />
              </Bar>
            </BarChart>
          </ChartContainer>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-chart-2" /> Active</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-chart-6" /> Candidate</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-muted-foreground" /> Retired</span>
            <span>⋯ dashed line = retirement threshold</span>
          </p>
        </ChartCard>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Enrollment mix"
          description="Journey states per funnel. Open-ended queues legitimately park people at the frontier — a big frontier segment on a queue is normal, on a sequence it's a stall."
        >
          <ChartCard title="Enrollments by state" description="FunnelSummary: active · frontier · completed · stopped">
            <ChartContainer className="h-56 w-full" config={mixConfig}>
              <BarChart data={ENROLLMENT_MIX} layout="vertical" margin={{ left: 8, right: 12 }} stackOffset="expand">
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis axisLine={false} hide type="number" />
                <YAxis axisLine={false} dataKey="funnel" tick={axisTick} tickLine={false} type="category" width={84} />
                <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "var(--muted)", opacity: 0.35 }} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar barSize={18} dataKey="active" fill="var(--color-active)" stackId="mix" stroke="var(--card)" strokeWidth={2} />
                <Bar barSize={18} dataKey="frontier" fill="var(--color-frontier)" stackId="mix" stroke="var(--card)" strokeWidth={2} />
                <Bar barSize={18} dataKey="completed" fill="var(--color-completed)" stackId="mix" stroke="var(--card)" strokeWidth={2} />
                <Bar barSize={18} dataKey="stopped" fill="var(--color-stopped)" radius={[0, 4, 4, 0]} stackId="mix" stroke="var(--card)" strokeWidth={2} />
              </BarChart>
            </ChartContainer>
          </ChartCard>
        </Section>

        <Section
          title="Qualification calibration"
          description="Score distribution per matched persona with the 80/50 priority cut lines drawn in — a persona whose mass sits between the lines isn't discriminating."
        >
          <div className="grid gap-4">
            {QUAL_BUCKETS.map((persona) => (
              <ChartCard description="ProspectQualification.score, matched prospects" key={persona.persona} title={persona.persona}>
                <ChartContainer className="h-24 w-full" config={qualConfig}>
                  <BarChart data={persona.buckets} margin={{ top: 4 }}>
                    <XAxis axisLine={false} dataKey="bucket" tick={{ ...axisTick, fontSize: 10 }} tickLine={false} />
                    <YAxis domain={[0, 8]} hide />
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={{ fill: "var(--muted)", opacity: 0.35 }} />
                    <ReferenceLine stroke="var(--muted-foreground)" strokeDasharray="4 4" x="40–60" />
                    <ReferenceLine stroke="var(--muted-foreground)" strokeDasharray="4 4" x="80–100" />
                    <Bar barSize={26} dataKey="count" fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </ChartCard>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Variant table" description="The arm race's exact numbers.">
        <ListCard title="Step 2 arms" description="Interest rate is the bandit's objective; opens/clicks are context, not the goal.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variant</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Author</TableHead>
                <TableHead className="text-right">Sends</TableHead>
                <TableHead className="text-right">Interests</TableHead>
                <TableHead className="text-right">Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {VARIANTS.map((row) => (
                <TableRow key={row.variant}>
                  <TableCell className="font-medium">{row.variant}</TableCell>
                  <TableCell>
                    <Badge variant={row.status === "active" ? "default" : row.status === "retired" ? "destructive" : "secondary"}>{row.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.createdBy}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.sends}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.interests}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.rate}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ListCard>
        <Spec>
          Data honesty: unsub/bounce events carry no send_id — per-step complaint rates are impossible until ingest attaches one · stage_daily_stats is empty until
          runDailyRollup gets a scheduler (trend views bucket events.occurred_at directly) · outreach messages have no open/reply telemetry — “sent” means recorded
          externally · stage velocity needs auto-written status_change activities.
        </Spec>
      </Section>
    </div>
  );
}
