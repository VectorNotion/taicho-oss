"use client";

import { Bar, BarChart, CartesianGrid, Cell, ErrorBar, LabelList, XAxis, YAxis } from "recharts";
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
import { axisTick, ChartCard } from "./view-primitives";

/*
 * Content views — grounded in the real shapes:
 * - ContentIdea.status (idea|refined) + ContentDraft.status (draft|ready|published) via getContentCounts()
 * - Topic coverage vs published output (extends queryContentGaps)
 * - performanceLevel low|medium|high (sparse manual annotation → coverage denominator)
 * - posts table: status ∈ scheduled|publishing|published|failed|cancelled per destination
 * - resonance RunResult: score 0-100, ci95, winner{margin, tooCloseToCall}
 */

const KPIS: Stat[] = [
  { label: "Published this month", value: "12", delta: "+4", direction: "up", featured: true, trend: [4, 6, 5, 8, 7, 9, 12] },
  { label: "Annotation coverage", value: "83%", delta: "10 of 12", direction: "up", trend: [40, 55, 50, 62, 70, 78, 83] },
  { label: "Ready to publish", value: "3", delta: "all week", direction: "flat", trend: [3, 3, 2, 3, 4, 3, 3] },
  { label: "Failed posts", value: "2", delta: "needs retry", direction: "down", trend: [0, 1, 0, 0, 2, 1, 2] },
];

/* Current stock per stage — NOT a cohort funnel: no status-transition log exists. */
const STAGE_STOCK = [
  { stage: "Ideas", count: 34 },
  { stage: "Refined", count: 21 },
  { stage: "Drafts", count: 14 },
  { stage: "Ready", count: 3 },
  { stage: "Published", count: 12 },
];

/* Research items per topic, split by whether a draft CITES / is SOURCED_FROM them — a true part-to-whole. */
const TOPIC_COVERAGE = [
  { topic: "Agent memory", used: 2, unused: 7, research: 9, ideas: 2, published: 0, gap: true },
  { topic: "Synthetic audiences", used: 6, unused: 2, research: 8, ideas: 4, published: 3, gap: false },
  { topic: "Graph RAG", used: 3, unused: 3, research: 6, ideas: 2, published: 1, gap: false },
  { topic: "Email deliverability", used: 0, unused: 5, research: 5, ideas: 0, published: 0, gap: true },
  { topic: "Local-first AI", used: 3, unused: 1, research: 4, ideas: 3, published: 2, gap: false },
  { topic: "Prompt caching", used: 1, unused: 1, research: 2, ideas: 1, published: 1, gap: false },
];

const ANNOTATION_MIX = [
  { type: "LinkedIn posts", low: 2, medium: 5, high: 6 },
  { type: "Tweet threads", low: 4, medium: 6, high: 3 },
  { type: "Video scripts", low: 1, medium: 4, high: 4 },
  { type: "Blog posts", low: 2, medium: 3, high: 1 },
];

const PUBLISHING = [
  { destination: "x", published: 12, scheduled: 2, failed: 1 },
  { destination: "linkedin", published: 9, scheduled: 1, failed: 1 },
  { destination: "youtube", published: 4, scheduled: 1, failed: 0 },
  { destination: "cms", published: 3, scheduled: 0, failed: 0 },
  { destination: "instagram", published: 2, scheduled: 1, failed: 0 },
];

const RESONANCE_RUN = [
  { hook: "Ship fast", score: 62, ci: 5, winner: true },
  { hook: "Numbers first", score: 58, ci: 6, winner: false },
  { hook: "Open question", score: 47, ci: 7, winner: false },
  { hook: "Cost angle", score: 43, ci: 6, winner: false },
];

const stockConfig = { count: { label: "Items", color: "var(--chart-2)" } } satisfies ChartConfig;

const coverageConfig = {
  used: { label: "Used in content", color: "var(--chart-2)" },
  unused: { label: "Not yet used", color: "var(--chart-6)" },
} satisfies ChartConfig;

