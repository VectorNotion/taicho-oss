import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { LookupFunction } from "node:net";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Agent, fetch as undiciFetch } from "undici";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

const conditionallyPrivateAddresses = new BlockList();
for (const [network, prefix] of [
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
] as const) {
  conditionallyPrivateAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
] as const) {
  conditionallyPrivateAddresses.addSubnet(network, prefix, "ipv6");
}

const neverRoutableAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  neverRoutableAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["ff00::", 8],
] as const) {
  neverRoutableAddresses.addSubnet(network, prefix, "ipv6");
}

type ResolvedAddress = { address: string; family: 4 | 6 };
type AddressResolver = (hostname: string) => Promise<ResolvedAddress[]>;
type DispatcherFetch = (
  input: string | URL,
  init?: RequestInit & { dispatcher?: Agent },
) => Promise<Response>;

export class OutboundMcpNetworkError extends Error {
  constructor(
    readonly code:
      | "INVALID_ENDPOINT"
      | "POLICY_CONFIGURATION"
      | "HOST_NOT_ALLOWED"
      | "ADDRESS_NOT_ALLOWED"
      | "REDIRECT_NOT_ALLOWED"
      | "RESPONSE_TOO_LARGE"
      | "REQUEST_TIMEOUT",
    message: string,
  ) {
    super(message);
    this.name = "OutboundMcpNetworkError";
  }
}

export type OutboundMcpNetworkPolicy = {
  production: boolean;
  allowedHosts: ReadonlySet<string>;
  privateHosts: ReadonlySet<string>;
  timeoutMs: number;
  maxResponseBytes: number;
};

export type OutboundMcpNetworkPolicyOptions = {
  environment?: string;
  allowedHosts?: readonly string[];
  privateHosts?: readonly string[];
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export type SafeOutboundMcpFetchDependencies = {
  resolve?: AddressResolver;
  fetch?: DispatcherFetch;
  createDispatcher?: (hostname: string, addresses: ResolvedAddress[]) => Agent;
};

export type RemoteMcpClientOptions = {
  url: string | URL;
  name?: string;
  version?: string;
  headers?: HeadersInit;
  authProvider?: OAuthClientProvider;
};

export type ConnectedRemoteMcpClient = {
  client: Client;
  close(): Promise<void>;
};

function normalizedHostname(value: string) {
  const withoutBrackets = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return withoutBrackets.replace(/\.$/, "").toLowerCase();
}

function configuredHosts(values: readonly string[], variable: string) {
  const hosts = new Set<string>();
  for (const rawValue of values) {
    const raw = rawValue.trim();
    if (!raw) continue;
    const host = normalizedHostname(raw);
    const validName = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host);
    if (!validName && isIP(host) === 0) {
      throw new OutboundMcpNetworkError(
        "POLICY_CONFIGURATION",
        `${variable} must contain exact hostnames or IP addresses without schemes, paths, ports, or wildcards.`,
      );
    }
    hosts.add(host);
  }
  return hosts;
}

function environmentList(name: string) {
  return (process.env[name] ?? "").split(",");
}

