# Design Language

The single source of truth for how every screen in this monorepo looks and behaves. **Living demo: `apps/styleguide` (`pnpm dev:styleguide`, port 3006)** — every construct below rendered with the real components; when reviewing design, hold pages next to it. It governs `apps/unified`, `apps/outreach`, `apps/content-generator`, `packages/ui`, and the UI in `packages/auth`. When a page disagrees with this document, the page is wrong.

**The system in one sentence:** dark, violet-warm, expressive surfaces built from shadcn/ui components and semantic Tailwind tokens, Geist type — motion and glow carry meaning, density stays calm.

This document merges the original quiet workspace system with the expressive idiom developed in `apps/chatbot-spec` (the reference implementation this register was extracted from). One language, two registers — **expressive** and **dense** — governed by the density rule in §2. Merge decision record: `docs/superpowers/specs/2026-07-29-expressive-design-language-merge-design.md`.

---

## 1. Foundations

### Theme and color

- Dark theme only for now. `<html class="dark">` is set in the root layout; do not write light-mode-conditional styles.
- **Semantic tokens only.** Every color comes from the tokens defined in `packages/ui/globals.css`:
  `background`, `foreground`, `card`, `card-foreground`, `popover`, `muted`, `muted-foreground`, `border`, `input`, `ring`, `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `accent`, `accent-foreground`, `destructive`, `sidebar-*`, `chart-1..5`.
- **Never** hardcode color: no hex values in CSS or TSX, no Tailwind palette classes (`bg-zinc-900`, `text-red-500`, `border-gray-700`…). If a color need isn't expressible in tokens, the token set is extended in `packages/ui/globals.css` — not worked around locally. Opacity-modified tokens (`bg-primary/5`, `border-primary/25`) are tokens, not violations — they are how the expressive register is built.
- Status color mapping (the only meanings colors carry):
  - positive/active → `Badge` variants (see §3) or `chart-2`-based accents.
  - destructive/danger → `destructive` token, only on actions that delete or stop things.
  - everything informational → neutral (`muted-foreground`).

### Tint rules (the expressive register's color)

Primary-tinted surfaces are the warmth of the merged language. They follow three rules:

- **Interactive surfaces tint on hover**: clickable cards and rows may use `hover:border-primary/45 hover:bg-primary/5`; at rest they stay neutral.
- **Selected/featured surfaces may rest tinted**: an active selection, a featured panel, or the chat composer may hold `bg-primary/5` and `border-primary/25` at rest. One resting-tinted surface per view — tint marks *the* focal thing, not decoration.
- **Dense surfaces never tint** (§2 density rule): tables, filter rows, and forms stay neutral at rest and on hover (`hover:bg-accent` only).

Tinted chips (`bg-primary/10 text-primary`) use the `Badge` `tint` variant, never hand-built spans.

### Typography

- Fonts: Geist Sans (`--font-geist-sans`) for UI, Geist Mono (`--font-geist-mono`) for code, IDs, tokens, and numbers that benefit from tabular alignment.
- Scale (Tailwind classes, no font-size CSS):
  | Role | Classes |
  |---|---|
  | Page title | `text-3xl font-bold tracking-tight` (via `PageHeader` only) |
  | Section heading | `text-lg font-semibold` |
  | Card title | `CardTitle` default (`text-sm font-medium` if overriding) |
  | Body / table cells | `text-sm` |
  | Secondary text | `text-sm text-muted-foreground` |
  | Meta/caption | `text-xs text-muted-foreground` |
  | Eyebrow/kicker | `.eyebrow` utility — `text-xs font-medium uppercase tracking-[0.16em]`; `text-primary` on expressive surfaces, `text-muted-foreground` on dense surfaces (e.g. calendar weekday row, table micro-headers) |
- Sentence case everywhere: titles, buttons, table headers, labels ("Create funnel", not "Create Funnel"). Product names (Cascade, Outreach) keep their capitalization.

### Spacing and shape

- **The symmetry invariant**: a contained surface is either **full-bleed against its container on all four sides, or padded on all four sides — never mixed**. The stock `Card` bakes in `py-6` while its content slots carry `px-6`; zeroing one axis but not the other produces a lopsided surface. When content must meet the card edge, kill *both* axes (`py-0` + `p-0`, `overflow-hidden` for corner clipping) or use the component that owns this (`ListCard`).
- Adjacent surfaces on one page share one anatomy: if one card on a page is full-bleed, its siblings are too.
- Page vertical rhythm: `space-y-8` between page-level blocks, `space-y-4` within a block, `gap-2` between icon and label.
- **Geometry**: `--radius` is `0.75rem`; radii and borders come from component defaults — never hand-set `border-radius`. Hero and shell-level surfaces may step up to `rounded-2xl`/`rounded-3xl`; controls and cards use their component default.
- **Shadows**: cards carry a soft `shadow-xs` by default. Elevated expressive surfaces (composers, hero shells) may use `shadow-lg`/`shadow-2xl` with a primary cast (`shadow-primary/5`). Dense surfaces stay at the default.
- **Focus**: every focusable control shows the 3px ring — `focus-visible:ring-[3px] focus-visible:ring-ring/50` (baked into `packages/ui` primitives; custom interactive elements must match).
- Grids: `gap-4` for card grids (`grid gap-4 md:grid-cols-2 lg:grid-cols-3`).

### Motion

Motion carries meaning — arrival, liveness, interactivity — and is never decoration. All motion respects `motion-reduce`.

- **Entrances**: only via the `.animate-enter` utility (`animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none`), and only on expressive surfaces when content arrives (a chat reply, a generated result, a revealed step). Never on dense surfaces, never on route-level page load (skeletons own that), never hand-assembled from `animate-in` parts.
- **Liveness**: `animate-ping` only via the `LiveDot` component (§3) — streaming, active runs, unread signals.
- **Interactivity**: interactive cards may lift (`hover:-translate-y-0.5` with `transition-all`); everything else uses `transition-colors`. No other custom keyframes.
- **Duration**: 200–300ms. Nothing slower.
- Loading spinners only inside buttons (`Loader2` + `animate-spin`); page-level loading uses skeletons (§4).

### Atmospherics

The loud tier — glow, blur, scrims — is opt-in through named components and recipes, never ambient default:

- **Glow**: one glow blob per surface, rendered only through `GlowCanvas` (§3), only behind heroes, the chat shell, and empty states. Never behind tables, forms, or list pages.
- **Blur chrome**: sticky headers on expressive full-height surfaces may use `bg-background/80 backdrop-blur` with a gradient scrim at the scroll edge (§8 recipe).
- Atmospherics use primary-derived color only (`bg-primary/7` blobs, `shadow-primary/5` casts) — never new hues.

### Recipes graduate into components

A markup recipe that two or more pages paste by hand WILL eventually be half-applied and drift. Once a construct recurs, its anatomy moves into a shared component in `packages/ui` that owns it (`PageHeader`, `ListCard`, `ListRow`, `ListSurface`, `StatRow`, `GlowCanvas`, `LiveDot`, `Eyebrow`), and the recipe section then points at the component instead of markup. Pages compose components; they do not re-implement anatomy.

### Iconography

- Icons: `lucide-react` only. `size={16}` inline with text, `className="h-4 w-4"` in buttons, 17–18 in nav. Icons accompany labels; icon-only buttons require `title` or `aria-label`.
- Icon chips on expressive surfaces: `grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground` (filled, for the surface's one focal icon) or `bg-primary/10 text-primary` (tinted, for list markers).

---

## 2. Layout

### The density rule

Every surface is classified before it is styled:

- **Expressive**: heroes, the chat/assistant shell, empty states, feature and launch cards, onboarding moments. May use the full register — resting tints, atmospherics, entrances, hover lift, expanded geometry.
- **Dense**: tables, filter rows, forms, list pages, settings, dashboards of records. Neutral borders, no atmospherics, no entrance motion, `transition-colors` only, component-default geometry.

When in doubt, a surface is dense. A page mixes registers vertically (an expressive empty state above a dense table is fine), but a single surface never mixes them. This rule is what makes the expressive default safe — reviewers reject atmospherics on dense surfaces as defects, not taste.

### App shell

The unified shell (fixed 248px sidebar, main content offset, 16px mobile padding, and 32px desktop padding) is defined once in `apps/unified` and styled with tokens (`bg-sidebar`, `border-sidebar-border`, …), not hex. Product apps running standalone reuse the same content-area rules.

### Page container

The shell's `<main>` already applies responsive outer padding — **pages never add their own `p-8`/outer padding**, and a page's loading/empty/error branches use the same container as its loaded state so padding and width never jump between states. Every operational page uses the full available content area:

```tsx
<div className="w-full min-w-0">
```

Do not apply a page-level `max-w-*` cap to dashboards, lists, settings, forms, editors, or their skeletons. Readability constraints belong to inner content only (for example, a legal article, chat message column, or post preview), never to the page frame. Full-height work surfaces (chat, editors) compute against the shell's actual desktop or mobile chrome. The header spans the same width as the work surface.

### Page anatomy

Top to bottom, no deviations:

1. `PageHeader` (from `packages/ui/components/PageHeader.tsx`) — optional `eyebrow` (wide-tracked kicker, expressive pages only), `title` (plain noun phrase: "Funnels", "Leads"), optional `description` (one sentence), optional `actions` (the page's 0–2 primary buttons).
2. Optional filter/tab row.
3. Content blocks (cards, tables) separated by `space-y-8`.

No hand-rolled `<h1>`s. No greetings, dates, or role banners in page headers.

---

## 3. Components

Always import from the shared package (`@/components/ui/*` in apps wired with the alias). Raw HTML equivalents are defects:

| Need | Use | Never |
|---|---|---|
| Actions | `Button` | raw `<button>` with custom classes |
| Panel | `Card` + `CardHeader`/`CardTitle`/`CardContent` | bespoke bordered `<div>`s |
| Record list | `ListCard` + `ListRows`/`ListRow` | metric-column tables, card grids |
| Searchable/browsable collection | `ListSurface` (owns search, filters, infinite scroll) | page-local search inputs bolted above a list, pagination |
| Tabular data (true column comparison) | `Table` family | raw `<table>` |
| Create/edit/confirm | `Dialog` | browser `confirm()`, inline expanding forms |
| Status labels | `Badge` | colored `<span>`s |
| Mode switching | `Tabs` | button rows with active-state classes |
| Selection | `Select`, `Checkbox`, `Switch` | raw `<select>`/`<input type=checkbox>` |
| Loading | `Skeleton` | text "Loading…", spinners |
| Notifications | `toast` from `sonner` | inline success banners, `alert()` |
| Section kicker | `Eyebrow` | hand-tracked uppercase spans |
| Glow atmospheric | `GlowCanvas` | positioned blurred divs |
| Live indicator | `LiveDot` | hand-built `animate-ping` spans |

### Button hierarchy (per view)

- One `default` (filled) button max per view — the primary action.
- `outline` for secondary actions, `ghost` (usually `size="sm"` or `size="icon"`) for row-level actions in tables, `destructive` for irreversible actions.
- Destructive actions always confirm via `Dialog` stating exactly what will be lost.
- Pending state: disable + `Loader2 className="h-4 w-4 animate-spin"` inside the button; never leave a button silently unresponsive.

### Badge status mapping

Use `variant`: `default` for positive/active states (`active`, `validated`, `sent`, `subscribed`), `secondary` for neutral/in-progress (`draft`, `queued`, `paused`), `outline` for structural/meta (step types, roles, generations), `destructive` for failure/terminal (`failed`, `rejected`, `retired`, `unsubscribed`, `suppressed`), `tint` for featured/highlight chips on expressive surfaces (capability tags, spotlight labels — not statuses). Same state → same variant on every page.

### Interactive cards

A clickable card (feature launcher, suggestion, pick-one option) uses the shared interactive treatment:

```tsx
className="group flex items-center gap-3 rounded-xl border bg-card p-3.5 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/45 hover:bg-primary/5 hover:shadow-md focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
```

Record collections are never interactive-card grids — they are §8 list-recipe tables. Interactive cards are for *choices*, not *records*.

---

## 4. Data and states

Every async view handles all four states, in this shape:

- **Loading**: `Skeleton` blocks mirroring the final layout (e.g. 3 card skeletons, or 5 row skeletons in a table). Never a lone spinner, never layout shift, never `.animate-enter` on skeletons.
- **Empty**: centered within the content area — muted lucide icon (`h-8 w-8 text-muted-foreground`), one sentence of what belongs here, and the primary creation action if the user can act. Empty states are expressive surfaces: they may sit inside a `GlowCanvas` and use an `Eyebrow`. No walls of explanatory text.
- **Error**: `toast.error` with a human sentence (what failed + what to do), and the view stays usable (stale data + retry affordance where possible). Never silently swallow a failed fetch.
- **Success mutations**: `toast.success`, short ("Funnel created"). Refresh the affected data in place.

Numbers: right-align numeric table columns (`text-right tabular-nums`). Dates: relative (`formatDistanceToNow`) for activity, absolute for schedules; always title/tooltip the exact timestamp on relative dates.

### Charts

Charts are built with the **shadcn `chart` primitives on Recharts** (`packages/ui/components/ui/chart.tsx` — `ChartContainer` + `ChartTooltipContent` + `ChartLegendContent`), colored only by chart tokens. Living demo: the styleguide's Stats page. The rules:

- **A single headline number is a stat tile (§8), not a chart.** Delta chips carry direction with an icon + `chart-2`/`destructive` ink — never color alone.
- **Series colors are assigned, not picked**: a single series wears `chart-2`; a two-series comparison adds `chart-6` (`oklch(0.67 0.1 293.5)`, the muted-lavender step validated against `chart-2` for color-blind separation and card contrast). Never more than two hues on one chart — a third series means small multiples or folding into "Other".
- **`chart-1..5` is a sequential ramp** (one violet hue, light→dark) for magnitude/heat encodings — never used as a categorical set; adjacent steps are indistinguishable. `chart-4`/`chart-5` fall below 3:1 on `card` — fills with visible labels only, never thin lines.
- **One axis.** Never two y-scales; two measures of different scale get two charts or an indexed base.
- **Recessive chrome**: grid `var(--border)`, horizontal only; no axis lines or tick lines; tick text `muted-foreground` 11px. Text (values, labels, legends) wears text tokens, never the series color.
- **Marks**: 2px lines, 4px rounded bar data-ends, thin bars; bars in one hue when the axis already names the category.
- **Every chart hovers** (crosshair or per-mark tooltip via `ChartTooltip`), a legend appears whenever there are ≥2 series, and every charted dataset stays reachable as a table.

---

## 5. Forms

- `Label` + control, stacked with `gap-2`; groups of fields `grid gap-4` (2-col `md:grid-cols-2` when fields are short and related).
- Field hints: `text-xs text-muted-foreground` under the control.
- Validation errors: inline `text-xs text-destructive` under the field, plus `toast.error` only when submission fails for non-field reasons.
- Submit lives in `DialogFooter` (dialogs) or right-aligned below the form; label states the outcome ("Create funnel", "Save step" — never "Submit", "OK").
- Forms are dense surfaces. The one exception: a prominent composer (chat input, primary creation surface) may use the `InputGroup` elevated treatment — `rounded-2xl border-primary/30 bg-card shadow-lg shadow-primary/5`.

### Full-page form (create/edit pages — rich text, several sections)

When a form outgrows a dialog it becomes a page (living demo: the styleguide's Forms page):

- **Top**: the §8 detail-page top — back link, then `PageHeader` with a noun-phrase title ("New blog post"). The primary action is the header's one filled button ("Save draft"), with "Discard" as `ghost` beside it — never a floating save bar.
- **Layout**: work column + 320px meta rail (`grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]`). The work column holds the thing being authored — title, dek, body; the rail holds everything *about* it as small content-section cards ("Publish": status/destination/schedule; "Organize": topic/tags), `CardTitle` at `text-sm`.
- **Rich text**: formatted content is always `RichTextEditor` (`packages/ui/components/ui/rich-text-editor.tsx` — TipTap, minimal toolbar, placeholder, `minHeight`) — never a bare textarea or contentEditable. For agent-generated drafts use `format="markdown"`: markdown flows in, edits flow out as markdown (`markdownToHtml`/`htmlToMarkdown` are exported for the same boundary elsewhere; client-side only).
- **Validation on submit**: inline `text-xs text-destructive` under the offending field (input gets `aria-invalid`), plus one `toast.error` naming what blocked the save; the inline error clears as the user fixes the field. Success is `toast.success` ("Draft saved").
- Field anatomy, hints, and voice follow the rules above unchanged.

---

## 6. Voice

- Describe the product truthfully: this is a workspace for **content operations, outreach, and self-optimizing email funnels**. Marketing/security theater ("secure workspace", "enterprise-grade") is banned from product surfaces.
- Buttons: verb + object. Empty states: what this area does + how to start. Errors: what happened + what to do next.
- No lorem, no "coming soon", no exclamation marks.

---

## 7. Migration ledger

**Implementation status:** the merge's `packages/ui` implementation (radius token, restyled primitives, `.animate-enter`/`.glow-blob`/`.eyebrow` utilities, `GlowCanvas`/`LiveDot`/`Eyebrow`, Badge `tint`, PageHeader `eyebrow`) is specified in `docs/superpowers/specs/2026-07-29-expressive-design-language-merge-design.md`. Until it lands, pages render the pre-merge look and this section is the tracking list.

Quiet→expressive adoption (page-by-page, after the primitives land):

- Geometry, shadows, and focus rings arrive everywhere automatically with the `packages/ui` restyle — no page work.
- Eyebrows, atmospherics, resting tints, and interactive hovers are adopted deliberately per page; record adoptions here as they happen.
- `apps/chatbot-spec` is the reference implementation — already conformant, needs no changes.

Pre-merge debt still outstanding:

- `apps/unified/app/globals.css` — bespoke `.dashboard-*`, `.denied-*`, `.role-*` classes → rebuild those views on tokens/components; shell classes (`.unified-*`) re-expressed with `sidebar-*` tokens.
- `packages/auth/styles.css` + `components.tsx` (sign-in) and `admin-styles.css` + `admin-console.tsx` — hex-coded; re-express on tokens (keep the split-panel sign-in layout, fix the copy per §6).
- Any page importing nothing from `packages/ui` is out of compliance by definition.

## 8. Structural recipes — identical markup for identical constructs

Equivalent surfaces use the **same structure, not similar structures**. A collection of records is a table on every page — never a card grid on one page and a table on another. These recipes are copied verbatim (only the columns/labels change):

### List surface (any collection of records — leads, projects, topics, funnels, templates, personas…)

Minimal rows, not metric-column tables. Everything measurable — counts, type, timestamps, owners — lives in one dot-separated meta line **under the title**, never spread across table columns.

```tsx
<ListCard title="…" description="…">   {/* packages/ui/components/ListCard.tsx — ALWAYS this wrapper, never raw Card+CardContent p-0 */}
  <ListRows>                            {/* packages/ui/components/ListRow.tsx — owns the row anatomy */}
    <ListRow
      title={row.name}                  {/* identity line: title (links via href) + optional status badge */}
      href={…}
      badge={<Badge variant={…}>{…}</Badge>}
      meta={["sequence", "24 active", "108 completed", "updated 2h ago"]}   {/* the metrics, formatted — not columns */}
      actions={[
        { label: "Edit", icon: Pencil },
        { label: "Duplicate", icon: Copy },
        { label: "Delete", icon: Trash2, destructive: true },
      ]}
    />
  </ListRows>