const mixConfig = {
  low: { label: "Low", color: "var(--chart-1)" },
  medium: { label: "Medium", color: "var(--chart-2)" },
  high: { label: "High", color: "var(--chart-3)" },
} satisfies ChartConfig;

const publishingConfig = {
  published: { label: "Published", color: "var(--chart-2)" },
  scheduled: { label: "Scheduled", color: "var(--chart-6)" },
  failed: { label: "Failed", color: "var(--destructive)" },
} satisfies ChartConfig;

const resonanceConfig = { score: { label: "Resonance score", color: "var(--chart-2)" } } satisfies ChartConfig;

export function ContentViews() {
  return (
    <div className="space-y-12">
      <StatRow stats={KPIS} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Stage stock"
          description="Where work sits right now — current counts per stage from getContentCounts(). Deliberately not a conversion funnel: no status-transition history exists to support cohort flow."
        >
          <ChartCard title="Pipeline stock" description="ContentIdea.status + ContentDraft.status, current">
            <ChartContainer className="h-56 w-full" config={stockConfig}>
              <BarChart data={STAGE_STOCK} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis axisLine={false} tick={axisTick} tickLine={false} type="number" />
                <YAxis axisLine={false} dataKey="stage" tick={axisTick} tickLine={false} type="category" width={72} />
                <ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={{ fill: "var(--muted)", opacity: 0.35 }} />
                <Bar barSize={18} dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="count" fill="var(--foreground)" fontSize={11} position="right" />
                </Bar>
              </BarChart>
            </ChartContainer>
          </ChartCard>
        </Section>

        <Section
          title="Topic opportunity"
          description="Each topic's research items, split by whether any draft actually uses them (CITES / SOURCED_FROM) — a fully muted bar is a gap: research invested, nothing shipped. Shipped count rides the bar; exact numbers in the table."
        >
          <ChartCard title="Research utilisation by topic" description="Evidence-backed research claims split by draft usage; published drafts as the end label">
            <ChartContainer className="h-56 w-full" config={coverageConfig}>
              <BarChart data={TOPIC_COVERAGE} layout="vertical" margin={{ left: 8, right: 72 }}>
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis axisLine={false} tick={axisTick} tickLine={false} type="number" />
                <YAxis axisLine={false} dataKey="topic" tick={axisTick} tickLine={false} type="category" width={118} />
                <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "var(--muted)", opacity: 0.35 }} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar barSize={18} dataKey="used" fill="var(--color-used)" stackId="cov" stroke="var(--card)" strokeWidth={2} />
                <Bar barSize={18} dataKey="unused" fill="var(--color-unused)" radius={[0, 4, 4, 0]} stackId="cov" stroke="var(--card)" strokeWidth={2}>
                  <LabelList
                    dataKey="published"
                    fill="var(--muted-foreground)"
                    fontSize={10}
                    formatter={(value: number) => `${value} shipped`}
                    position="right"
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          </ChartCard>
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Annotation mix"
          description="The human performance scale is ordinal — low/medium/high wears the sequential ramp light→dark (chart-1..3). Every view of this data needs the coverage denominator: annotations are manual and sparse."
        >
          <ChartCard title="performanceLevel by content type" description="Published drafts, annotated subset (10 of 12)">
            <ChartContainer className="h-56 w-full" config={mixConfig}>
              <BarChart data={ANNOTATION_MIX} layout="vertical" margin={{ left: 8, right: 12 }}>
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis axisLine={false} tick={axisTick} tickLine={false} type="number" />
                <YAxis axisLine={false} dataKey="type" tick={axisTick} tickLine={false} type="category" width={100} />
                <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "var(--muted)", opacity: 0.35 }} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar barSize={18} dataKey="low" fill="var(--color-low)" stackId="mix" stroke="var(--card)" strokeWidth={2} />
                <Bar barSize={18} dataKey="medium" fill="var(--color-medium)" stackId="mix" stroke="var(--card)" strokeWidth={2} />
                <Bar barSize={18} dataKey="high" fill="var(--color-high)" radius={[0, 4, 4, 0]} stackId="mix" stroke="var(--card)" strokeWidth={2} />
              </BarChart>
            </ChartContainer>
          </ChartCard>
        </Section>

        <Section
          title="Publishing reliability"
          description="Post delivery per destination from the posts table — published vs scheduled vs failed (attempts max out at 5 with exponential backoff)."
        >
          <ChartCard title="Posts by destination" description="posts.status per destination, last 30 days">
            <ChartContainer className="h-56 w-full" config={publishingConfig}>
              <BarChart data={PUBLISHING} layout="vertical" margin={{ left: 8, right: 12 }}>
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis axisLine={false} tick={axisTick} tickLine={false} type="number" />
                <YAxis axisLine={false} dataKey="destination" tick={axisTick} tickLine={false} type="category" width={72} />
                <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "var(--muted)", opacity: 0.35 }} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar barSize={18} dataKey="published" fill="var(--color-published)" stackId="pub" stroke="var(--card)" strokeWidth={2} />
                <Bar barSize={18} dataKey="scheduled" fill="var(--color-scheduled)" stackId="pub" stroke="var(--card)" strokeWidth={2} />
                <Bar barSize={18} dataKey="failed" fill="var(--color-failed)" radius={[0, 4, 4, 0]} stackId="pub" stroke="var(--card)" strokeWidth={2} />
              </BarChart>
            </ChartContainer>
          </ChartCard>
        </Section>
      </div>

      <Section
        title="Resonance run readout"
        description="The paired-design result on the shared 0–100 scale: CI95 whiskers, winner emphasized chart-2 vs chart-6. Winner is decided on unrounded floats; overlapping CIs report tooCloseToCall."
      >
        <ChartCard
          title="Run #48 · launch post hooks"
          description="4 creatives × 4 frames × 100k simulated audience"
          aside={<Badge variant="tint">Winner: Ship fast · margin 4</Badge>}
        >
          <ChartContainer className="h-52 w-full" config={resonanceConfig}>
            <BarChart data={RESONANCE_RUN} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid horizontal={false} stroke="var(--border)" />
              <XAxis axisLine={false} domain={[0, 100]} tick={axisTick} tickLine={false} type="number" />
              <YAxis axisLine={false} dataKey="hook" tick={axisTick} tickLine={false} type="category" width={100} />
              <ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={{ fill: "var(--muted)", opacity: 0.35 }} />
              <Bar barSize={18} dataKey="score" radius={[0, 4, 4, 0]}>
                {RESONANCE_RUN.map((row) => (
                  <Cell fill={row.winner ? "var(--chart-2)" : "var(--chart-6)"} key={row.hook} />
                ))}
                <LabelList dataKey="score" fill="var(--foreground)" fontSize={11} position="right" />
                <ErrorBar dataKey="ci" direction="x" stroke="var(--muted-foreground)" strokeWidth={1.5} width={4} />
              </Bar>
            </BarChart>
          </ChartContainer>
        </ChartCard>
      </Section>

      <Section title="Topic table" description="The opportunity view's exact numbers — gaps called out.">
        <ListCard title="Topic coverage" description="Active topics: research depth vs content output.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Topic</TableHead>
                <TableHead className="text-right">Research items</TableHead>
                <TableHead className="text-right">Used in drafts</TableHead>
                <TableHead className="text-right">Ideas</TableHead>
                <TableHead className="text-right">Published</TableHead>
                <TableHead className="text-right">Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {TOPIC_COVERAGE.map((row) => (
                <TableRow key={row.topic}>
                  <TableCell className="font-medium">{row.topic}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.research}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.used}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.ideas}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.published}</TableCell>
                  <TableCell className="text-right">
                    {row.gap ? <Badge variant="tint">gap</Badge> : <Badge variant="outline">covered</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ListCard>
        <Spec>
          Data honesty: stage stock is current state, not cohort flow (no transition log) · annotation views always show the coverage denominator ·
          posts has no actual-publish timestamp — reliability views bucket by publish_at · topic gaps extend queryContentGaps() with idea/draft counts.
        </Spec>
      </Section>
    </div>
  );
}
