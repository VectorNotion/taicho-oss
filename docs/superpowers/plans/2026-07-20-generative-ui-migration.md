# Generative UI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every AI action on the platform streams its work into the UI as it happens — reasoning, partial structured objects, and final results render live via AI SDK UI typed data parts, replacing every `setInterval` poll, `setTimeout` reload, and "Refresh to see results" toast.

**Architecture:** One server kernel (`actionStreamResponse`) wraps any orchestrator in a `createUIMessageStream` with job-row lifecycle; orchestrators stay untouched — their existing DI seams (`deps.generate`, `deps.generateTopics`, `deps.extractEntities`, `deps.scorePersona`, `deps.generateItems`) receive *streaming* implementations that forward Mastra `fullStream` chunks (reasoning deltas + partial objects) as reconciling `data-*` parts. One client hook (`useActionStream`) consumes the stream via the repo's proven `useChat` + `DefaultChatTransport` pattern (see `products/outreach/ui/components/leads/research-mastra.tsx` — already working in production). A shared genui component kit renders the parts.

**Tech Stack:** Pinned versions only — `ai@6.0.39`, `@ai-sdk/react@3.0.41`, `@mastra/core@1.0.4`, `@mastra/ai-sdk@1.0.2`. Server: `createUIMessageStream`/`createUIMessageStreamResponse` from `ai`; Mastra `agent.stream()` + `fullStream` chunks (`reasoning-delta`, `object`, `object-result`). Model: `openrouter/qwen/qwen3.7-plus` via `routerModel()`.

## Global Constraints

- **NO version bumps.** `ai` stays 6.0.39, `@ai-sdk/react` stays 3.0.41, `@mastra/core` stays 1.0.4, `@mastra/ai-sdk` stays 1.0.2. The ai@7 / Mastra ≥1.5 ladder is an explicit non-goal (separate future task).
- **NO AI SDK RSC / `streamUI`** — experimental per Vercel; the typed-parts tier only.
- **Orchestrator logic is not modified.** Only their DI deps get new streaming implementations, and action modules may gain *exports* (never behavior changes). All existing unit tests must keep passing unchanged.
- **Jobs table stays authoritative.** Every streaming route still writes a job row (`createJob` → `updateJobStatus`) so history, ops queries, and `markStaleJobsFailed` keep working. The old job-dispatch routes remain untouched (headless/cron/API use); UIs switch to the new `/stream` routes.
- **Data-part vocabulary (kernel-owned, used by every surface):** `data-reasoning` (id `reasoning`, transient), `data-partial` (id `partial`, reconciling partial object), `data-progress` (per-step id), `data-final` (id `final`), `data-action-error` (id `error`).
- **Route conventions:** streaming routes live at `<job route>/stream/route.ts`, are re-exported by `apps/unified` with the existing 1-line pattern, export `export const maxDuration = 600;`, and carry no in-route auth (auth is middleware-level, same as all sibling routes).
- **Engine invariant (ADR 0001) unaffected:** cascade/Nurture engine files never touch model APIs; Task 12 only changes the Template Studio route + template-agent *exports*.
- Cross-product app deps already exist (`apps/content-generator` ↔ `@content-automation/outreach` etc.) — do not remove.
- Chat (AI Assistant) is an explicit non-goal: it already streams via assistant-ui.
- Verify each gate with the canonical scripts: `pnpm test:content`, `pnpm test:cascade`, `pnpm --filter @content-automation/outreach test`, `pnpm test:architecture`, `pnpm build`.

## File Map

| File | Responsibility |
|---|---|
| `packages/platform/agents/streaming.ts` (create) | `StreamEmit` type, `actionStreamResponse` kernel, `streamingStructuredGenerate` |
| `packages/platform/agents/streaming.test-helpers.ts` (create) | stub stream factory for tests |
| `products/content-generator/tests/streaming-kernel.test.ts` (create) | kernel unit tests |
| `packages/ui/hooks/use-action-stream.ts` (create) | client consumption hook |
| `packages/ui/components/genui/*` (create) | ReasoningTicker, StreamSection, StreamList, EntityChipStream, ScoreRing, StreamingText |
| `docs/design-language.md` (modify) | §9 Generative surfaces |
| `apps/content-generator/app/api/content/**/stream/route.ts` (create ×6) | per-action streaming routes |
| `apps/outreach/app/api/outreach/leads/[id]/qualify/stream/route.ts` (create) | qualify streaming route |
| `apps/unified/app/api/**` (create, mirrors) | 1-line re-exports |
| `products/content-generator/agent/actions/{topics,project-graph,research}.ts` (modify) | export streaming seam factories |
| `products/outreach/agent/qualify-lead.ts` (modify) | export `streamingScorePersona` |
| `apps/content-generator/app/content/**` pages (modify ×5) | replace polls with `useActionStream` + genui |
| `apps/outreach/app/api/outreach/research/route.ts` (modify) | objectStream upgrade, byte-compatible parts |
| `products/cascade/agent/template-agent.ts` (modify) | export prompt + validator |
| `apps/unified/app/cascade/templates/{page.tsx, generate/stream/route.ts}` | template self-typing stream |

---

### Task 1: Platform streaming kernel

**Files:**
- Create: `packages/platform/agents/streaming.ts`
- Test: `products/content-generator/tests/streaming-kernel.test.ts`

**Interfaces:**
- Consumes: `createJob`, `updateJobStatus` from `@/packages/platform/jobs/repository`; `routerModel()` from `@/packages/platform/agents/model`; `Agent` from `@mastra/core/agent`; `createUIMessageStream`, `createUIMessageStreamResponse` from `ai`.
- Produces (all later tasks rely on these exact signatures):
  - `type StreamEmit = (part: { type: \`data-${string}\`; id?: string; data: unknown; transient?: boolean }) => void`
  - `actionStreamResponse(opts: { action: BackgroundAction; entityId: string; entityType?: EntityType; run: (emit: StreamEmit) => Promise<Record<string, unknown>> }): Promise<Response>`
  - `streamingStructuredGenerate(emit: StreamEmit, opts?: { agentStream?: AgentStreamFactory }): StructuredGenerate` (same `StructuredGenerate` shape as `products/content-generator/agent/actions/refine.ts:28`)
  - `type AgentStreamFactory = (args: { agentId: string; agentName: string; instructions: string; prompt: string; schema: z.ZodType; temperature: number }) => Promise<AsyncIterable<StreamChunk>>` and `type StreamChunk = { type: string; payload?: { text?: string }; object?: unknown }`

- [ ] **Step 1: Write the failing test**

`products/content-generator/tests/streaming-kernel.test.ts`:

```ts
process.env.POSTGRES_HOST = process.env.POSTGRES_HOST ?? 'localhost';

import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  streamingStructuredGenerate,
  type StreamEmit,
} from '@/packages/platform/agents/streaming';

function collectEmits() {
  const parts: Array<{ type: string; id?: string; data: unknown }> = [];
  const emit: StreamEmit = (p) => parts.push(p as never);
  return { parts, emit };
}

test('streamingStructuredGenerate forwards reasoning + partials, returns final object', async () => {
  const { parts, emit } = collectEmits();
  const schema = z.object({ title: z.string() });

  const gen = streamingStructuredGenerate(emit, {
    agentStream: async () =>
      (async function* () {
        yield { type: 'reasoning-delta', payload: { text: 'thinking ' } };
        yield { type: 'reasoning-delta', payload: { text: 'harder' } };
        yield { type: 'object', object: { title: 'par' } };
        yield { type: 'object', object: { title: 'partial then full' } };
        yield { type: 'object-result', object: { title: 'partial then full' } };
      })(),
  });

  const out = await gen({
    agentId: 'a', agentName: 'A', instructions: 'i', prompt: 'p',
    schema, temperature: 0.5,
  });

  assert.deepEqual(out, { title: 'partial then full' });
  const reasoning = parts.filter((p) => p.type === 'data-reasoning');
  assert.equal(reasoning.length, 2);
  assert.deepEqual((reasoning[1].data as { text: string }).text, 'thinking harder');
  const partials = parts.filter((p) => p.type === 'data-partial');
  assert.equal(partials.length, 2);
  assert.deepEqual(partials[1].data, { title: 'partial then full' });
});

test('streamingStructuredGenerate throws when no object-result chunk arrives', async () => {
  const { emit } = collectEmits();
  const gen = streamingStructuredGenerate(emit, {
    agentStream: async () =>
      (async function* () {
        yield { type: 'reasoning-delta', payload: { text: 'hmm' } };
      })(),
  });
  await assert.rejects(
    gen({ agentId: 'a', agentName: 'A', instructions: 'i', prompt: 'p', schema: z.object({}), temperature: 0 }),
    /no structured result/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd products/content-generator && set -a && . ../../.env && set +a && POSTGRES_HOST=localhost npx tsx --test tests/streaming-kernel.test.ts`
