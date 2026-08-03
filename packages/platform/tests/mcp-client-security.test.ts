import assert from "node:assert/strict";
import test from "node:test";
import type { Agent } from "undici";
import {
  createOutboundMcpNetworkPolicy,
  createSafeOutboundMcpFetch,
  OutboundMcpNetworkError,
  validateOutboundMcpUrl,
} from "../integrations/mcp/client";

function expectNetworkError(code: OutboundMcpNetworkError["code"]) {
  return (error: unknown) => error instanceof OutboundMcpNetworkError && error.code === code;
}

function fakeDispatcher() {
  const state = { closed: 0, destroyed: 0, error: null as Error | null };
  const dispatcher = {
    async close() {
      state.closed += 1;
    },
    async destroy(error?: Error) {
      state.destroyed += 1;
      state.error = error ?? null;
    },
  } as unknown as Agent;
  return { dispatcher, state };
}

test("production outbound MCP fails closed without an exact host allowlist", () => {
  assert.throws(
    () => createOutboundMcpNetworkPolicy("https://mcp.example.com", {
      environment: "production",
      allowedHosts: [],
    }),
    expectNetworkError("POLICY_CONFIGURATION"),
  );
});

test("endpoint policy rejects unlisted hosts, credentials, and non-loopback HTTP", () => {
  const policy = createOutboundMcpNetworkPolicy("https://mcp.example.com", {
    environment: "production",
    allowedHosts: ["mcp.example.com", "oauth.example.com"],
  });
  assert.equal(validateOutboundMcpUrl("https://mcp.example.com/api/mcp", policy).hostname, "mcp.example.com");
  assert.equal(validateOutboundMcpUrl("https://oauth.example.com/token", policy).hostname, "oauth.example.com");
  assert.throws(() => validateOutboundMcpUrl("https://other.example.com", policy), expectNetworkError("HOST_NOT_ALLOWED"));
  assert.throws(() => validateOutboundMcpUrl("https://user:secret@mcp.example.com", policy), expectNetworkError("INVALID_ENDPOINT"));
  assert.throws(() => validateOutboundMcpUrl("http://mcp.example.com", policy), expectNetworkError("INVALID_ENDPOINT"));
});

test("development HTTP remains limited to the configured loopback endpoint", () => {
  const policy = createOutboundMcpNetworkPolicy("http://127.0.0.1:3001/api/mcp", {
    environment: "development",
    allowedHosts: [],
  });
  assert.equal(validateOutboundMcpUrl("http://127.0.0.1:3001/api/mcp", policy).port, "3001");
  assert.throws(() => validateOutboundMcpUrl("http://localhost.example/api/mcp", policy), expectNetworkError("INVALID_ENDPOINT"));
});

test("every DNS answer must be public unless the exact private host is approved", async () => {
  const policy = createOutboundMcpNetworkPolicy("https://mcp.example.com", {
    environment: "production",
    allowedHosts: ["mcp.example.com"],
  });
  let fetched = false;
  const safeFetch = createSafeOutboundMcpFetch(policy, {
    resolve: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.12", family: 4 },
    ],
    fetch: async () => {
      fetched = true;
      return new Response("{}");
    },
  });
  await assert.rejects(() => safeFetch("https://mcp.example.com/api/mcp"), expectNetworkError("ADDRESS_NOT_ALLOWED"));
  assert.equal(fetched, false);
});

test("private IPv6 and IPv4-mapped IPv6 answers are rejected", async (t) => {
  const policy = createOutboundMcpNetworkPolicy("https://mcp.example.com", {
    environment: "production",
    allowedHosts: ["mcp.example.com"],
  });
  for (const address of ["::1", "fd00::25", "fe80::1", "::ffff:7f00:1"]) {
    await t.test(address, async () => {
      const safeFetch = createSafeOutboundMcpFetch(policy, {
        resolve: async () => [{ address, family: 6 }],
      });
      await assert.rejects(
        () => safeFetch("https://mcp.example.com/api/mcp"),
        expectNetworkError("ADDRESS_NOT_ALLOWED"),
      );
    });
  }
});

