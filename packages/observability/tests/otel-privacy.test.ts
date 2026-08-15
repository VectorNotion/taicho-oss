import assert from "node:assert/strict";
import test from "node:test";
import {
  SpanKind,
  SpanStatusCode,
  type Attributes,
} from "@opentelemetry/api";
import type {
  ReadableSpan,
  SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  PrivacySafeSpanExporter,
  WorkflowFocusedSpanExporter,
  privacySafeReadableSpan,
} from "../otel-privacy";

function span(attributes: Attributes): ReadableSpan {
  return {
    name: "SELECT customer@example.com?token=private",
    kind: SpanKind.SERVER,
    spanContext: () => ({
      traceId: "1".repeat(32),
      spanId: "2".repeat(16),
      traceFlags: 1,
    }),
    startTime: [1, 0],
    endTime: [2, 0],
    status: {
      code: SpanStatusCode.ERROR,
      message: "customer@example.com failed with password=private",
    },
    attributes: {
      ...attributes,
      "http.request.method": "GET",
      "http.response.status_code": 500,
      "http.route": "/customers/:id?email=customer@example.com",
      "url.full": "https://example.com/customers?email=customer@example.com",
      "db.query.text": "SELECT * FROM customer WHERE email='customer@example.com'",
      "exception.message": "customer@example.com failed",
      "ai.prompt": "customer@example.com private prompt",
      "taicho.execution.id": "execution-1",
    },
    links: [],
    events: [{
      name: "exception",
      time: [1, 1],
      attributes: {
        "exception.type": "Error",
        "exception.message": "customer@example.com failed",
      },
    }],
    duration: [1, 0],
    ended: true,
    resource: resourceFromAttributes({
      "service.name": "taicho-test",
      "service.version": "1.2.3",
      "deployment.environment.name": "test",
      "process.command_args": '["node","--eval","private source code"]',
      "process.owner": "private-user",
      "host.name": "private-host",
      "host.arch": "arm64",
    }),
    instrumentationScope: { name: "test" },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

test("OTel export filtering removes automatic payload and error attributes", () => {
  const safe = privacySafeReadableSpan(span({
    prospect_id: "prospect-private",
    "cascade.contact.id": "contact-private",
    "job.id": "job-1",
    "llm.model_name": "google/gemini-3.6-flash",
    "llm.token_count.prompt": 321,
    "llm.input_messages": "must-not-survive",
  }));
  assert.equal(safe.name, "GET /customers/:id");
  assert.deepEqual(safe.status, { code: SpanStatusCode.ERROR });
  assert.equal(safe.attributes["http.response.status_code"], 500);
  assert.equal(safe.attributes["taicho.execution.id"], "execution-1");
  assert.match(safe.attributes.prospect_id as string, /^entity_/);
  assert.match(safe.attributes["cascade.contact.id"] as string, /^entity_/);
  assert.equal(safe.attributes["job.id"], "job-1");
  assert.equal(safe.attributes["llm.model_name"], "google/gemini-3.6-flash");
  assert.equal(safe.attributes["llm.token_count.prompt"], 321);
  assert.equal(safe.attributes["llm.input_messages"], undefined);
  assert.equal(safe.attributes["url.full"], undefined);
  assert.equal(safe.attributes["db.query.text"], undefined);
  assert.equal(safe.attributes["exception.message"], undefined);
  assert.equal(safe.attributes["ai.prompt"], undefined);
  assert.deepEqual(safe.events[0].attributes, { "exception.type": "Error" });
  assert.doesNotMatch(JSON.stringify(safe), /customer@example|password=|SELECT \*/);
  assert.doesNotMatch(JSON.stringify(safe), /prospect-private|contact-private/);
  assert.deepEqual(safe.resource.attributes, {
    "service.name": "taicho-test",
    "service.version": "1.2.3",
    "deployment.environment.name": "test",
  });
});

test("privacy exporter always sanitizes before delegating", async () => {
  let exported: ReadableSpan[] = [];
  const delegate: SpanExporter = {
    export(spans, callback) {
      exported = spans;
      callback({ code: 0 });
    },
    async shutdown() {},
  };
  const exporter = new PrivacySafeSpanExporter(delegate);
  await new Promise<void>((resolve, reject) => {
    exporter.export([span({})], (result) => {
      if (result.code === 0) resolve();
      else reject(new Error("export failed"));
    });
  });
  assert.equal(exported.length, 1);
  assert.doesNotMatch(JSON.stringify(exported[0]), /customer@example|password=|SELECT \*/);
});

test("workflow exporter removes infrastructure noise before OTLP export", async () => {
  let exported: ReadableSpan[] = [];
  const delegate: SpanExporter = {
    export(spans, callback) {
      exported = spans;
      callback({ code: 0 });
    },
    async shutdown() {},
  };
  const exporter = new WorkflowFocusedSpanExporter(delegate);
  await new Promise<void>((resolve, reject) => {
    exporter.export([
      span({ "http.request.method": "POST" }),
      span({ "db.operation.name": "GRAPH.QUERY" }),
      span({ "taicho.trace.category": "workflow", "taicho.workflow.span_kind": "generation" }),
    ], (result) => {
      if (result.code === 0) resolve();
      else reject(new Error("export failed"));
    });
  });
  assert.equal(exported.length, 1);
  assert.equal(exported[0].attributes["taicho.trace.category"], "workflow");
});

test("workflow content is visible but secrets and email addresses remain redacted", () => {
  const safe = privacySafeReadableSpan(span({
    "taicho.trace.category": "workflow",
    "openinference.span.kind": "CHAIN",
    "input.mime_type": "application/json",
    "input.value": JSON.stringify({
      query: "Daniel Kim Harbor Logistics",
      email: "customer@example.com",
      authorization: "Bearer private-token",
      nested: { password: "private", evidence: "Useful public evidence" },
    }),
  }));
  const content = safe.attributes["input.value"] as string;
  assert.match(content, /Daniel Kim Harbor Logistics/);
  assert.match(content, /Useful public evidence/);
  assert.doesNotMatch(content, /customer@example|private-token|"private"/);
  assert.equal(safe.attributes["openinference.span.kind"], "CHAIN");
});