Expected: FAIL — `Cannot find module '@/packages/platform/agents/streaming'`

- [ ] **Step 3: Write the kernel**

`packages/platform/agents/streaming.ts`:

```ts
/**
 * Streaming kernel for generative UI.
 *
 * Wraps any orchestrator in a UI-message stream (AI SDK data parts) while
 * keeping the jobs table authoritative. Orchestrator logic is untouched:
 * streaming enters through the existing DI seams (deps.generate etc.).
 *
 * Data-part vocabulary (consumed by packages/ui/hooks/use-action-stream.ts):
 *   data-reasoning  id "reasoning"  transient — model thinking feed
 *   data-partial    id "partial"    reconciling partial structured object
 *   data-progress   id per step     step announcements
 *   data-final      id "final"      orchestrator result
 *   data-action-error id "error"    terminal failure
 */
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import {
  createJob,
  updateJobStatus,
  type EntityType,
} from '../jobs/repository';
import type { BackgroundAction } from './action-types';
import { routerModel } from './model';

export type StreamEmit = (part: {
  type: `data-${string}`;
  id?: string;
  data: unknown;
  transient?: boolean;
}) => void;

export type StreamChunk = { type: string; payload?: { text?: string }; object?: unknown };

export type AgentStreamFactory = (args: {
  agentId: string;
  agentName: string;
  instructions: string;
  prompt: string;
  schema: z.ZodType;
  temperature: number;
}) => Promise<AsyncIterable<StreamChunk>>;

const defaultAgentStream: AgentStreamFactory = async ({
  agentId, agentName, instructions, prompt, schema, temperature,
}) => {
  const agent = new Agent({ id: agentId, name: agentName, instructions, model: routerModel() });
  const stream = await agent.stream(prompt, {
    structuredOutput: { schema },
    modelSettings: { temperature, maxOutputTokens: 32768 },
    providerOptions: { openrouter: { reasoning: { effort: 'medium' } } },
  });
  return stream.fullStream as AsyncIterable<StreamChunk>;
};

/**
 * A StructuredGenerate (refine.ts:28 shape) that forwards reasoning deltas
 * and partial objects to the UI while producing the final validated object.
 */
export function streamingStructuredGenerate(
  emit: StreamEmit,
  opts: { agentStream?: AgentStreamFactory } = {},
) {
  const agentStream = opts.agentStream ?? defaultAgentStream;
  return async <S extends z.ZodType>(args: {
    agentId: string;
    agentName: string;
    instructions: string;
    prompt: string;
    schema: S;
    temperature: number;
  }): Promise<z.infer<S>> => {
    const chunks = await agentStream(args);
    let reasoning = '';
    let final: unknown;
    let haveFinal = false;
    for await (const chunk of chunks) {
      if (chunk.type === 'reasoning-delta') {
        reasoning += chunk.payload?.text ?? '';
        emit({ type: 'data-reasoning', id: 'reasoning', data: { text: reasoning }, transient: true });
      } else if (chunk.type === 'object') {
        emit({ type: 'data-partial', id: 'partial', data: chunk.object });
      } else if (chunk.type === 'object-result') {
        final = chunk.object;
        haveFinal = true;
      } else if (chunk.type === 'error') {
        throw new Error(`agent stream error: ${JSON.stringify(chunk.payload ?? chunk)}`);
      }
    }
    if (!haveFinal) throw new Error('agent stream produced no structured result');
    return final as z.infer<S>;
  };
}

/**
 * Wrap an orchestrator run in a UI message stream Response with full job
 * lifecycle. The route's only job is to build `run` from the action's
 * orchestrator + streaming deps.
 */
export async function actionStreamResponse(opts: {
  action: BackgroundAction;
  entityId: string;
  entityType?: EntityType;
  run: (emit: StreamEmit) => Promise<Record<string, unknown>>;
}): Promise<Response> {
  const jobId = await createJob(opts.action, opts.entityId, opts.entityType);
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const emit: StreamEmit = (part) => writer.write(part as never);
      await updateJobStatus(jobId, 'processing');
      try {
        const result = await opts.run(emit);
        emit({ type: 'data-final', id: 'final', data: result });
        await updateJobStatus(jobId, 'completed', { result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: 'data-action-error', id: 'error', data: { message } });
        await updateJobStatus(jobId, 'failed', { error: message });
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
}
```