</ListCard>
```

Action rules (owned by `ListRow`, not re-decided per page):

- Actions are **tinted icon-only buttons** (`size="icon-sm"`): standard actions `bg-primary/10 text-primary`, destructive `bg-destructive/10 text-destructive`. The label lives in the tooltip and `aria-label` — never rendered inline.
- **1–2 actions**: inline. **3 or more**: the first stays inline; the rest fold into a `⋯` `DropdownMenu` (destructive actions last, `variant="destructive"`; the ⋯ trigger stays neutral `bg-secondary/60`).
- Destructive actions still confirm via Dialog per §3.

Loading state: the same `ListCard` wrapper containing 5 `Skeleton` rows (`h-10`, stacked with `divide-y` spacing). Empty state: the same Card wrapper containing the §4 centered empty state. The wrapper never changes between states. `Table` remains for genuinely tabular data — many records compared across the same numeric columns — but a record list defaults to `ListRow`.

### Browsable list surface (search + filters + infinite scroll)

When a collection is searched or browsed, the surface is `ListSurface` (`packages/ui/components/ListSurface.tsx`) — one component owning the whole loop, never a page-local search input bolted above a list:

- **Search lives in the header band**, right of the title; `/` focuses it (the shortcut hint renders in the input). Empty search results use the §4 empty state with the query named and a "Clear search" action.
- **Filters are one row** under the header, with the result count right-aligned in meta type. Chip toggles (`ghost`/`secondary` buttons) suit ONE low-cardinality dimension; every further dimension — status, source, priority, sort — is a `FilterSelect` (the label-prefixed compact select exported alongside `ListSurface`). Never a second row of chips.
- **Record collections never paginate.** More rows load at an invisible sentinel (infinite scroll); loading-more renders skeleton rows below the real ones; the end of the list is a quiet "All caught up · N items" terminal line.
- The wrapper never changes between states: initial loading = 5 skeleton rows, empty/no-match = §4 empty state, rows are `ListRows`/`ListRow` unchanged.

### Stat row (page-level metrics)

Owned by `StatRow` (`packages/ui/components/StatRow.tsx`) — never hand-built tiles:

```tsx
<StatRow
  stats={[
    { label: "Published this month", value: "12", delta: "+4", up: true, featured: true, trend: [4, 6, 5, 8, 7, 9, 12] },
    …
  ]}
