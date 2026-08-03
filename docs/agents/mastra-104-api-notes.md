# Mastra 1.0.4 — verified API notes (from installed .d.ts, 2026-07-20)

> **Status note (2026-07-21):** the Mastra API notes below still hold (repo is on
> `@mastra/core@1.0.4`), but the **model router changed to OpenRouter**. Ignore the
> `anthropic/<model-id>` / `ANTHROPIC_API_KEY` guidance here — models now resolve
> through `packages/platform/agents/model.ts` (`routerModel()` → `openrouter/` +
> `MODEL_NAME`, default `qwen/qwen3.7-plus`), keyed by `OPENROUTER_API_KEY`.

Ground truth for implementers. The AI SDK layer is v5 (`ai@6`): use `generate`/`stream` (NOT `generateLegacy`); the token knob is `maxOutputTokens` (NOT `maxTokens`).

## Workflows (`@mastra/core/workflows`)

```ts
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";

const stepA = createStep({
  id: "extract",
  inputSchema: z.object({ projectId: z.string() }),
  outputSchema: z.object({ entities: z.array(z.object({ name: z.string(), type: z.string() })) }),
  // ONE destructured params object (steps differ from tools!):
  execute: async ({ inputData, mastra, writer }) => {
    const agent = mastra.getAgent("chatAgent"); // agents registered on the instance are reachable
    // ... return value must satisfy outputSchema
    return { entities: [] };
  },
});

export const myWorkflow = createWorkflow({
  id: "build-project-graph",
  inputSchema: z.object({ projectId: z.string() }),
  outputSchema: z.object({ entityCount: z.number() }),
})
  .then(stepA)
  // .parallel([...]) .branch([[cond, step]]) .foreach(step, { concurrency }) .map(fn)
  .commit(); // MANDATORY — uncommitted workflows won't run
```

Run from plain Node (worker or route — no HTTP layer):
```ts
const wf = mastra.getWorkflow("myWorkflow");     // key in the Mastra({ workflows }) record
const run = await wf.createRun();                 // ASYNC in 1.0.4 (older docs show sync — wrong)
const result = await run.start({ inputData: { projectId } });  // object param, not positional
if (result.status === "success") result.result;   // typed TOutput
if (result.status === "failed") result.error;
// 'suspended' → run.resume({ step, resumeData }); suspended persistence needs storage wired.
```

## Structured output (replaces ALL regex-JSON parsing)

```ts
const out = await agent.generate(prompt, {
  structuredOutput: {
    schema: z.object({ ideas: z.array(z.object({ title: z.string() })) }),
    // model: "anthropic/claude-3-5-haiku-20241022",  // optional separate structuring model
    // errorStrategy: "strict" | "warn" | "fallback",
    // jsonPromptInjection: true,  // only if a model/route lacks native response_format
  },
  modelSettings: { temperature: 0.3, maxOutputTokens: 4096 },
});
out.object; // typed + validated
```
`experimental_output`/`output` options belong to the LEGACY methods only — do not use.
Works with the repo's `"anthropic/<model-id>"` router strings (dated ids pass through; `ANTHROPIC_API_KEY` required).

## Memory + Postgres (the two-line fix)

`PostgresStore` on the Mastra instance auto-injects into any agent Memory that has no own storage (verified in dist):
```ts
import { PostgresStore } from "@mastra/pg";
export const contentMastra = new Mastra({
  agents: { chatAgent },
  storage: new PostgresStore({ id: "app", connectionString: process.env.DATABASE_URL! }),
  observability: …, // unchanged
});
```
- Config union requires `id`; variants: `{connectionString}`, `{host,port,database,user,password}`, or `{pool}` (reuse an existing pg.Pool).
- Auto-creates `mastra_threads`, `mastra_messages`, `mastra_resources`, `mastra_workflow_snapshot`, … on first use (`disableInit: true` to opt out).
- Memory config shape is `{ storage?, options: { lastMessages, generateTitle, … }, vector?, embedder? }` — options NESTED, storage top-level sibling.
- Thread CRUD (getThreadById/listThreads/saveThread/updateThread/deleteThread) works once storage exists; pass `{ memory: { thread, resource } }` on generate.

## Tools vs steps — different signatures

- Tools (`createTool`): `execute(inputData, context)` — context has `mastra?`, `writer?` (`writer.custom({type:'data-…'})`), `requestContext?`. The repo's existing tools already match.
- Workflow steps: ONE destructured params object (see above). Don't mix.

## Worker-process gotchas

- Run workers via `tsx`. content-generator package is CJS (no `"type":"module"`) — use `async function main()` wrappers, no top-level await (this exact bug was commit 1316846).
- `PinoLogger` does NOT exist here (`@mastra/loggers` not installed): use `ConsoleLogger` from `@mastra/core/logger` or omit.
- Long-lived processes: flush observability on SIGINT/SIGTERM (Langfuse exporter buffers).
- Env for the model router: `ANTHROPIC_API_KEY`. `MODEL_NAME` remains the default model id source.