Note: `BackgroundAction` — confirm the export exists at `packages/platform/agents/action-types.ts` (`grep -rn "BackgroundAction" packages/platform/agents/`); if it lives in `registry.ts` or `jobs/repository.ts` instead, import from there (the type is already used by `createJob`'s first parameter — import from the same module `createJob` gets it from).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd products/content-generator && npx tsx --test tests/streaming-kernel.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Live chunk-shape probe (one-off, catches payload-field drift)**

Run from `products/content-generator` with `.env` sourced:

```bash
npx tsx -e "
import { streamingStructuredGenerate } from '@/packages/platform/agents/streaming';
import { z } from 'zod';
(async () => {
  const parts: any[] = [];
  const gen = streamingStructuredGenerate((p) => parts.push(p));
  const out = await gen({ agentId: 'probe', agentName: 'Probe', instructions: 'Terse JSON.',
    prompt: 'One blog idea about email.', schema: z.object({ title: z.string() }), temperature: 0.7 });
  console.log('final:', JSON.stringify(out));
  console.log('partial parts:', parts.filter(p => p.type === 'data-partial').length);
  console.log('reasoning parts:', parts.filter(p => p.type === 'data-reasoning').length);
  process.exit(0);
})();"
```

Expected: `final: {"title":...}` and `partial parts: >= 1`. If `reasoning parts: 0`, the bundled provider isn't surfacing Qwen reasoning deltas — acceptable degradation (the ticker renders only when parts exist); note it in the commit message. If `partial parts: 0`, STOP — read the actual chunk types by logging them (`console.log(chunk.type)` in the kernel temporarily) and adjust the two chunk-type strings (`object` / `object-result`) to the observed names before proceeding.

- [ ] **Step 6: Run existing gates, then commit**

Run: `pnpm test:content` — Expected: all pass (51 + 2 new).

```bash
git add packages/platform/agents/streaming.ts products/content-generator/tests/streaming-kernel.test.ts
git commit -m "feat: streaming kernel — actionStreamResponse + streamingStructuredGenerate"
```

---

### Task 2: Client hook `useActionStream`

**Files:**
- Create: `packages/ui/hooks/use-action-stream.ts`
- Modify: `packages/ui/package.json` (add `"ai": "^6.0.39"`, `"@ai-sdk/react": "^3.0.41"` to dependencies)

**Interfaces:**
- Consumes: kernel part vocabulary from Task 1.
- Produces: `useActionStream<TPartial, TFinal>({ api, body }): { start: (extraBody?: Record<string, unknown>) => void; partial: TPartial | null; final: TFinal | null; reasoning: string; progress: Array<{ id: string; label: string; state: string }>; error: string | null; isStreaming: boolean }`

- [ ] **Step 1: Write the hook**

`packages/ui/hooks/use-action-stream.ts` (pattern copied from the proven `research-mastra.tsx` consumption — `useChat` + `DefaultChatTransport` + parts scan):

```tsx
'use client';

import { useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

type DataPart = { type: string; id?: string; data?: unknown };

/**
 * Consume an actionStreamResponse route. `start()` fires the POST; typed
 * state comes from the kernel's data-part vocabulary (streaming.ts).
 */
export function useActionStream<TPartial = unknown, TFinal = unknown>({
  api,
  body,
}: {
  api: string;
  body?: Record<string, unknown>;
}) {
  const { messages, sendMessage, status, error: transportError } = useChat({
    transport: new DefaultChatTransport({
      api,
      prepareSendMessagesRequest({ messages }) {
        return { body: { messages, ...body } };
      },
    }),
  });

  const derived = useMemo(() => {
    let partial: TPartial | null = null;
    let final: TFinal | null = null;
    let reasoning = '';
    let error: string | null = null;
    const progress: Array<{ id: string; label: string; state: string }> = [];

    for (const message of messages) {
      if (message.role !== 'assistant') continue;
      for (const raw of message.parts ?? []) {
        const part = raw as DataPart;
        if (part.type === 'data-partial') partial = part.data as TPartial;
        else if (part.type === 'data-final') final = part.data as TFinal;
        else if (part.type === 'data-reasoning') reasoning = (part.data as { text?: string })?.text ?? '';
        else if (part.type === 'data-action-error') error = (part.data as { message?: string })?.message ?? 'Action failed';
        else if (part.type === 'data-progress') {
          const d = part.data as { label?: string; state?: string };
          progress.push({ id: part.id ?? String(progress.length), label: d?.label ?? '', state: d?.state ?? 'running' });
        }
      }
    }
    return { partial, final, reasoning, error, progress };
  }, [messages]);

  return {
    ...derived,
    error: derived.error ?? (transportError ? transportError.message : null),
    isStreaming: status === 'submitted' || status === 'streaming',
    start: (extraBody?: Record<string, unknown>) =>
      sendMessage({ text: 'run' }, extraBody ? { body: extraBody } : undefined),
  };
}
```

Note on transient reasoning parts: `transient: true` parts are not persisted into `message.parts` on every ai@6 minor. After wiring the first surface (Task 4), if `reasoning` stays empty in the browser while the server probe (Task 1 Step 5) showed reasoning parts, remove `transient: true` from the kernel's reasoning emit — the part then reconciles by id like the others. This is the sanctioned fallback, decided once at Task 4 Step 4, applied in the kernel, and inherited by all surfaces.

- [ ] **Step 2: Typecheck via app build**

Run: `pnpm --filter @content-automation/content-generator-app build`
Expected: `✓ Compiled successfully` (hook not yet imported anywhere; this catches syntax/type errors via the package graph).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/hooks/use-action-stream.ts packages/ui/package.json pnpm-lock.yaml
git commit -m "feat: useActionStream hook — client consumption of action streams"
```

---

### Task 3: GenUI component kit + design language §9

**Files:**
- Create: `packages/ui/components/genui/ReasoningTicker.tsx`, `StreamSection.tsx`, `StreamList.tsx`, `EntityChipStream.tsx`, `ScoreRing.tsx`, `StreamingText.tsx`, `index.ts`
- Modify: `docs/design-language.md` (append §9)
- Modify: root `tsconfig.json` + `apps/{content-generator,outreach,unified}/tsconfig.json`: add alias `"@/components/genui": ["./packages/ui/components/genui/index.ts"]` next to the existing `@/components/ListCard` aliases.

**Interfaces:**
- Produces (props consumed by Tasks 4–12):
  - `<ReasoningTicker text={string} active={boolean} />`
  - `<StreamSection title={string} state={'idle'|'streaming'|'done'|'error'} children />`
  - `<StreamList items={string[]} />` (items animate in as the array grows)
  - `<EntityChipStream entities={Array<{ name: string; type: string }>} />`
  - `<ScoreRing score={number|null} label={string} />`
  - `<StreamingText text={string} done={boolean} />`

- [ ] **Step 1: Write the components**

`packages/ui/components/genui/ReasoningTicker.tsx`:

```tsx
'use client';
import { useEffect, useRef } from 'react';

/** Live model-thinking feed: mono, dim, auto-scrolling, collapses when empty. */
export function ReasoningTicker({ text, active }: { text: string; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [text]);
  if (!text) return null;
  return (
    <div
      ref={ref}
      className="max-h-28 overflow-y-auto rounded-md border border-border/50 bg-muted/30 px-4 py-3 font-mono text-xs leading-relaxed text-muted-foreground"
      aria-live="polite"
    >
      {text}
      {active && <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-primary/70 align-middle" />}
    </div>
  );
}
```

`packages/ui/components/genui/StreamSection.tsx`:

```tsx
'use client';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export type StreamState = 'idle' | 'streaming' | 'done' | 'error';

/** Card section whose border breathes while its content is being generated. */
export function StreamSection({
  title, state, children,
}: { title: string; state: StreamState; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-6 transition-colors duration-500',
        state === 'streaming' && 'border-primary/60 shadow-[0_0_0_1px_theme(colors.primary/25%)] animate-pulse',
        state === 'error' && 'border-destructive/60',
      )}
    >
      <div className="mb-4 flex items-center gap-2">
        <h3 className="font-semibold">{title}</h3>
        {state === 'streaming' && (
          <span className="text-xs text-primary">generating…</span>
        )}
      </div>
      {children}
    </div>
  );
}
```

`packages/ui/components/genui/StreamList.tsx`:

```tsx
'use client';

/** List whose items slide in as the streamed array grows. */
export function StreamList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li
          key={i}
          className="animate-in fade-in slide-in-from-bottom-1 text-sm duration-300"
        >
          <span className="mr-2 text-muted-foreground">•</span>
          {item}
        </li>
      ))}
    </ul>
  );
}
```

`packages/ui/components/genui/EntityChipStream.tsx`:

```tsx
'use client';

const TYPE_ORDER = ['BusinessValue', 'Feature', 'AIComponent', 'Integration', 'Database', 'Framework', 'Language', 'Cloud'];