/>
```

- Label in meta type, value `text-3xl font-bold tabular-nums`.
- **Delta chip**: icon + ink, three states — `up` (`TrendingUp` + `chart-2`), `down` (`TrendingDown` + `destructive`), `flat` (`Minus` + `muted-foreground`). Direction never rides color alone, and **an unchanged stat is deliberately quiet**: muted chip, muted low-opacity sparkline — never dressed up as a trend.
- **Sparkline** (optional `trend`): 6–10 points, gradient fill, emphasized endpoint; tone follows the delta sentiment.
- **At most one `featured` tile per row** — it takes the resting primary tint (the §1 tint rule's one-focal-surface budget).
- Tiles cascade in with a 75 ms stagger; `motion-reduce` disables it.

### Content section (detail pages)

```tsx
<Card>
  <CardHeader>
    <CardTitle>Section name</CardTitle>
    <CardDescription>One sentence.</CardDescription>
  </CardHeader>
  <CardContent>…</CardContent>   {/* or p-0 + Table when the section is a record list */}
</Card>
```

### Detail page top

```tsx
<Link className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground" href={listHref}>
  <ArrowLeft className="size-4" /> All {things}
</Link>
<PageHeader title={record.name} … />
```

Rich record identity inside a table's first cell (avatar/two-line) is allowed, but the cell, row, and table markup stay the recipe's. If a surface genuinely isn't a record collection (a dashboard of product entries, a chat thread), it is exempt from the table recipe but must still be identical to its own equivalents on other pages.

### Calendar surface (any month-grid of dated items)

- Wrapper: `Card className="overflow-hidden py-0" > CardContent p-0` — the grid is FULL-BLEED, meeting all four card edges symmetrically. Horizontal scroll container, computed week count (never render dead all-outside-month rows).
- Toolbar (NOT the PageHeader actions slot): a row between the header and the grid — month label left (`text-lg font-semibold`), controls right (`outline` prev/next icon buttons + an explicit `outline` "Today" button).
- Weekday header row: eyebrow style, dense register (`text-xs font-medium uppercase tracking-wider text-muted-foreground`).
- Day cell: `min-h-28 border-r border-b px-3 py-2`, outside-month cells `bg-muted/30 text-muted-foreground`. **Today** = date number ringed (`ring-1 ring-primary`), never a filled accent circle.
- Event chip (a new construct — never a stretched Badge): a neutral block —
  ```tsx
  <Link className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs transition-colors hover:bg-accent" …>
    <span className="size-1.5 shrink-0 rounded-full bg-<status-color>" />
    <span className="truncate"><time muted> <title foreground></span>
  </Link>
  ```
  Status dot colors carry the only meaning: positive/complete → `bg-chart-2`, pending/neutral → `bg-muted-foreground`, failed → `bg-destructive`, cancelled → `bg-border`. Chip surfaces stay neutral; overflow renders as a `+N more` meta line.
- Loading: skeleton day-cells in the same wrapper, default component radius (no radius overrides).

### Blur header (expressive full-height surfaces — chat shell, control decks)

```tsx
<header className="sticky top-0 z-10 flex min-h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur sm:px-5">
  …
