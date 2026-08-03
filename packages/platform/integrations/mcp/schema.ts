type RemoteToolSchema = {
  name: string;
  inputSchema?: unknown;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export class RemoteMcpSchemaDriftError extends Error {
  readonly code = "REMOTE_SCHEMA_DRIFT";

  constructor(readonly toolName: string, message: string) {
    super(message);
    this.name = "RemoteMcpSchemaDriftError";
  }
}

/** Stable SHA-256 of a remote tool's canonical input schema. */
export async function remoteMcpToolSchemaHash(inputSchema: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(inputSchema ?? {})),
  );
  return Buffer.from(digest).toString("hex");
}

/** Hash exactly the explicitly allowed tools and fail if an allowed tool is absent. */
export async function pinRemoteMcpToolSchemas(tools: readonly RemoteToolSchema[], allowedTools: readonly string[]) {
  const discovered = new Map(tools.map((tool) => [tool.name, tool]));
  const pins: Record<string, string> = {};
  for (const name of [...new Set(allowedTools)].sort()) {
    const tool = discovered.get(name);
    if (!tool) {
      throw new RemoteMcpSchemaDriftError(name, `Allowed remote MCP tool '${name}' is not exposed by the server.`);
    }
    pins[name] = await remoteMcpToolSchemaHash(tool.inputSchema);
  }
  return pins;
}

/**
 * Verify configured schema pins against fresh discovery. Unpinned allowlisted
 * tools remain usable, while any pinned tool must exist with the exact schema.
 */
export async function assertRemoteMcpToolSchemas(
  tools: readonly RemoteToolSchema[],
  pinnedSchemas: Readonly<Record<string, string>>,
) {
  if (Object.keys(pinnedSchemas).length === 0) return;
  const discovered = new Map(tools.map((tool) => [tool.name, tool]));
  for (const [name, expected] of Object.entries(pinnedSchemas)) {
    const tool = discovered.get(name);
    if (!tool) {
      throw new RemoteMcpSchemaDriftError(name, `Pinned remote MCP tool '${name}' is no longer exposed by the server.`);
    }
    const actual = await remoteMcpToolSchemaHash(tool.inputSchema);
    if (actual !== expected) {
      throw new RemoteMcpSchemaDriftError(name, `Pinned input schema changed for remote MCP tool '${name}'.`);
    }
  }
}