function boundedInteger(name: string, configured: number | undefined, fallback: number, minimum: number, maximum: number) {
  const raw = configured ?? (process.env[name] ? Number(process.env[name]) : fallback);
  if (!Number.isSafeInteger(raw) || raw < minimum || raw > maximum) {
    throw new OutboundMcpNetworkError(
      "POLICY_CONFIGURATION",
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return raw;
}

/**
 * Create the fail-closed network policy shared by MCP transport, OAuth discovery,
 * token exchange, discovery, and tool calls.
 */
export function createOutboundMcpNetworkPolicy(
  initialUrl: string | URL,
  options: OutboundMcpNetworkPolicyOptions = {},
): OutboundMcpNetworkPolicy {
  const initial = new URL(initialUrl);
  const production = (options.environment ?? process.env.NODE_ENV) === "production";
  const configuredAllowed = options.allowedHosts ?? environmentList("MCP_OUTBOUND_ALLOWED_HOSTS");
  const allowedHosts = configuredHosts(configuredAllowed, "MCP_OUTBOUND_ALLOWED_HOSTS");
  if (production && allowedHosts.size === 0) {
    throw new OutboundMcpNetworkError(
      "POLICY_CONFIGURATION",
      "MCP_OUTBOUND_ALLOWED_HOSTS is required and must not be empty in production.",
    );
  }
  if (!production && allowedHosts.size === 0) {
    allowedHosts.add(normalizedHostname(initial.hostname));
  }
  const privateHosts = configuredHosts(
    options.privateHosts ?? environmentList("MCP_OUTBOUND_PRIVATE_HOSTS"),
    "MCP_OUTBOUND_PRIVATE_HOSTS",
  );
  for (const host of privateHosts) {
    if (!allowedHosts.has(host)) {
      throw new OutboundMcpNetworkError(
        "POLICY_CONFIGURATION",
        "Every MCP_OUTBOUND_PRIVATE_HOSTS entry must also be present in MCP_OUTBOUND_ALLOWED_HOSTS.",
      );
    }
  }
  return {
    production,
    allowedHosts,
    privateHosts,
    timeoutMs: boundedInteger("MCP_OUTBOUND_TIMEOUT_MS", options.timeoutMs, DEFAULT_TIMEOUT_MS, 250, 300_000),
    maxResponseBytes: boundedInteger(
      "MCP_OUTBOUND_MAX_RESPONSE_BYTES",
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      1_024,
      100 * 1024 * 1024,
    ),
  };
}

/** Validate endpoint syntax, scheme, credentials, and exact host allowlisting. */
export function validateOutboundMcpUrl(value: string | URL, policy: OutboundMcpNetworkPolicy) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OutboundMcpNetworkError("INVALID_ENDPOINT", "The outbound MCP endpoint is not a valid URL.");
  }
  const hostname = normalizedHostname(url.hostname);
  const localDevelopmentHttp =
    !policy.production &&
    url.protocol === "http:" &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1");
  if (url.protocol !== "https:" && !localDevelopmentHttp) {
    throw new OutboundMcpNetworkError(
      "INVALID_ENDPOINT",
      "Outbound MCP endpoints must use HTTPS; HTTP is permitted only for loopback development.",
    );
  }
  if (url.username || url.password) {
    throw new OutboundMcpNetworkError("INVALID_ENDPOINT", "Credentials are not allowed in an outbound MCP URL.");
  }
  if (!policy.allowedHosts.has(hostname)) {
    throw new OutboundMcpNetworkError(
      "HOST_NOT_ALLOWED",
      `Outbound MCP host '${hostname}' is not explicitly allowed.`,
    );
  }
  return url;
}

function addressKind(address: ResolvedAddress) {
  const family = address.family === 4 ? "ipv4" : "ipv6";
  // BlockList maps IPv4 checks into this prefix, so handle IPv4-mapped IPv6
  // text explicitly rather than registering the prefix in the shared list.
  if (address.family === 6 && address.address.toLowerCase().startsWith("::ffff:")) return "never" as const;
  if (neverRoutableAddresses.check(address.address, family)) return "never" as const;
  if (conditionallyPrivateAddresses.check(address.address, family)) return "private" as const;
  return "public" as const;
}

async function defaultResolver(hostname: string): Promise<ResolvedAddress[]> {
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    return [{ address: hostname, family: literalFamily }];
  }
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => {
    if (family !== 4 && family !== 6) throw new Error(`DNS returned unsupported address family ${family}.`);
    return { address, family };
  });
}