</header>
{/* at the scroll edge above a pinned composer: */}
<div className="sticky bottom-0 bg-gradient-to-t from-background via-background to-transparent pb-4 pt-6">…</div>
```

Graduates to a `packages/ui` component when a second surface adopts it.

## 9. Generative surfaces

Every AI action streams. The anatomy is owned by `packages/ui/components/genui`:

- **Reasoning is ambient, not modal.** `ReasoningTicker` sits above the result surface—mono, dim, auto-scrolling. It fills the time-to-first-answer gap; never use a spinner where reasoning is available.
- **Results assemble in place.** The same component renders partial and final state (`StreamSection` with `StreamList`, `EntityChipStream`, `ScoreRing`, or `StreamingText`). The result surface itself fills in. Arriving sections use `.animate-enter`.
- **State is visible at the container.** `StreamSection` breathes while streaming, settles when done, and flags errors. Active streams are marked with `LiveDot`.
- **Every generative view must survive being filmed.** A three-second recording of any AI action must show visible motion of real work. This is a launch requirement.

## 10. Compliance checklist (for reviews and agents)

1. No hex colors or palette classes — tokens only (opacity-modified tokens are fine).
2. `PageHeader` present; no hand-rolled page titles. Eyebrows only via `Eyebrow`/`PageHeader eyebrow`.
3. All primitives from `packages/ui`; no raw tables/buttons/selects for standard UI.
4. Loading = skeletons; empty state present; errors toast; mutations toast.
5. One filled button per view; destructive actions confirm in a dialog.
6. Badge variants follow §3 mapping; same status never styled two ways; `tint` reserved for expressive highlight chips.
7. Sentence case; voice per §6.
8. Operational page frame is `w-full min-w-0`; only inner reading/form content may use a deliberate `max-w-*`.
9. Record collections are §8 `ListRow` lists — never card grids, never metric-column tables; metrics live in the meta line under the title, and the action rules (tinted icon buttons with tooltips, ≤2 inline, 3+ fold into ⋯) come from the component. Stat rows, sections, detail tops, and blur headers use the §8 recipes verbatim.
10. Density rule respected: no atmospherics, entrances, resting tints, or hover lift on dense surfaces; at most one `GlowCanvas` blob and one resting-tinted surface per view.
11. All motion is `.animate-enter`, `LiveDot`, hover lift, or `transition-colors` — nothing hand-assembled, everything `motion-reduce`-safe.