/** Entity chips materialize grouped by type as extraction streams. */
export function EntityChipStream({ entities }: { entities: Array<{ name: string; type: string }> }) {
  const groups = new Map<string, string[]>();
  for (const e of entities) {
    if (!e?.name || !e?.type) continue;
    groups.set(e.type, [...(groups.get(e.type) ?? []), e.name]);
  }
  const ordered = [...groups.entries()].sort(
    (a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0]),
  );
  return (
    <div className="space-y-4">
      {ordered.map(([type, names]) => (
        <div key={type}>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">{type}s</div>
          <div className="flex flex-wrap gap-1.5">
            {names.map((name) => (
              <span
                key={name}
                className="animate-in fade-in zoom-in-95 rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs duration-300"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

`packages/ui/components/genui/ScoreRing.tsx`:

```tsx
'use client';

/** Animated 0–100 score ring; sweeps to the streamed value. */
export function ScoreRing({ score, label }: { score: number | null; label: string }) {
  const value = score ?? 0;
  const angle = (value / 100) * 360;
  return (
    <div className="flex items-center gap-3">
      <div
        className="grid h-16 w-16 place-items-center rounded-full transition-all duration-700"
        style={{
          background: `conic-gradient(hsl(var(--primary)) ${angle}deg, hsl(var(--muted)) ${angle}deg)`,
        }}
      >
        <div className="grid h-12 w-12 place-items-center rounded-full bg-card text-sm font-bold tabular-nums">
          {score === null ? '–' : value}
        </div>
      </div>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}
```

`packages/ui/components/genui/StreamingText.tsx`:

```tsx
'use client';

/** Long-form text that composes itself; caret while streaming. */
export function StreamingText({ text, done }: { text: string; done: boolean }) {
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed">
      {text}
      {!done && <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-primary/70 align-text-bottom" />}
    </div>
  );
}
```

`packages/ui/components/genui/index.ts`:

```ts
export { ReasoningTicker } from './ReasoningTicker';
export { StreamSection, type StreamState } from './StreamSection';
export { StreamList } from './StreamList';
export { EntityChipStream } from './EntityChipStream';
export { ScoreRing } from './ScoreRing';
export { StreamingText } from './StreamingText';
```

- [ ] **Step 2: Append design-language §9**

Append to `docs/design-language.md`:

```markdown
## 9. Generative surfaces

Every AI action streams. The anatomy is owned by `packages/ui/components/genui`:

- **Reasoning is ambient, not modal.** `ReasoningTicker` sits above the result
  surface — mono, dim, auto-scrolling. It fills the time-to-first-answer gap;
  never a spinner where reasoning is available.
- **Results assemble in place.** The same component renders partial and final
  state (`StreamSection` + `StreamList`/`EntityChipStream`/`ScoreRing`/
  `StreamingText`). No skeleton→swap: the skeleton IS the component filling in.
- **State is visible at the container.** `StreamSection` breathes (border
  pulse) while streaming, settles when done, flags errors. One glance answers
  "is it working."
- **Every generative view must survive being filmed.** A 3-second screen
  recording of any AI action must show visible motion of real work. This is a
  launch requirement, not polish.
```

- [ ] **Step 3: Add the tsconfig alias, build, commit**

Add `"@/components/genui": ["./packages/ui/components/genui/index.ts"]` to the `paths` of root `tsconfig.json` and the three app tsconfigs (`apps/content-generator/tsconfig.json`, `apps/outreach/tsconfig.json`, `apps/unified/tsconfig.json` — and `apps/styleguide/tsconfig.json` for the styleguide demo later).

Run: `pnpm build` — Expected: `Tasks: 5 successful`.

```bash
git add packages/ui/components/genui docs/design-language.md tsconfig.json apps/*/tsconfig.json
git commit -m "feat: genui component kit + design-language §9 generative surfaces"
```

---

### Task 4: Refine surface streams

**Files:**
- Create: `apps/content-generator/app/api/content/ideas/[id]/refine/stream/route.ts`
- Create: `apps/unified/app/api/content/ideas/[id]/refine/stream/route.ts`
- Modify: `apps/content-generator/app/content/ideas/[id]/page.tsx` (replace `handleRefine` poll, lines ~117–151)

**Interfaces:**
- Consumes: `actionStreamResponse`, `streamingStructuredGenerate` (Task 1); `useActionStream` (Task 2); `ReasoningTicker`, `StreamSection`, `StreamList` (Task 3); `runRefineContentIdea` from `@/products/content-generator/agent/actions/refine` (existing: `(payload: { ideaId: string }, options?: { deps?: Partial<RefineDeps> })`).
- Produces: the reference streaming-surface pattern every later task copies.

- [ ] **Step 1: Write the streaming route**

`apps/content-generator/app/api/content/ideas/[id]/refine/stream/route.ts`:

```ts
import { actionStreamResponse, streamingStructuredGenerate } from '@/packages/platform/agents/streaming';
import { runRefineContentIdea } from '@/products/content-generator/agent/actions/refine';

export const maxDuration = 600;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return actionStreamResponse({
    action: 'refine_content_idea',
    entityId: id,
    entityType: 'content_idea',
    run: (emit) =>
      runRefineContentIdea(
        { ideaId: id },
        { deps: { generate: streamingStructuredGenerate(emit) } },
      ) as Promise<Record<string, unknown>>,
  });
}
```

`apps/unified/app/api/content/ideas/[id]/refine/stream/route.ts`:

```ts
export { POST } from "@content-app/api/content/ideas/[id]/refine/stream/route";
```

- [ ] **Step 2: Rewire the idea page**

In `apps/content-generator/app/content/ideas/[id]/page.tsx`:

1. Add imports:

```tsx
import { useActionStream } from '@/hooks/use-action-stream';
import { ReasoningTicker, StreamSection, StreamList } from '@/components/genui';
```

(`@/hooks/use-action-stream` resolves through the existing `@/*` catch-all → add the explicit alias `"@/hooks/use-action-stream": ["./packages/ui/hooks/use-action-stream.ts"]` beside `@/hooks/use-mobile` in the same four tsconfigs if the catch-all maps to repo root instead of packages/ui — check `@/hooks/use-mobile` in root tsconfig and mirror it.)

2. Inside the component, replace the `handleRefine` + `setInterval` poll block (lines ~117–151) with:

```tsx
type RefinePartial = {
  outline?: string[];
  key_points?: string[];
  hook?: string;
  call_to_action?: string;
};

const refineStream = useActionStream<RefinePartial, { ideaId: string }>({
  api: `/api/content/ideas/${ideaId}/refine/stream`,
});

const handleRefine = () => {
  refineStream.start();
};

// When the stream completes, load the persisted idea once (no polling).
useEffect(() => {
  if (refineStream.final) {
    fetch(`/api/content/ideas/${ideaId}`)
      .then((r) => r.json())
      .then(setIdea)
      .catch(() => {});
  }
}, [refineStream.final, ideaId]);
useEffect(() => {
  if (refineStream.error) toast.error(refineStream.error);
}, [refineStream.error]);
```

3. Where the Outline and Key points cards render (lines ~364–390), show live streaming state when the idea is not yet refined:

```tsx
{(refineStream.isStreaming || refineStream.partial) && idea?.status !== 'refined' && (
  <div className="col-span-2 space-y-4">
    <ReasoningTicker text={refineStream.reasoning} active={refineStream.isStreaming} />
    <div className="grid grid-cols-2 gap-4">
      <StreamSection title="Outline" state={refineStream.isStreaming ? 'streaming' : 'done'}>
        <StreamList items={(refineStream.partial?.outline ?? []).filter(Boolean) as string[]} />
      </StreamSection>
      <StreamSection title="Key points" state={refineStream.isStreaming ? 'streaming' : 'done'}>
        <StreamList items={(refineStream.partial?.key_points ?? []).filter(Boolean) as string[]} />
      </StreamSection>
    </div>
  </div>
)}
```

Keep the existing static Outline/Key points cards for the already-refined state; the streaming block replaces only the pending experience. Wire the existing Refine button's `onClick` to the new `handleRefine`, disabled while `refineStream.isStreaming`.

- [ ] **Step 3: Build**

Run: `pnpm --filter @content-automation/content-generator-app build && pnpm --filter @content-automation/unified-app build`
Expected: both `✓ Compiled successfully`.

- [ ] **Step 4: Live browser verification (the reference check for all surfaces)**

Start the unified server locally (`.env` sourced, `POSTGRES_HOST=localhost NEO4J_URI=bolt://localhost:7687`). In the browser: open an idea with status `Idea`, click Refine. Expected: outline items appear one by one while streaming (partial array grows), reasoning ticker shows Qwen thinking (if reasoning parts arrive — see Task 2 note; if empty here but present in the Task 1 probe, remove `transient: true` from the kernel reasoning emit now), page settles to the standard refined layout with no reload, and `SELECT status FROM jobs ORDER BY created_at DESC LIMIT 1` shows `completed`.

- [ ] **Step 5: Gates + commit**

Run: `pnpm test:content` — Expected: all pass.

```bash
git add apps/content-generator/app/api/content/ideas apps/unified/app/api/content/ideas apps/content-generator/app/content/ideas
git commit -m "feat: refine streams live into the idea page"
```

---

### Task 5: Draft surface streams

**Files:**
- Create: `apps/content-generator/app/api/content/ideas/[id]/draft/stream/route.ts`
- Create: `apps/unified/app/api/content/ideas/[id]/draft/stream/route.ts`
- Modify: `apps/content-generator/app/content/ideas/[id]/page.tsx` (`handleGenerateDraft`, lines ~159–195)

**Interfaces:**
- Consumes: Task 1/2/3 exports; `runGenerateContentDraft` from `@/products/content-generator/agent/actions/draft` (existing: `(payload: { ideaId: string; contentType: string }, options?: { deps?: Partial<DraftDeps> })`, `DraftDeps.generate: StructuredGenerate`).

- [ ] **Step 1: Write the streaming route**

`apps/content-generator/app/api/content/ideas/[id]/draft/stream/route.ts`:

```ts
import { actionStreamResponse, streamingStructuredGenerate } from '@/packages/platform/agents/streaming';
import { runGenerateContentDraft } from '@/products/content-generator/agent/actions/draft';

export const maxDuration = 600;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { contentType } = await request.json();
  return actionStreamResponse({
    action: 'generate_content_draft',
    entityId: id,
    entityType: 'content_idea',
    run: (emit) =>
      runGenerateContentDraft(
        { ideaId: id, contentType },
        { deps: { generate: streamingStructuredGenerate(emit) } },
      ) as unknown as Promise<Record<string, unknown>>,
  });
}
```

Unified re-export: `export { POST } from "@content-app/api/content/ideas/[id]/draft/stream/route";`

Body note: `useActionStream.start({ contentType })` merges `contentType` into the POST body via the transport's `prepareSendMessagesRequest` — pass it through `body` on the hook instead (stable per call): construct the hook per-selection or send via `start` extraBody; the route reads `contentType` from the JSON body either way.

- [ ] **Step 2: Rewire the Generate as… flow**

In the idea page, replace `handleGenerateDraft` + its poll (lines ~159–195):

```tsx
type DraftPartial = {
  title?: string;
  introduction?: string;
  sections?: string[];
  conclusion?: string;
  tweets?: string[];
  hook?: string;
  body?: string;
  main_sections?: string[];
};

const draftStream = useActionStream<DraftPartial, { draftId: string }>({
  api: `/api/content/ideas/${ideaId}/draft/stream`,
});

const handleGenerateDraft = (contentType: string) => {
  draftStream.start({ contentType });
};

useEffect(() => {
  if (draftStream.final) {
    fetch(`/api/content/drafts?ideaId=${ideaId}`)
      .then((r) => r.json())
      .then(setDrafts)
      .catch(() => {});
  }
}, [draftStream.final, ideaId]);
useEffect(() => {
  if (draftStream.error) toast.error(draftStream.error);
}, [draftStream.error]);
```

Render the composition live above the drafts table (`draftText` concatenates whatever fields the selected type streams):

```tsx
{(draftStream.isStreaming || (draftStream.partial && !draftStream.final)) && (
  <div className="space-y-4">
    <ReasoningTicker text={draftStream.reasoning} active={draftStream.isStreaming} />
    <StreamSection title="Draft" state={draftStream.isStreaming ? 'streaming' : 'done'}>
      <StreamingText
        done={!draftStream.isStreaming}
        text={[
          draftStream.partial?.title && `# ${draftStream.partial.title}`,
          draftStream.partial?.hook,
          draftStream.partial?.introduction,
          ...(draftStream.partial?.sections ?? []),
          ...(draftStream.partial?.main_sections ?? []),
          ...(draftStream.partial?.tweets ?? []).map((t, i) => `${i + 1}/ ${t}`),
          draftStream.partial?.body,
          draftStream.partial?.conclusion,
        ].filter(Boolean).join('\n\n')}
      />
    </StreamSection>
  </div>
)}
```

Import `StreamingText` alongside the other genui imports. Disable the Generate dropdown while `draftStream.isStreaming`.

- [ ] **Step 3: Build, live verify, commit**

Run: `pnpm --filter @content-automation/content-generator-app build && pnpm --filter @content-automation/unified-app build` — Expected: green.

Browser: on a refined idea, Generate as… → Tweet thread. Expected: reasoning ticker, then tweets composing one by one in `StreamingText` over ~30–60 s, drafts table updates at the end without reload.

```bash
git add apps/content-generator/app apps/unified/app
git commit -m "feat: drafts compose themselves live on the idea page"
```

---

### Task 6: Ideas surface streams

**Files:**
- Create: `apps/content-generator/app/api/content/generate-ideas/stream/route.ts`
- Create: `apps/unified/app/api/content/generate-ideas/stream/route.ts`
- Modify: `apps/content-generator/app/content/page.tsx` (`handleGenerateIdeas` + poll, lines ~129–166)

**Interfaces:**
- Consumes: `runGenerateContentIdeas` from `@/products/content-generator/agent/actions/ideas` (existing: `(payload: { count?: number }, options?: { deps?: Partial<IdeasDeps> })`, `IdeasDeps.generate: StructuredGenerate`).

- [ ] **Step 1: Streaming route**

`apps/content-generator/app/api/content/generate-ideas/stream/route.ts`:

```ts
import { actionStreamResponse, streamingStructuredGenerate } from '@/packages/platform/agents/streaming';
import { runGenerateContentIdeas } from '@/products/content-generator/agent/actions/ideas';

export const maxDuration = 600;

export async function POST(request: Request) {
  const { count } = await request.json().catch(() => ({ count: 5 }));
  return actionStreamResponse({
    action: 'generate_content_ideas',
    entityId: 'content',
    run: (emit) =>
      runGenerateContentIdeas(
        { count: count ?? 5 },
        { deps: { generate: streamingStructuredGenerate(emit) } },
      ) as unknown as Promise<Record<string, unknown>>,
  });
}
```

Unified re-export: `export { POST } from "@content-app/api/content/generate-ideas/stream/route";`

Check: `createJob('generate_content_ideas', 'content')` — the existing job route already passes a non-entity id for this action; copy whatever `entityId` string `apps/content-generator/app/api/content/generate-ideas/route.ts` currently passes to `createJob` (read the file; use its exact value).

- [ ] **Step 2: Rewire content page**

Replace `handleGenerateIdeas` + the interval poll (lines ~129–166) in `apps/content-generator/app/content/page.tsx`:

```tsx
type IdeasPartial = {
  ideas?: Array<{ title?: string; description?: string; priority?: string }>;
};

const ideasStream = useActionStream<IdeasPartial, { created: number }>({
  api: '/api/content/generate-ideas/stream',
});

const handleGenerateIdeas = () => ideasStream.start({ count: 5 });

useEffect(() => {
  if (ideasStream.final) fetchData();
}, [ideasStream.final]);
useEffect(() => {
  if (ideasStream.error) toast.error(ideasStream.error);
}, [ideasStream.error]);
```

Above the ideas list, ideas materialize as cards while streaming:

```tsx
{ideasStream.isStreaming && (
  <div className="space-y-4">
    <ReasoningTicker text={ideasStream.reasoning} active />
    <div className="grid gap-3">
      {(ideasStream.partial?.ideas ?? []).filter((i) => i?.title).map((idea, n) => (
        <div key={n} className="animate-in fade-in slide-in-from-bottom-2 rounded-lg border bg-card p-4 duration-300">
          <div className="font-medium">{idea.title}</div>
          {idea.description && (
            <div className="mt-1 text-sm text-muted-foreground">{idea.description}</div>
          )}
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 3: Build, live verify, commit**

Build both apps; browser: Generate ideas → cards appear one by one, list refreshes at completion, no 5-second polling in the network tab.

```bash
git add apps/content-generator/app apps/unified/app
git commit -m "feat: ideas materialize live on the content page"
```

---

### Task 7: Topics surface streams

**Files:**
- Modify: `products/content-generator/agent/actions/topics.ts` (add export)
- Create: `apps/content-generator/app/api/content/topics/generate/stream/route.ts` + unified re-export
- Modify: `apps/content-generator/app/content/topics/page.tsx` (`handleGenerateTopics`, lines ~243–260)

**Interfaces:**
- Consumes: `runExtractTopics(input: GenerateTopicsInput-side payload, options: { deps })` with `TopicsDeps.generateTopics: (input: GenerateTopicsInput) => Promise<ExtractedTopics>` (topics.ts:80).
- Produces: `streamingGenerateTopics(emit: StreamEmit): TopicsDeps['generateTopics']` exported from topics.ts.

- [ ] **Step 1: Add the streaming seam to topics.ts**

In `products/content-generator/agent/actions/topics.ts`, after `defaultGenerateTopics`, add (reusing the module's existing `createTopicsAgent` import and `extractedTopicsSchema`):

```ts
import { streamingStructuredGenerate, type StreamEmit } from '@/packages/platform/agents/streaming';

/**
 * Streaming variant of the generateTopics seam: same agent, same schema,
 * same temperature — partial topics + reasoning forwarded to the UI.
 */
export function streamingGenerateTopics(emit: StreamEmit): TopicsDeps['generateTopics'] {
  return async (input) => {
    const agent = createTopicsAgent(input.entitiesFormatted, input.existingTopicNames);
    const generate = streamingStructuredGenerate(emit, {
      agentStream: async ({ prompt, schema, temperature }) => {
        const stream = await agent.stream(prompt, {
          structuredOutput: { schema },
          modelSettings: { temperature, maxOutputTokens: 32768 },
          providerOptions: { openrouter: { reasoning: { effort: 'medium' } } },
        });
        return stream.fullStream as never;
      },
    });
    return generate({
      agentId: 'topics-agent', agentName: 'Topics Agent', instructions: '',
      prompt: 'Extract content topics from the project entities above.',
      schema: extractedTopicsSchema, temperature: 0.3,
    });
  };
}
```

Adjust the two internal names to the module's real ones: the agent factory used by `defaultGenerateTopics` (`createTopicsAgent` — confirm exact import name at the top of topics.ts) and the schema constant it passes (`extractedTopicsSchema` — confirm; both are visible in `defaultGenerateTopics` at topics.ts:92-100). The prompt string must be byte-identical to `defaultGenerateTopics`'s.

- [ ] **Step 2: Streaming route + page rewire**

Route `apps/content-generator/app/api/content/topics/generate/stream/route.ts`:

```ts
import { actionStreamResponse } from '@/packages/platform/agents/streaming';
import { runExtractTopics, streamingGenerateTopics } from '@/products/content-generator/agent/actions/topics';

export const maxDuration = 600;

export async function POST() {
  return actionStreamResponse({
    action: 'extract_topics',
    entityId: 'topics',
    run: (emit) =>
      runExtractTopics({}, { deps: { generateTopics: streamingGenerateTopics(emit) } }) as unknown as Promise<Record<string, unknown>>,
  });
}
```

Copy the exact `entityId` and `runExtractTopics` call arity from the existing `apps/content-generator/app/api/content/topics/generate/route.ts` (payload `{daysBack}` may thread through — mirror it). Unified re-export as before.

Page: replace `handleGenerateTopics` (lines ~243–260, drop the `setTimeout(fetchTopics, 15000)`):

```tsx
type TopicsPartial = { topics?: Array<{ display_name?: string; name?: string }> };

const topicsStream = useActionStream<TopicsPartial, { created: number }>({
  api: '/api/content/topics/generate/stream',
});
const handleGenerateTopics = () => topicsStream.start();

useEffect(() => { if (topicsStream.final) fetchTopics(); }, [topicsStream.final]);
useEffect(() => { if (topicsStream.error) toast.error(topicsStream.error); }, [topicsStream.error]);
```

Streaming block above the topic grid — chips materialize:

```tsx
{topicsStream.isStreaming && (
  <div className="space-y-4">
    <ReasoningTicker text={topicsStream.reasoning} active />
    <StreamSection title="Discovering topics" state="streaming">
      <div className="flex flex-wrap gap-2">
        {(topicsStream.partial?.topics ?? []).filter((t) => t?.display_name || t?.name).map((t, i) => (
          <span key={i} className="animate-in fade-in zoom-in-95 rounded-full border bg-muted/50 px-3 py-1 text-sm duration-300">
            {t.display_name ?? t.name}
          </span>
        ))}
      </div>
    </StreamSection>
  </div>
)}
```

- [ ] **Step 3: Build, gates, live verify, commit**

`pnpm test:content` (topics unit tests must still pass — the streaming seam is additive), build both apps, browser-verify chips materialize.

```bash
git add products/content-generator/agent/actions/topics.ts apps/content-generator/app apps/unified/app
git commit -m "feat: topics materialize live via streaming generateTopics seam"
```

---

### Task 8: Project entities surface streams

**Files:**
- Modify: `products/content-generator/agent/actions/project-graph.ts` (add export)
- Create: `apps/content-generator/app/api/content/projects/[id]/ingest/stream/route.ts` + unified re-export
- Modify: `apps/content-generator/app/content/projects/[id]/page.tsx` (`handleReingest` line ~77, entities display ~119)

**Interfaces:**
- Consumes: `runBuildProjectGraph(payload: BuildProjectGraphPayload, options?: { deps?: Partial<BuildProjectGraphDeps> })`; `BuildProjectGraphDeps.extractEntities: (project: ProjectFacts, settings: Settings) => Promise<ProjectEntities>`; `projectEntitiesSchema` (already exported, project-graph.ts:45).
- Produces: `streamingExtractEntities(emit: StreamEmit): BuildProjectGraphDeps['extractEntities']` exported from project-graph.ts.

- [ ] **Step 1: Add the streaming seam**

In `products/content-generator/agent/actions/project-graph.ts`, mirror the default `extractEntities` implementation (find the default impl the module wires into its `defaultDeps` — it builds the extraction prompt from `project` + `settings` and calls the agent with `projectEntitiesSchema`, temp 0.3). Add:

```ts
import { streamingStructuredGenerate, type StreamEmit } from '@/packages/platform/agents/streaming';

/** Streaming variant of the extractEntities seam. */
export function streamingExtractEntities(emit: StreamEmit): BuildProjectGraphDeps['extractEntities'] {
  return (project, settings) => {
    const generate = streamingStructuredGenerate(emit);
    return generate({
      agentId: 'project-graph-agent',
      agentName: 'Project Graph Agent',
      instructions: buildExtractionInstructions(settings),
      prompt: buildExtractionPrompt(project),
      schema: projectEntitiesSchema,
      temperature: 0.3,
    });
  };
}
```

The default impl's instructions/prompt construction must be reused, not duplicated: if they are inline in the default `extractEntities`, extract them into module-level `buildExtractionInstructions(settings)` / `buildExtractionPrompt(project)` helpers used by BOTH the default and streaming variants (pure refactor — unit tests unchanged prove equivalence).

- [ ] **Step 2: Route + page**

Route (`.../ingest/stream/route.ts`), copying the existing ingest route's payload contract (`project_id`):

```ts
import { actionStreamResponse } from '@/packages/platform/agents/streaming';
import { runBuildProjectGraph, streamingExtractEntities } from '@/products/content-generator/agent/actions/project-graph';

export const maxDuration = 600;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return actionStreamResponse({
    action: 'build_project_graph',
    entityId: id,
    entityType: 'project',
    run: (emit) =>
      runBuildProjectGraph(
        { projectId: id },
        { deps: { extractEntities: streamingExtractEntities(emit) } },
      ) as unknown as Promise<Record<string, unknown>>,
  });
}
```

Match `BuildProjectGraphPayload`'s real field name (`projectId` vs `project_id` — it's declared at project-graph.ts:63; use exactly that). Unified re-export.

Page: `handleReingest` calls `entitiesStream.start()`; while streaming, render `<ReasoningTicker>` + `<EntityChipStream entities={(entitiesStream.partial?.entities ?? []).filter(e => e?.name && e?.type)} />` inside a `StreamSection` replacing the fire-and-forget toast; on `final`, call the page's existing `fetchEntities()`.

```tsx
type EntitiesPartial = { entities?: Array<{ name: string; type: string }> };

const entitiesStream = useActionStream<EntitiesPartial, { entityCount: number }>({
  api: `/api/content/projects/${projectId}/ingest/stream`,
});
const handleReingest = () => entitiesStream.start();
useEffect(() => { if (entitiesStream.final) fetchEntities(); }, [entitiesStream.final]);
useEffect(() => { if (entitiesStream.error) toast.error(entitiesStream.error); }, [entitiesStream.error]);
```

Note: `runBuildProjectGraph` skips already-processed projects. The existing non-stream ingest route/job path handles first ingestion on create (keep it); the streaming surface is the Re-extract button — whose payload must set the same force/re-extract flag the current re-ingest route sends (read `apps/content-generator/app/api/content/projects/[id]/ingest/route.ts` for the flag it passes and mirror it in the stream route body).

- [ ] **Step 3: Build, live verify (chips materialize on Re-extract), commit**

```bash
git add products/content-generator/agent/actions/project-graph.ts apps/content-generator/app apps/unified/app
git commit -m "feat: project entities materialize live on re-extract"
```

---

### Task 9: Research surface streams

**Files:**
- Modify: `products/content-generator/agent/actions/research.ts` (add export)
- Create: `apps/content-generator/app/api/content/research/run/stream/route.ts` + unified re-export
- Modify: `apps/content-generator/app/content/research/page.tsx` (`handleRunResearch` lines ~293–314)

**Interfaces:**
- Consumes: `runDoResearch(payload: DoResearchPayload, options?: { deps?: Partial<ResearchDeps> })`; `ResearchDeps.generateItems: (input: GenerateItemsInput) => Promise<ExtractedResearchItems>`.
- Produces: `streamingGenerateItems(emit: StreamEmit): ResearchDeps['generateItems']` exported from research.ts.

- [ ] **Step 1: Streaming seam** — mirror the module's default `generateItems` (per-source extraction agent, temp 0.3, `extractedResearchItemsSchema`); per call, also announce the source as a progress part so the feed shows source-by-source movement:

```ts
import { streamingStructuredGenerate, type StreamEmit } from '@/packages/platform/agents/streaming';

/** Streaming generateItems: announces each source, streams its extraction. */
export function streamingGenerateItems(emit: StreamEmit): ResearchDeps['generateItems'] {
  return async (input) => {
    emit({
      type: 'data-progress',
      id: `source-${input.sourceName}`,
      data: { label: `Extracting from ${input.sourceName}`, state: 'running' },
    });
    const generate = streamingStructuredGenerate(emit);
    const result = await generate({
      agentId: 'research-agent',
      agentName: 'Research Agent',
      instructions: buildResearchInstructions(input),
      prompt: buildResearchPrompt(input),
      schema: extractedResearchItemsSchema,
      temperature: 0.3,
    });
    emit({
      type: 'data-progress',
      id: `source-${input.sourceName}`,
      data: { label: `Extracted from ${input.sourceName}`, state: 'done' },
    });
    return result;
  };
}
```

As in Task 8: reuse the default impl's prompt construction — extract `buildResearchInstructions` / `buildResearchPrompt` helpers from the default `generateItems` if inline (pure refactor). `GenerateItemsInput`'s real field names are at research.ts:79 — use its actual source-name field (`sourceName` vs `source_name`).

- [ ] **Step 2: Route + page** — route mirrors the existing run route's payload (`{ sourceIds?, timeRange? }` from body):

```ts
import { actionStreamResponse } from '@/packages/platform/agents/streaming';
import { runDoResearch, streamingGenerateItems } from '@/products/content-generator/agent/actions/research';

export const maxDuration = 600;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return actionStreamResponse({
    action: 'do_research',
    entityId: 'research',
    run: (emit) =>
      runDoResearch(
        { sourceIds: body.sourceIds ?? null, timeRange: body.timeRange ?? 'week' },
        { deps: { generateItems: streamingGenerateItems(emit) } },
      ) as unknown as Promise<Record<string, unknown>>,
  });
}
```

Match `DoResearchPayload`'s exact field names (research.ts:43) and the entityId the existing run route passes. Page: replace `handleRunResearch` + `setTimeout(fetchItems, 10000)` with the hook; render the `progress` array as a live per-source checklist plus `<ReasoningTicker>`; on `final`, `fetchItems()`:

```tsx
{researchStream.isStreaming && (
  <StreamSection title="Researching sources" state="streaming">
    <ul className="space-y-1.5 text-sm">
      {researchStream.progress.map((p) => (
        <li key={p.id} className="flex items-center gap-2 animate-in fade-in duration-300">
          <span className={p.state === 'done' ? 'text-primary' : 'animate-pulse text-muted-foreground'}>
            {p.state === 'done' ? '✓' : '…'}
          </span>
          {p.label}
        </li>
      ))}
    </ul>
  </StreamSection>
)}
```

(`useActionStream`'s `progress` dedupes by part id reconciliation on the server side; the client receives the latest state per id — the hook's scan keeps the last occurrence per id: adjust the hook's progress accumulation to `Map` by `id` if duplicates appear, keeping insertion order.)

- [ ] **Step 3: Build, gates, live verify (needs `TAVILY_API_KEY` locally), commit**

```bash
git add products/content-generator/agent/actions/research.ts apps/content-generator/app apps/unified/app
git commit -m "feat: research runs as a live source-by-source feed"
```

---

### Task 10: Qualification surface streams

**Files:**
- Modify: `products/outreach/agent/qualify-lead.ts` (add export)
- Create: `apps/outreach/app/api/outreach/leads/[id]/qualify/stream/route.ts` + unified re-export
- Modify: `products/outreach/ui/components/leads/QualificationCard.tsx` (accept a re-qualify trigger + live state)
- Modify: `apps/outreach/app/outreach/leads/[id]/page.tsx` (~line 578 QualificationCard usage)

**Interfaces:**
- Consumes: `runQualifyLead(leadId: string, options?: { deps?: Partial<QualifyLeadDeps> })` (confirm exact arity at qualify-lead.ts:188 — first param is the lead id per the O-wave contract); `QualifyLeadDeps.scorePersona: (input: ScorePersonaInput) => Promise<QualificationScore>`; `qualificationScoreSchema` (already exported, qualify-lead.ts:37).
- Produces: `streamingScorePersona(emit: StreamEmit): QualifyLeadDeps['scorePersona']`.

- [ ] **Step 1: Streaming seam** in qualify-lead.ts (mirror the default `scorePersona` — persona-injected instructions, lead+research prompt, temp 0.2; extract `buildScoreInstructions(input)` / `buildScorePrompt(input)` helpers if inline, pure refactor):

```ts
import { streamingStructuredGenerate, type StreamEmit } from '@/packages/platform/agents/streaming';

/** Streaming variant of scorePersona: partial rubric visible as it forms. */
export function streamingScorePersona(emit: StreamEmit): QualifyLeadDeps['scorePersona'] {
  return (input) => {
    emit({
      type: 'data-progress',
      id: `persona-${input.persona.id}`,
      data: { label: `Scoring vs ${input.persona.name}`, state: 'running' },
    });
    const generate = streamingStructuredGenerate(emit);
    return generate({
      agentId: 'qualify-agent',
      agentName: 'Qualification Agent',
      instructions: buildScoreInstructions(input),
      prompt: buildScorePrompt(input),
      schema: qualificationScoreSchema,
      temperature: 0.2,
    });
  };
}
```

- [ ] **Step 2: Route + card**

Route `apps/outreach/app/api/outreach/leads/[id]/qualify/stream/route.ts`:

```ts
import { actionStreamResponse } from '@/packages/platform/agents/streaming';
import { runQualifyLead, streamingScorePersona } from '@/products/outreach/agent/qualify-lead';

export const maxDuration = 600;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return actionStreamResponse({
    action: 'qualify_lead',
    entityId: id,
    entityType: 'lead',
    run: (emit) =>
      runQualifyLead(id, { deps: { scorePersona: streamingScorePersona(emit) } }) as unknown as Promise<Record<string, unknown>>,
  });
}
```

(Confirm `runQualifyLead`'s exact signature at qualify-lead.ts:188 and match — if it takes `({ leadId })`, pass that.) Unified re-export.

`QualificationCard.tsx`: add optional props `onRequalify?: () => void; live?: { score: number | null; notes: string; reasoning: string; isStreaming: boolean }`. When `live?.isStreaming`, render `<ReasoningTicker text={live.reasoning} active />` + `<ScoreRing score={live.score} label="scoring…" />` above the persisted content; add a "Re-qualify" ghost button wired to `onRequalify` when the prop is present.

Lead page: add the hook + wire the card:

```tsx
type QualifyPartial = { score?: number; notes?: string };

const qualifyStream = useActionStream<QualifyPartial, { score: number }>({
  api: `/api/outreach/leads/${leadId}/qualify/stream`,
});

useEffect(() => {
  if (qualifyStream.final) refetchQualification(); // the page's existing GET (line ~143 fetch) extracted into a callable
}, [qualifyStream.final]);
```

```tsx
<QualificationCard
  qualification={qualification}
  isLoading={qualificationLoading}
  onRequalify={() => qualifyStream.start()}
  live={{
    score: qualifyStream.partial?.score ?? null,
    notes: qualifyStream.partial?.notes ?? '',
    reasoning: qualifyStream.reasoning,
    isStreaming: qualifyStream.isStreaming,
  }}
/>
```

- [ ] **Step 3: Gates (`pnpm --filter @content-automation/outreach test` — qualify unit tests unchanged), build, live verify (score ring sweeps as Qwen scores), commit**

```bash
git add products/outreach apps/outreach/app apps/unified/app
git commit -m "feat: qualification scores live with visible rubric reasoning"
```

---

### Task 11: Lead research route — objectStream upgrade

**Files:**
- Modify: `apps/outreach/app/api/outreach/research/route.ts`

**Interfaces:**
- Consumes: existing route internals (createUIMessageStream + `toAISdkStream`); `leadResearchSchema` from `@/products/outreach/domain/research-schema`.
- Produces: byte-compatible data parts (`data-research-result`, `data-research-error`, pass-through `data-tool-progress`) — `research-mastra.tsx` must not change.

- [ ] **Step 1: Replace regex-JSON accumulation with structured streaming**

The route currently streams text, accumulates it, regex-extracts JSON, zod-validates, then emits `data-research-result`. Replace the agent call + accumulation: call `agent.stream(prompt, { structuredOutput: { schema: leadResearchSchema }, modelSettings: { maxOutputTokens: 32768 }, providerOptions: { openrouter: { reasoning: { effort: 'medium' } } } })`; iterate `stream.fullStream`; forward tool parts as today (pass-through via `toAISdkStream` is replaced by direct chunk handling):

```ts
const stream = await agent.stream(prompt, {
  structuredOutput: { schema: leadResearchSchema },
  modelSettings: { maxOutputTokens: 32768 },
  providerOptions: { openrouter: { reasoning: { effort: 'medium' } } },
});

const uiMessageStream = createUIMessageStream({
  execute: async ({ writer }) => {
    let reasoning = '';
    let finalResult: LeadResearchResult | null = null;
    try {
      for await (const chunk of stream.fullStream as AsyncIterable<{ type: string; payload?: { text?: string }; object?: unknown }>) {
        if (chunk.type === 'reasoning-delta') {
          reasoning += chunk.payload?.text ?? '';
          writer.write({ type: 'data-reasoning', id: 'reasoning', data: { text: reasoning } } as never);
        } else if (chunk.type === 'object') {
          writer.write({ type: 'data-research-partial', id: 'partial', data: chunk.object } as never);
        } else if (chunk.type === 'object-result') {
          finalResult = chunk.object as LeadResearchResult;
        } else if (chunk.type.startsWith('tool-')) {
          // preserve existing tool progress behavior: translate to the same
          // data-tool-progress parts the current route passes through
          writer.write({ type: 'data-tool-progress', data: chunk } as never);
        }
      }
      if (!finalResult) throw new Error('research produced no structured result');
      const validated = leadResearchSchema.parse(finalResult);
      await storeLeadResearch(leadId, validated);
      writer.write({ type: 'data-research-result', id: 'result', data: validated } as never);
    } catch (error) {
      writer.write({
        type: 'data-research-error', id: 'error',
        data: { message: error instanceof Error ? error.message : 'Research failed' },
      } as never);
    }
  },
});
return createUIMessageStreamResponse({ stream: uiMessageStream });
```

Before rewriting, read the current route fully (lines 40–120) and preserve: the exact prompt construction, the exact shape `research-mastra.tsx` expects inside `data-tool-progress` parts (open `research-mastra.tsx` lines 75–130 and keep the part payloads it parses identical — if it reads `part.data.toolName`/`status`, map chunk fields to those names), and `storeLeadResearch` semantics. The client component is NOT modified in this task; extending it to render `data-research-partial`/`data-reasoning` is optional polish inside the same task if time allows — additive parts are ignored by the current parser, so shipping the route alone is safe.

- [ ] **Step 2: Live verify + commit**

Browser: run research on a lead — progress toasts still work, result card fills, research persists to Neo4j (check the lead page after reload). Then:

```bash
git add apps/outreach/app/api/outreach/research/route.ts
git commit -m "feat: lead research streams structured partials (no regex JSON parsing)"
```

---

### Task 12: Nurture Template Studio — templates type themselves

**Files:**
- Modify: `products/cascade/agent/template-agent.ts` (export prompt + validator)
- Create: `apps/unified/app/api/cascade/templates/generate/stream/route.ts`
- Modify: `apps/unified/app/cascade/templates/page.tsx` (`generate()`, lines ~104–110)

**Interfaces:**
- Consumes: `routerModel()` from `@/packages/platform/agents/model`; `Agent` from `@mastra/core/agent`; template constants below.
- Produces from template-agent.ts: `TEMPLATE_SYSTEM` (the current `system` string), `templatePrompt(briefing: string): string` (the current `prompt` template), `validateTemplateSource(mjmlSource: string): Promise<string>` (markers + mjml2html strict compile, returns cleaned source or throws — extracted verbatim from `generateTemplateMjml`, which is refactored to call these; behavior unchanged, `pnpm test:cascade` proves it).

- [ ] **Step 1: Refactor template-agent.ts exports**

```ts
export const TEMPLATE_SYSTEM = "You produce MJML email layouts. Respond with ONLY MJML.";

export function templatePrompt(briefing: string): string {
  return `Design an email layout for: ${briefing}

Requirements:
- Valid MJML (<mjml><mj-body>...).
- Must contain these Handlebars markers exactly: {{{slots.hero}}}, {{{slots.body}}}, {{{slots.cta}}}.
- Must contain an unsubscribe link: <a href="{{{unsubscribeUrl}}}">Unsubscribe</a>.
- Distinctive, intentional design: real palette and typographic hierarchy, not a plain default.`;
}

export async function validateTemplateSource(raw: string): Promise<string> {
  const mjmlSource = raw.replace(/```(?:mjml|xml|html)?/g, "").trim();
  for (const marker of REQUIRED_MARKERS) {
    if (!mjmlSource.includes(marker)) {
      throw new Error(`generated template failed validation: missing ${marker}`);
    }
  }
  try {
    const compiled = await mjml2html(mjmlSource, { validationLevel: "strict" });
    if (!compiled.html) throw new Error("empty output");
  } catch (err) {
    throw new Error(`generated template failed validation: ${err instanceof Error ? err.message : err}`);
  }
  return mjmlSource;
}

export async function generateTemplateMjml(llm: LlmClient, briefing: string): Promise<string> {
  const raw = await llm.complete(TEMPLATE_SYSTEM, templatePrompt(briefing));
  return validateTemplateSource(raw);
}
```

Run `pnpm test:cascade` — Expected: 62/62 (pure refactor).

- [ ] **Step 2: Streaming route** — `apps/unified/app/api/cascade/templates/generate/stream/route.ts` (text streaming, not structured; the MJML types itself):

```ts
import { Agent } from '@mastra/core/agent';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { routerModel } from '@/packages/platform/agents/model';
import {
  TEMPLATE_SYSTEM,
  templatePrompt,
  validateTemplateSource,
} from '@/products/cascade/agent/template-agent';

export const maxDuration = 600;

export async function POST(request: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return Response.json(
      { error: 'OPENROUTER_API_KEY is not configured — add it to .env to enable AI generation' },
      { status: 400 },
    );
  }
  const { briefing } = await request.json();
  const agent = new Agent({
    id: 'template-agent', name: 'Template Agent',
    instructions: TEMPLATE_SYSTEM, model: routerModel(),
  });
  const stream = await agent.stream(templatePrompt(briefing), {
    modelSettings: { maxOutputTokens: 16384 },
  });

  const uiMessageStream = createUIMessageStream({
    execute: async ({ writer }) => {
      let source = '';
      try {
        for await (const chunk of stream.fullStream as AsyncIterable<{ type: string; payload?: { text?: string } }>) {
          if (chunk.type === 'text-delta') {
            source += chunk.payload?.text ?? '';
            writer.write({ type: 'data-partial', id: 'partial', data: { mjml: source } } as never);
          }
        }
        const validated = await validateTemplateSource(source);
        writer.write({ type: 'data-final', id: 'final', data: { mjml: validated } } as never);
      } catch (error) {
        writer.write({
          type: 'data-action-error', id: 'error',
          data: { message: error instanceof Error ? error.message : 'Generation failed' },
        } as never);
      }
    },
  });
  return createUIMessageStreamResponse({ stream: uiMessageStream });
}
```

(`text-delta` payload field: same probe rule as Task 1 Step 5 — if `chunk.payload?.text` is empty on first live run, log one chunk and use the observed field.) This route intentionally has no job row: the existing sync route also has none (`Template Studio` is synchronous today); keep the old route untouched as API fallback.

- [ ] **Step 3: Page rewire** — in `apps/unified/app/cascade/templates/page.tsx`, replace `generate()` (lines ~104–110):

```tsx
type TemplatePartial = { mjml?: string };

const templateStream = useActionStream<TemplatePartial, { mjml: string }>({
  api: '/api/cascade/templates/generate/stream',
});
const generate = () => templateStream.start({ briefing });

useEffect(() => {
  if (templateStream.partial?.mjml) setMjml(templateStream.partial.mjml);
}, [templateStream.partial]);
useEffect(() => {
  if (templateStream.final) setMjml(templateStream.final.mjml);
}, [templateStream.final]);
useEffect(() => {
  if (templateStream.error) toast.error(templateStream.error);
}, [templateStream.error]);
```

The MJML editor fills as the model writes; the existing live preview re-renders per keystroke of the model. Generate button disabled while `templateStream.isStreaming`.

- [ ] **Step 4: Gates, build, live verify (template writes itself + preview animates), commit**

```bash
git add products/cascade/agent/template-agent.ts apps/unified/app
git commit -m "feat: Template Studio — templates type themselves with live preview"
```

---

### Task 13: Sweep, full gates, film pass

**Files:**
- Modify: any page still holding a dead `setInterval`/`setTimeout` poll from the replaced flows
- Test: full suite

- [ ] **Step 1: Poll sweep**

Run: `grep -rn "setInterval\|setTimeout" apps/content-generator/app/content apps/outreach/app/outreach apps/unified/app/cascade --include="*.tsx" | grep -v node_modules`
Expected: no remaining job-polling loops tied to the migrated actions (toast timers etc. are fine). Delete any leftovers found.

- [ ] **Step 2: Full gates**

Run, in order: `pnpm test:content && pnpm test:cascade && pnpm --filter @content-automation/outreach test && pnpm test:architecture && pnpm build`
Expected: all green, `Tasks: 5 successful`.

- [ ] **Step 3: Film pass (the launch requirement from design-language §9)**

With the local server running, screen-record each surface end to end: refine, draft, ideas, topics, entities, research, qualify, lead research, template studio. Each clip must show visible motion of real work within 3 seconds of the trigger click. Any surface that fails (blank gap > 3 s with no reasoning/partials) gets its reasoning effort raised (`effort: 'medium'` → `'low'` makes answers start sooner; `exclude: true` removes thinking) or its empty-state copy fixed — tune per surface, re-record.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: generative UI migration sweep — polls removed, gates green"
```

Do NOT push: pushing main deploys to production. Present the branch for user review first (deploy gate).

---

## Self-review notes

- **Coverage:** all 9 UI surfaces from the inventory are tasked (1 project entities, 2 topics, 3 ideas, 4 refine, 5 draft, 6 research, 7 qualify + lead research, 9 template studio); chat (#8) is an explicit non-goal (already streams); the shared-poll-helper gap (#10) is resolved by `useActionStream` replacing per-page polls.
- **Placeholder scan:** the four "confirm exact name" notes (BackgroundAction import site, topics agent factory name, payload field names, qualify arity) are deliberate read-the-line-first instructions with the fallback named, not TBDs — each names the exact file:line to read and what to do with it.
- **Type consistency:** `StreamEmit`/`actionStreamResponse`/`streamingStructuredGenerate` signatures are identical across Tasks 1, 4–12; part vocabulary is defined once (Global Constraints) and used verbatim everywhere; `useActionStream`'s return shape in Task 2 matches every consumer.
- **Risk register:** (a) reasoning parts may not surface through the bundled provider — degradation is silent-by-design, decided at Task 1 Step 5/Task 4 Step 4; (b) `transient: true` persistence on ai@6.0.39 — fallback defined in Task 2; (c) Mastra chunk payload field names — probe steps in Tasks 1 and 12 catch drift before any surface work.