function pinnedDispatcher(expectedHostname: string, addresses: ResolvedAddress[]) {
  const lookup: LookupFunction = (hostname, options, callback) => {
    if (normalizedHostname(hostname) !== expectedHostname) {
      const error = Object.assign(new Error("The pinned MCP dispatcher refused an unexpected hostname."), {
        code: "EAI_FAIL",
      });
      callback(error, "", 0);
      return;
    }
    const family = typeof options.family === "number" ? options.family : 0;
    const candidates = family === 4 || family === 6
      ? addresses.filter((address) => address.family === family)
      : addresses;
    if (candidates.length === 0) {
      const error = Object.assign(new Error("The MCP host has no address for the requested network family."), {
        code: "EAI_ADDRFAMILY",
      });
      callback(error, "", 0);
      return;
    }
    if (options.all) callback(null, candidates);
    else callback(null, candidates[0].address, candidates[0].family);
  };
  return new Agent({ connect: { lookup } });
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new Error("The outbound MCP request was aborted.");
}

async function abortableResolution(hostname: string, signal: AbortSignal, resolve: AddressResolver) {
  if (signal.aborted) throw abortReason(signal);
  return new Promise<ResolvedAddress[]>((resolveResult, reject) => {
    const aborted = () => reject(abortReason(signal));
    signal.addEventListener("abort", aborted, { once: true });
    resolve(hostname).then(
      (addresses) => {
        signal.removeEventListener("abort", aborted);
        resolveResult(addresses);
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

function boundedResponse(
  response: Response,
  maxBytes: number,
  finish: (error?: Error) => void,
) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > maxBytes) {
    const error = new OutboundMcpNetworkError(
      "RESPONSE_TOO_LARGE",
      `The outbound MCP response exceeds the ${maxBytes}-byte limit.`,
    );
    void response.body?.cancel(error);
    finish(error);
    throw error;
  }
  if (!response.body) {
    finish();
    return response;
  }

  const reader = response.body.getReader();
  let received = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          finish();
          return;
        }
        received += value.byteLength;
        if (received > maxBytes) {
          const error = new OutboundMcpNetworkError(
            "RESPONSE_TOO_LARGE",
            `The outbound MCP response exceeds the ${maxBytes}-byte limit.`,
          );
          await reader.cancel(error);
          controller.error(error);
          finish(error);
          return;
        }
        controller.enqueue(value);
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        controller.error(error);
        finish(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        finish();
      }
    },
  });
  const bounded = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  Object.defineProperties(bounded, {
    url: { value: response.url, enumerable: true },
    redirected: { value: response.redirected, enumerable: true },
    type: { value: response.type, enumerable: true },
  });
  return bounded;
}

/**
 * Fetch implementation for the official MCP SDK. Every URL—including OAuth
 * metadata/token URLs—is revalidated and resolved, then connected through a
 * DNS-pinned dispatcher to prevent time-of-check/time-of-use rebinding.
 */
