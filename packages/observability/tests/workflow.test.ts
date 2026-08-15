import assert from "node:assert/strict";
import test from "node:test";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  observeWorkflow,
  observeWorkflowStep,
  serializeWorkflowContent,
  traceable,
} from "../workflow";

test("workflow content keeps useful AI input and output while redacting credentials", () => {
  const content = serializeWorkflowContent({
    subject: { name: "Daniel Kim", company: "Harbor Logistics" },
    query: "Daniel Kim Harbor Logistics recent initiatives",
    evidence: [{ title: "Harbor expands", url: "https://example.com/news" }],
    authorization: "Bearer do-not-export",
    nested: { apiKey: "also-private", result: "Useful synthesis" },
  });

  assert.equal(content.truncated, false);
  assert.match(content.value ?? "", /Daniel Kim/);
  assert.match(content.value ?? "", /recent initiatives/);
  assert.match(content.value ?? "", /Useful synthesis/);
  assert.doesNotMatch(content.value ?? "", /do-not-export|also-private/);
  assert.match(content.value ?? "", /\[REDACTED\]/);
});

test("oversized workflow content is capped and identifies the complete value", () => {
  const content = serializeWorkflowContent({ evidence: Array.from({ length: 64 }, () => "x".repeat(2_000)) });
  assert.equal(content.truncated, true);
  assert.ok((content.value?.length ?? 0) <= 64 * 1024);
  assert.match(content.value ?? "", /TRUNCATED sha256=/);
  assert.equal(content.digest.length, 64);
});

test("workflow tracing creates a clean chronological waterfall with readable content", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(provider);
  process.env.OBSERVABILITY_WORKFLOW_CONTENT = "full";

  await observeWorkflow("research.person", {
    kind: "workflow",
    input: { subject: "Daniel Kim", objective: "Assess fit" },
  }, async () => {
    const evidence = await Promise.all([
      observeWorkflowStep("research.search.authority", {
        kind: "tool",
        input: { query: "Daniel Kim Harbor Logistics authority" },
      }, async () => ({ results: [{ title: "Leadership", url: "https://example.com/leadership" }] })),
      observeWorkflowStep("research.search.ownership", {
        kind: "tool",
        input: { query: "Daniel Kim Harbor Logistics ownership" },
      }, async () => ({ results: [{ title: "Interview", url: "https://example.com/interview" }] })),
    ]);
    return observeWorkflowStep("research.synthesis", {
      kind: "generation",
      input: { evidence },
    }, async () => ({ personaScore: 82, explanation: "Strong authority and ownership evidence." }));
  });
  await provider.forceFlush();

  const spans = exporter.getFinishedSpans();
  assert.deepEqual(
    spans.map((span) => span.name).sort(),
    [
      "research.person",
      "research.search.authority",
      "research.search.ownership",
      "research.synthesis",
    ].sort(),
  );
  const root = spans.find((span) => span.name === "research.person");
  assert.ok(root);
  assert.equal(root.parentSpanContext, undefined);
  assert.match(root.attributes["input.value"] as string, /Daniel Kim/);
  assert.match(root.attributes["output.value"] as string, /personaScore/);
  assert.equal(root.attributes["openinference.span.kind"], "CHAIN");
  for (const child of spans.filter((span) => span !== root)) {
    assert.equal(child.parentSpanContext?.spanId, root.spanContext().spanId);
    assert.equal(child.attributes["taicho.trace.category"], "workflow");
  }

  delete process.env.OBSERVABILITY_WORKFLOW_CONTENT;
  await provider.shutdown();
  trace.disable();
  context.disable();
});

test("traceable automatically captures processed function inputs, outputs, and nesting", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(provider);
  process.env.OBSERVABILITY_WORKFLOW_CONTENT = "full";

  const loadContext = traceable(
    async (accountId: string, _credentials: { token: string }) => ({
      account: { id: accountId, name: "Northstar AI" },
      observations: [{ dimensionKey: "industry", observedValue: "AI software" }],
    }),
    {
      name: "research.account.load_context",
      kind: "data",
      processInputs: ([accountId]) => ({ accountId, source: "falkordb" }),
      processOutputs: (output) => ({ ...output, logicalRecords: 2 }),
    },
  );
  const research = traceable(
    async (accountId: string) => loadContext(accountId, { token: "must-not-appear" }),
    {
      name: "research.account",
      kind: "workflow",
      attributes: {
        "llm.model_name": "google/gemini-3.6-flash",
        "llm.token_count.prompt": 321,
        "llm.input_messages": "must-not-appear",
      },
    },
  );

  const result = await research("account-1");
  assert.equal(result.account.name, "Northstar AI");
  await provider.forceFlush();

  const spans = exporter.getFinishedSpans();
  const root = spans.find((span) => span.name === "research.account");
  const load = spans.find((span) => span.name === "research.account.load_context");
  assert.ok(root);
  assert.ok(load);
  assert.equal(root.attributes["llm.model_name"], "google/gemini-3.6-flash");
  assert.equal(root.attributes["llm.token_count.prompt"], 321);
  assert.equal(root.attributes["llm.input_messages"], undefined);
  assert.equal(load.parentSpanContext?.spanId, root.spanContext().spanId);
  assert.equal(load.attributes["taicho.workflow.span_kind"], "data");
  assert.match(load.attributes["input.value"] as string, /falkordb/);
  assert.match(load.attributes["output.value"] as string, /logicalRecords/);
  assert.doesNotMatch(load.attributes["input.value"] as string, /must-not-appear/);
  assert.equal(load.attributes["openinference.span.kind"], "RETRIEVER");

  delete process.env.OBSERVABILITY_WORKFLOW_CONTENT;
  await provider.shutdown();
  trace.disable();
  context.disable();
});