test("an explicitly approved private host is DNS-pinned before fetch", async () => {
  const policy = createOutboundMcpNetworkPolicy("https://internal.example.test", {
    environment: "production",
    allowedHosts: ["internal.example.test"],
    privateHosts: ["internal.example.test"],
  });
  const { dispatcher, state } = fakeDispatcher();
  let pinned: unknown;
  let receivedInit: (RequestInit & { dispatcher?: Agent }) | undefined;
  const safeFetch = createSafeOutboundMcpFetch(policy, {
    resolve: async () => [{ address: "10.10.4.8", family: 4 }],
    createDispatcher(hostname, addresses) {
      pinned = { hostname, addresses };
      return dispatcher;
    },
    fetch: async (_url, init) => {
      receivedInit = init;
      return new Response('{"ok":true}', {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const response = await safeFetch("https://internal.example.test/api/mcp");
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(pinned, {
    hostname: "internal.example.test",
    addresses: [{ address: "10.10.4.8", family: 4 }],
  });
  assert.equal(receivedInit?.redirect, "manual");
  assert.equal(receivedInit?.dispatcher, dispatcher);
  assert.equal(state.closed, 1);
  assert.equal(state.destroyed, 0);
});

test("redirect responses are rejected instead of followed", async () => {
  const policy = createOutboundMcpNetworkPolicy("https://93.184.216.34", {
    environment: "production",
    allowedHosts: ["93.184.216.34"],
  });
  const { dispatcher, state } = fakeDispatcher();
  const safeFetch = createSafeOutboundMcpFetch(policy, {
    createDispatcher: () => dispatcher,
    fetch: async () => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/latest/meta-data" },
    }),
  });
  await assert.rejects(() => safeFetch("https://93.184.216.34/api/mcp"), expectNetworkError("REDIRECT_NOT_ALLOWED"));
  assert.equal(state.destroyed, 1);
});

test("declared and streaming response sizes are both bounded", async (t) => {
  const policy = createOutboundMcpNetworkPolicy("https://93.184.216.34", {
    environment: "production",
    allowedHosts: ["93.184.216.34"],
    maxResponseBytes: 1_024,
  });

  await t.test("declared size", async () => {
    const { dispatcher } = fakeDispatcher();
    const safeFetch = createSafeOutboundMcpFetch(policy, {
      createDispatcher: () => dispatcher,
      fetch: async () => new Response("small", { headers: { "content-length": "1025" } }),
    });
    await assert.rejects(() => safeFetch("https://93.184.216.34/api/mcp"), expectNetworkError("RESPONSE_TOO_LARGE"));
  });

  await t.test("streamed size", async () => {
    const { dispatcher } = fakeDispatcher();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700));
        controller.enqueue(new Uint8Array(700));
        controller.close();
      },
    });
    const safeFetch = createSafeOutboundMcpFetch(policy, {
      createDispatcher: () => dispatcher,
      fetch: async () => new Response(body),
    });
    const response = await safeFetch("https://93.184.216.34/api/mcp");
    await assert.rejects(() => response.arrayBuffer(), expectNetworkError("RESPONSE_TOO_LARGE"));
  });
});

test("DNS resolution is covered by the outbound request timeout", async () => {
  const policy = createOutboundMcpNetworkPolicy("https://mcp.example.com", {
    environment: "production",
    allowedHosts: ["mcp.example.com"],
    timeoutMs: 250,
  });
  const safeFetch = createSafeOutboundMcpFetch(policy, {
    resolve: async () => new Promise(() => {}),
  });
  await assert.rejects(() => safeFetch("https://mcp.example.com/api/mcp"), expectNetworkError("REQUEST_TIMEOUT"));
});

test("a never-ending response stream is covered by the outbound request timeout", async () => {
  const policy = createOutboundMcpNetworkPolicy("https://93.184.216.34", {
    environment: "production",
    allowedHosts: ["93.184.216.34"],
    timeoutMs: 250,
  });
  const { dispatcher } = fakeDispatcher();
  const safeFetch = createSafeOutboundMcpFetch(policy, {
    createDispatcher: () => dispatcher,
    fetch: async (_url, init) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
      },
    })),
  });
  const response = await safeFetch("https://93.184.216.34/api/mcp");
  await assert.rejects(() => response.arrayBuffer(), expectNetworkError("REQUEST_TIMEOUT"));
});
