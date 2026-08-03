import { MousePointerClick, Pencil, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { DemoFrame, Section, Spec } from "../components/section";

const SURFACES = [
  { name: "background", className: "bg-background", note: "the page" },
  { name: "card", className: "bg-card", note: "panels and list surfaces" },
  { name: "muted", className: "bg-muted", note: "insets, icon chips, off-month cells" },
  { name: "accent", className: "bg-accent", note: "hover states only" },
  { name: "secondary", className: "bg-secondary", note: "secondary buttons" },
  { name: "sidebar", className: "bg-sidebar", note: "the shell" },
];

const MEANINGS = [
  { name: "primary", className: "bg-primary", note: "the one filled action per view — never decoration" },
  { name: "destructive", className: "bg-destructive", note: "deletes and failures only" },
  { name: "chart-2", className: "bg-chart-2", note: "positive/complete accents (dots, checks)" },
  { name: "muted-foreground", className: "bg-muted-foreground", note: "pending/neutral markers" },
];

const CHARTS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];

const TYPE_SCALE = [
  { role: "Page title", className: "text-3xl font-bold tracking-tight", sample: "Funnels", spec: "text-3xl font-bold tracking-tight · via PageHeader only" },
  { role: "Section heading", className: "text-lg font-semibold", sample: "Per-step performance", spec: "text-lg font-semibold" },
  { role: "Card title", className: "text-base font-semibold", sample: "Autonomy", spec: "CardTitle default" },
  { role: "Body", className: "text-sm", sample: "Steps are executed in order; delays gate the next step.", spec: "text-sm" },
  { role: "Secondary", className: "text-sm text-muted-foreground", sample: "Scheduled posts the engine will send, soonest first.", spec: "text-sm text-muted-foreground" },
  { role: "Meta", className: "text-xs text-muted-foreground", sample: "Enrolled about 3 hours ago", spec: "text-xs text-muted-foreground" },
  { role: "Eyebrow", className: "text-xs font-medium uppercase tracking-wider text-muted-foreground", sample: "Content · Outreach · Nurture", spec: "text-xs font-medium uppercase tracking-wider text-muted-foreground" },
  { role: "Mono", className: "font-mono text-sm", sample: "vector-embeddings-search", spec: "font-mono · ids, canonical names, code" },
];

function Swatch({ name, className, note }: { name: string; className: string; note: string }) {
  return (
    <div className="space-y-1.5">
      <div className={`h-14 rounded-lg border ${className}`} />
      <p className="text-sm font-medium">{name}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

export default function FoundationsPage() {
  return (
    <div className="w-full min-w-0 space-y-12">
      <PageHeader
        title="Foundations"
        description="Tokens, type, and the spacing rules everything else stands on. The law lives in docs/design-language.md — this is it, rendered."
      />

      <Section title="Surfaces" description="Semantic tokens only — hex values and Tailwind palette classes are defects everywhere.">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {SURFACES.map((s) => <Swatch key={s.name} {...s} />)}
        </div>
      </Section>

      <Section title="Meaning colors" description="One accent per meaning — never decoration. If a color is loud, it must be saying something.">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {MEANINGS.map((s) => <Swatch key={s.name} {...s} />)}
        </div>
        <div className="flex items-center gap-3">
          {CHARTS.map((c) => <div className={`h-8 w-full rounded-md ${c}`} key={c} />)}
        </div>
        <Spec>chart-1…5 — reserved for data visualization</Spec>
      </Section>

      <Section title="Typography" description="Geist Sans for UI, Geist Mono for identifiers. Sentence case everywhere.">
        <Card>
          <CardContent className="divide-y p-0">
            {TYPE_SCALE.map((t) => (
              <div className="flex flex-col gap-1 px-6 py-4 md:flex-row md:items-baseline md:justify-between md:gap-6" key={t.role}>
                <p className={`${t.className} min-w-0 truncate`}>{t.sample}</p>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-medium">{t.role}</p>
                  <Spec>{t.spec}</Spec>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </Section>

      <Section
        title="The symmetry invariant"
        description="A contained surface is full-bleed on all four sides, or padded on all four sides — never mixed. The stock Card bakes in vertical padding; zeroing only the horizontal produces the defect on the right."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="border-b px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">Correct — full-bleed</div>
              <div className="divide-y">
                <div className="px-4 py-3 text-sm">Row content meets every edge</div>
                <div className="px-4 py-3 text-sm">via ListCard or py-0 + overflow-hidden</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">✓ Content and container agree on all four sides.</p>
          </div>
          <div className="space-y-2">
            <div className="rounded-xl border bg-card py-6">
              <div className="border-b px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">Defect — vertical-only padding</div>
              <div className="divide-y">
                <div className="px-4 py-3 text-sm">Rows slam into the sides…</div>
                <div className="px-4 py-3 text-sm">…while floating top and bottom</div>
              </div>
            </div>
            <p className="text-xs text-destructive">✗ Card py-6 kept, content px zeroed — the calendar bug, immortalized.</p>
          </div>
        </div>
      </Section>

      <Section title="Iconography and motion" description="lucide-react only. Icons accompany labels; icon-only buttons carry aria-labels. Motion is transition-colors — nothing enters, nothing bounces.">
        <DemoFrame>
          <div className="flex flex-wrap items-center gap-8">
            <div className="flex items-center gap-2 text-sm"><Search size={16} /> size 16 — inline with text</div>
            <div className="flex items-center gap-2 text-sm"><Pencil className="h-4 w-4" /> h-4 w-4 — inside buttons</div>
            <div className="flex items-center gap-2 text-sm"><MousePointerClick size={17} /> size 17 — navigation</div>
            <button className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent" type="button">
              hover me — transition-colors
            </button>
          </div>
        </DemoFrame>
      </Section>
    </div>
  );
}