export function createSafeOutboundMcpFetch(
  policy: OutboundMcpNetworkPolicy,
  dependencies: SafeOutboundMcpFetchDependencies = {},
): FetchLike {
  const resolve = dependencies.resolve ?? defaultResolver;
  const baseFetch: DispatcherFetch = dependencies.fetch ?? ((input, init) =>
    undiciFetch(input, init as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>);
  const createDispatcher = dependencies.createDispatcher ?? pinnedDispatcher;

  return async (input, init = {}) => {
    const url = validateOutboundMcpUrl(input, policy);
    const hostname = normalizedHostname(url.hostname);
    const controller = new AbortController();
    const timeoutError = new OutboundMcpNetworkError(
      "REQUEST_TIMEOUT",
      `The outbound MCP request exceeded ${policy.timeoutMs} ms.`,
    );
    const timeout = setTimeout(() => controller.abort(timeoutError), policy.timeoutMs);
    timeout.unref?.();
    const inputSignal = init.signal;
    const forwardAbort = () => controller.abort(inputSignal ? abortReason(inputSignal) : undefined);
    if (inputSignal?.aborted) forwardAbort();
    else inputSignal?.addEventListener("abort", forwardAbort, { once: true });

    let dispatcher: Agent | undefined;
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      inputSignal?.removeEventListener("abort", forwardAbort);
      if (dispatcher) {
        if (error) void dispatcher.destroy(error);
        else void dispatcher.close();
      }
    };

    try {
      const addresses = await abortableResolution(hostname, controller.signal, resolve);
      if (addresses.length === 0) {
        throw new OutboundMcpNetworkError("ADDRESS_NOT_ALLOWED", `Outbound MCP host '${hostname}' did not resolve.`);
      }
      for (const address of addresses) {
        if (isIP(address.address) !== address.family) {
          throw new OutboundMcpNetworkError(
            "ADDRESS_NOT_ALLOWED",
            `Outbound MCP host '${hostname}' returned an invalid DNS address.`,
          );
        }
        const kind = addressKind(address);
        if (kind === "never" || (kind === "private" && policy.production && !policy.privateHosts.has(hostname))) {
          throw new OutboundMcpNetworkError(
            "ADDRESS_NOT_ALLOWED",
            `Outbound MCP host '${hostname}' resolves to a disallowed ${kind === "private" ? "private" : "non-routable"} address.`,
          );
        }
      }
      dispatcher = createDispatcher(hostname, addresses);
      const response = await baseFetch(url, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
        dispatcher,
      });
      if (response.status >= 300 && response.status < 400) {
        const error = new OutboundMcpNetworkError(
          "REDIRECT_NOT_ALLOWED",
          "Outbound MCP redirects are rejected; register the final endpoint and OAuth issuer hosts explicitly.",
        );
        void response.body?.cancel(error);
        finish(error);
        throw error;
      }
      return boundedResponse(response, policy.maxResponseBytes, finish);
    } catch (cause) {
      const error = controller.signal.aborted
        ? abortReason(controller.signal)
        : cause instanceof Error ? cause : new Error(String(cause));
      finish(error);
      throw error;
    }
  };
}

/** Connect and complete MCP initialization/capability negotiation. */
export async function connectRemoteMcp(options: RemoteMcpClientOptions): Promise<ConnectedRemoteMcpClient> {
  const url = new URL(options.url);
  const networkPolicy = createOutboundMcpNetworkPolicy(url);
  validateOutboundMcpUrl(url, networkPolicy);
  const client = new Client({ name: options.name ?? "vector-notion-outbound", version: options.version ?? "0.1.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    authProvider: options.authProvider,
    requestInit: options.headers ? { headers: options.headers } : undefined,
    fetch: createSafeOutboundMcpFetch(networkPolicy),
  });
  await client.connect(transport);
  return {
    client,
    async close() {
      await client.close();
    },
  };
}

export function structuredToolContent(result: CallToolResult): Record<string, unknown> {
  if (result.isError) {
    const message = result.content.find((part) => part.type === "text")?.text ?? "The remote MCP tool failed.";
    const error = new Error(message) as Error & { code?: string };
    error.code = "REMOTE_TOOL_ERROR";
    throw error;
  }
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent as Record<string, unknown>;
  }
  const text = result.content.find((part) => part.type === "text")?.text;
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : { result: parsed };
  } catch {
    return { text };
  }
}

export async function callRemoteMcpTool(
  options: RemoteMcpClientOptions,
  name: string,
  args: Record<string, unknown>,
) {
  const connection = await connectRemoteMcp(options);
  try {
    const available = await connection.client.listTools();
    if (!available.tools.some((tool) => tool.name === name)) {
      throw new Error(`Remote MCP server does not expose tool '${name}'.`);
    }
    return structuredToolContent(await connection.client.callTool({ name, arguments: args }) as CallToolResult);
  } finally {
    await connection.close();
  }
}

/** Run multiple calls in one negotiated session (needed by tenant-selecting servers). */
export async function withRemoteMcp<T>(
  options: RemoteMcpClientOptions,
  run: (client: Client) => Promise<T>,
) {
  const connection = await connectRemoteMcp(options);
  try {
    return await run(connection.client);
  } finally {
    await connection.close();
  }
}
