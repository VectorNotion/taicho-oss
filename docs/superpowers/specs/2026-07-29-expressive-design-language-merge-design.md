# Expressive Design Language Merge

**Date:** 2026-07-29
**Status:** Approved design, pre-implementation
**Decision:** The expressive idiom developed in `apps/chatbot-spec` becomes the default design language for the whole monorepo, merged into the existing quiet system. One language, with a density rule that keeps data surfaces calm.

## 1. Problem

The repo has two design languages:

- **The workspace system** (`docs/design-language.md`, implemented in `packages/ui`): dark, quiet, zinc-neutral, semantic tokens only, no gradients, no entrance animations, `transition-colors` only.
- **The chatbot idiom** (`apps/chatbot-spec` components — `ChatbotSpecSheet`, `ControlDeckPrototype`, `DelegationRunwayPreview`, `TopicMapPreview`): the same token base used expressively — primary-tinted borders and surfaces, glow blobs, backdrop-blur chrome, entrance animations, `animate-ping` live indicators, hover lift, wide-tracked eyebrows, rounder geometry, layered shadows.

They share tokens but disagree on register. Every new surface has to pick a side, and the chatbot idiom — the direction we want — exists only as page-local markup in one app.

## 2. Decision summary

All four expressive signatures graduate into the default language:

1. **Primary-tinted surfaces** — `border-primary/25`, `bg-primary/5` tints on interactive and featured surfaces.
2. **Motion** — `.animate-enter` entrances, `LiveDot` ping indicators, hover lift; `motion-reduce` fallbacks mandatory.
3. **Atmospherics** — glow blobs, backdrop-blur headers, gradient scrims, primary-tinted shadows.
4. **Expanded geometry** — rounder radii, layered shadows, 3px focus rings, wide-tracked uppercase eyebrows.

**Rollout approach — split by blast radius.** Signatures that are safe everywhere (geometry, focus rings, tint-on-hover, motion utilities) restyle the shared primitives *in place*, so every page shifts immediately. The loud signatures (atmospherics, entrance motion, resting tints) ship as *named components and utilities* that surfaces adopt deliberately. A density rule in the rewritten doc governs which surfaces may go full register.

Scope of this work: the doc rewrite, `packages/ui` changes, and `apps/styleguide` updates. **No page migrations** — those happen later, page by page, tracked in the doc's migration ledger.

## 3. Foundations (`packages/ui/globals.css`)

The semantic token set and violet primary are unchanged — the chatbot idiom is built from the same tokens.

- **Geometry:** `--radius: 0.65rem` → `0.75rem`. All component radii derive from this variable, so the rounder chatbot-spec look (`rounded-xl` ≈ 1rem) lands with one change.
- **`.animate-enter` utility:** `animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none`. The only sanctioned entrance recipe; pages never hand-assemble entrances. (`tw-animate-css` is already imported.)
- **`.glow-blob` utility:** the atmospheric — `pointer-events-none rounded-full bg-primary/7 blur-3xl`, sized/positioned by the consumer via `GlowCanvas` (§4).
- **`.eyebrow` utility:** `text-xs font-medium uppercase tracking-[0.16em] text-primary`.

## 4. Shared components (`packages/ui/components/`)

### Restyled in place (flows to every page automatically)

| Component | Change |
| --- | --- |
| `Card` | Inherits new radius; default shadow moves from flat to soft `shadow-xs`; neutral border stays. Interactive (clickable) cards gain `hover:-translate-y-0.5 hover:border-primary/45 hover:bg-primary/5 transition-all`. |
| `Button` | 3px focus ring (`focus-visible:ring-[3px] focus-visible:ring-ring/50`); radius from token. |
| `Input` / `InputGroup` | Same 3px focus ring; prominent composers (InputGroup) get `focus-within` primary-tinted border (`border-primary/30`). |
| `Tabs` | Focus ring alignment; pill-grid look verified against ControlDeck usage. |
| `Badge` | New `tint` variant: `bg-primary/10 text-primary`. |
| `PageHeader` | Optional `eyebrow` prop rendering the wide-tracked kicker above the title. |
| `Table`, filter rows, dense form layouts | **Deliberately untouched** — governed by the density rule (§5). |

### New components (opt-in, the loud tier)

- **`GlowCanvas`** — relative wrapper rendering one `.glow-blob` behind its children; position prop (`top` / `center`) only. Enforces "one blob per surface" by construction. For heroes, the chat shell, empty states.
- **`LiveDot`** — `animate-ping` + solid dot, `motion-reduce:animate-none` baked in. For streaming/active indicators.
- **`Eyebrow`** — thin component over the `.eyebrow` utility.
- **Blur-header chrome** (sticky `bg-background/80 backdrop-blur` + gradient scrim at the scroll edge) starts as a §8 recipe in the doc; graduates to a component when a second surface adopts it, per the existing graduation rule.

## 5. The rewritten `docs/design-language.md`

Same skeleton (§1–§10 — existing cross-references keep working), same authority ("when a page disagrees with this document, the page is wrong"). The system sentence becomes:

> Dark, violet-warm, expressive surfaces built from shadcn/ui components and semantic tokens — motion and glow carry meaning, density stays calm.

Rewritten sections:

- **§1 Motion:** the blanket entrance-animation ban is replaced with rules — entrances only via `.animate-enter`, 200–300ms, `motion-reduce` mandatory, `animate-ping` only via `LiveDot`, spinners still only inside buttons, skeletons still own page-level loading.
- **§1 Tint rules:** interactive surfaces tint on hover; selected/featured surfaces may rest tinted (`bg-primary/5`); dense surfaces never tint.
- **§2 Density rule (new):** every surface is classified **expressive** (heroes, chat, empty states, feature cards) or **dense** (tables, filter rows, forms, list pages). Dense surfaces keep neutral borders, no atmospherics, no entrance motion, `transition-colors` only. This guardrail is what makes the expressive default safe.
- **§7 Known migrations:** becomes the quiet→expressive ledger — which pages have adopted eyebrows/atmospherics/interactive hovers, which still render the pre-merge look.
- **§8 Structural recipes:** adds the blur-header recipe; existing recipes updated where geometry/focus changes touch them.
- **§10 Compliance checklist:** updated to the new rules; `apps/chatbot-spec` cited as the reference implementation the language was extracted from (it needs no changes).

## 6. Styleguide (`apps/styleguide`)

The living demo renders the merged language: a `GlowCanvas` hero with `Eyebrow`, interactive-card hover, `tint` badges, `LiveDot`, `.animate-enter`, and the blur-header recipe. It also demos the **density contrast** — an expressive feature card beside a calm data table on one screen — so reviews see what changes and what deliberately doesn't.

## 7. Verification

- `pnpm test:ui` stays green; tests asserting old classes are updated with the restyle.
- `pnpm run test:architecture` stays green.
- `apps/styleguide` builds; visual pass at `:3006`.
- New components (`GlowCanvas`, `LiveDot`, `Eyebrow`) get unit tests following the package's existing conventions.

## 8. Rollout and non-goals

- Existing pages inherit radius, shadows, and focus rings automatically when `packages/ui` changes — the in-place tier doing its job.
- Adoption of eyebrows, atmospherics, resting tints, and interactive hovers is page-by-page, later, tracked in the §7 ledger.
- **Non-goals:** page migrations, palette changes, light theme, changes to `apps/chatbot-spec`.
