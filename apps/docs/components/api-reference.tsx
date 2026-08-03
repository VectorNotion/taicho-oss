"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Braces,
  Check,
  ChevronDown,
  Copy,
  KeyRound,
  Search,
} from "lucide-react";

const methods = ["get", "post", "put", "patch", "delete"] as const;
type HttpMethod = (typeof methods)[number];

interface OpenApiSchema {
  $ref?: string;
  allOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  default?: unknown;
  description?: string;
  enum?: unknown[];
  example?: unknown;
  format?: string;
  items?: OpenApiSchema;
  nullable?: boolean;
  oneOf?: OpenApiSchema[];
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  type?: string | string[];
}

interface OpenApiParameter {
  description?: string;
  in: string;
  name: string;
  required?: boolean;
  schema?: OpenApiSchema;
}

interface OpenApiMediaType {
  example?: unknown;
  schema?: OpenApiSchema;
}

interface OpenApiOperation {
  description?: string;
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, OpenApiMediaType>;
    required?: boolean;
  };
  responses?: Record<
    string,
    {
      $ref?: string;
      content?: Record<string, OpenApiMediaType>;
      description?: string;
    }
  >;
  security?: Array<Record<string, string[]>>;
  summary?: string;
  tags?: string[];
}

interface OpenApiDocument {
  components?: {
    schemas?: Record<string, OpenApiSchema>;
  };
  info: {
    description?: string;
    title: string;
    version: string;
  };
  openapi: string;
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>;
  servers?: Array<{ url: string }>;
}

interface ApiOperation extends OpenApiOperation {
  id: string;
  method: HttpMethod;
  path: string;
  tag: string;
}

interface SchemaField {
  description: string;
  name: string;
  required: boolean;
  type: string;
}

const methodStyles: Record<HttpMethod, string> = {
  get: "border-sky-400/35 bg-sky-400/10 text-sky-300",
  post: "border-emerald-400/35 bg-emerald-400/10 text-emerald-300",
  put: "border-amber-400/35 bg-amber-400/10 text-amber-300",
  patch: "border-violet-400/35 bg-violet-400/10 text-violet-300",
  delete: "border-rose-400/35 bg-rose-400/10 text-rose-300",
};

function resolveSchema(
  schema: OpenApiSchema | undefined,
  document: OpenApiDocument,
): OpenApiSchema | undefined {
  if (!schema?.$ref?.startsWith("#/components/schemas/")) return schema;
  const name = decodeURIComponent(schema.$ref.split("/").at(-1) ?? "");
  return document.components?.schemas?.[name] ?? schema;
}

function combinedSchema(
  schema: OpenApiSchema | undefined,
  document: OpenApiDocument,
): OpenApiSchema | undefined {
  const resolved = resolveSchema(schema, document);
  if (!resolved?.allOf?.length) return resolved;

  const parts = resolved.allOf
    .map((part) => combinedSchema(part, document))
    .filter((part): part is OpenApiSchema => Boolean(part));
  return {
    ...resolved,
    properties: Object.assign({}, ...parts.map((part) => part.properties ?? {})),
    required: [...new Set(parts.flatMap((part) => part.required ?? []))],
  };
}

function schemaType(
  schema: OpenApiSchema | undefined,
  document: OpenApiDocument,
): string {
  const resolved = combinedSchema(schema, document);
  if (!resolved) return "any";
  if (resolved.enum?.length) return resolved.enum.map(String).join(" | ");
  if (resolved.oneOf?.length) {
    return resolved.oneOf.map((part) => schemaType(part, document)).join(" or ");
  }
  if (resolved.anyOf?.length) {
    return resolved.anyOf.map((part) => schemaType(part, document)).join(" or ");
  }
  const type = Array.isArray(resolved.type)
    ? resolved.type.join(" | ")
    : resolved.type;
  if (type === "array") return `${schemaType(resolved.items, document)}[]`;
  return [type ?? (resolved.properties ? "object" : "any"), resolved.format]
    .filter(Boolean)
    .join(" · ");
}

function schemaSample(
  schema: OpenApiSchema | undefined,
  document: OpenApiDocument,
  depth = 0,
): unknown {
  const resolved = combinedSchema(schema, document);
  if (!resolved || depth > 4) return null;
  if (resolved.example !== undefined) return resolved.example;
  if (resolved.default !== undefined) return resolved.default;
  if (resolved.enum?.length) return resolved.enum[0];
  if (resolved.oneOf?.length) {
    return schemaSample(resolved.oneOf[0], document, depth + 1);
  }
  if (resolved.anyOf?.length) {
    return schemaSample(resolved.anyOf[0], document, depth + 1);
  }
  if (resolved.properties) {
    return Object.fromEntries(
      Object.entries(resolved.properties).map(([name, property]) => [
        name,
        schemaSample(property, document, depth + 1),
      ]),
    );
  }
  const type = Array.isArray(resolved.type) ? resolved.type[0] : resolved.type;
  if (type === "array") return [schemaSample(resolved.items, document, depth + 1)];
  if (type === "boolean") return true;
  if (type === "integer" || type === "number") return 0;
  if (resolved.format === "uuid") return "00000000-0000-0000-0000-000000000000";
  if (resolved.format === "uri") return "https://example.com";
  if (resolved.format === "date-time") return "2026-08-02T12:00:00Z";
  return "string";
}

function schemaFields(
  schema: OpenApiSchema | undefined,
  document: OpenApiDocument,
  prefix = "",
  inheritedRequired = false,
  depth = 0,
): SchemaField[] {
  const resolved = combinedSchema(schema, document);
  if (!resolved?.properties || depth > 3) return [];
  const required = new Set(resolved.required ?? []);

  return Object.entries(resolved.properties).flatMap(([name, property]) => {
    const child = combinedSchema(property, document);
    const fieldName = prefix ? `${prefix}.${name}` : name;
    const row: SchemaField = {
      name: fieldName,
      required: inheritedRequired || required.has(name),
      type: schemaType(child, document),
      description: child?.description ?? "",
    };
    const nested = child?.properties
      ? schemaFields(
          child,
          document,
          fieldName,
          row.required,
          depth + 1,
        )
      : [];
    return [row, ...nested];
  });
}

function operationsFrom(document: OpenApiDocument): ApiOperation[] {
  return Object.entries(document.paths).flatMap(([path, pathItem]) =>
    methods.flatMap((method) => {
      const operation = pathItem[method];
      if (!operation) return [];
      return [
        {
          ...operation,
          id: operation.operationId ?? `${method}-${path}`,
          method,
          path,
          tag: operation.tags?.[0] ?? "Other",
        },
      ];
    }),
  );
}

function securityLabel(operation: ApiOperation) {
  const alternatives = operation.security
    ?.map((requirement) => [...new Set(Object.values(requirement).flat())])
    .filter((scopes) => scopes.length > 0);
  if (!alternatives?.length) return [];
  return alternatives.map((scopes) => scopes.join(" + "));
}

function requestMedia(operation: ApiOperation) {
  const entries = Object.entries(operation.requestBody?.content ?? {});
  return entries.find(([type]) => type === "application/json") ?? entries[0];
}

function requestExample(operation: ApiOperation, document: OpenApiDocument) {
  const media = requestMedia(operation)?.[1];
  return media?.example ?? schemaSample(media?.schema, document);
}

function curlExample(operation: ApiOperation, document: OpenApiDocument) {
  const base = document.servers?.[0]?.url ?? "https://cloud.taicho.ai/api/v1";
  const parameterValues = Object.fromEntries(
    (operation.parameters ?? [])
      .filter((parameter) => parameter.in === "path")
      .map((parameter) => [parameter.name, `<${parameter.name}>`]),
  );
  const resolvedPath = operation.path.replaceAll(
    /\{([^}]+)\}/g,
    (_match, name: string) => String(parameterValues[name] ?? `<${name}>`),
  );
  const query = (operation.parameters ?? [])
    .filter((parameter) => parameter.in === "query" && parameter.required)
    .map((parameter) => `${parameter.name}=<${parameter.name}>`)
    .join("&");
  const lines = [
    `curl --request ${operation.method.toUpperCase()} \\`,
    `  --url '${base}${resolvedPath}${query ? `?${query}` : ""}' \\`,
    "  --header 'Authorization: Bearer $TAICHO_ACCESS_TOKEN'",
  ];
  if (operation.method !== "get") {
    lines[lines.length - 1] += " \\";
    lines.push("  --header 'Idempotency-Key: <unique-request-key>'");
  }
  const media = requestMedia(operation);
  if (media) {
    lines[lines.length - 1] += " \\";
    lines.push(`  --header 'Content-Type: ${media[0]}' \\`);
    lines.push(
      `  --data '${JSON.stringify(requestExample(operation, document), null, 2).replaceAll("'", "'\\''")}'`,
    );
  }
  return lines.join("\n");
}

function CodeBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-black/35">
      <button
        className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
        onClick={copy}
        title="Copy request"
        type="button"
      >
        {copied ? <Check className="size-4 text-emerald-300" /> : <Copy className="size-4" />}
      </button>
      <pre className="overflow-x-auto p-4 pr-14 text-xs leading-6 text-foreground">
        <code>{value}</code>
      </pre>
    </div>
  );
}

function FieldsTable({
  document,
  schema,
}: {
  document: OpenApiDocument;
  schema: OpenApiSchema | undefined;
}) {
  const fields = schemaFields(schema, document);
  if (fields.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="bg-muted/65 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-semibold">Field</th>
            <th className="px-3 py-2 font-semibold">Type</th>
            <th className="px-3 py-2 font-semibold">Description</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr className="border-t border-border align-top" key={field.name}>
              <td className="px-3 py-2.5 font-mono text-foreground">
                {field.name}
                {field.required ? <span className="ml-1 text-rose-300">*</span> : null}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-violet-300">
                {field.type}
              </td>
              <td className="min-w-64 px-3 py-2.5 leading-5 text-muted-foreground">
                {field.description || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SchemaPanel({
  document,
  media,
}: {
  document: OpenApiDocument;
  media: OpenApiMediaType;
}) {
  const example = media.example ?? schemaSample(media.schema, document);
  return (
    <div className="grid gap-4">
      <FieldsTable document={document} schema={media.schema} />
      {example !== undefined ? (
        <CodeBlock value={JSON.stringify(example, null, 2)} />
      ) : null}
    </div>
  );
}

function OperationDetails({
  document,
  operation,
}: {
  document: OpenApiDocument;
  operation: ApiOperation;
}) {
  const scopes = securityLabel(operation);
  const media = requestMedia(operation);
  const responses = Object.entries(operation.responses ?? {});

  return (
    <div className="grid gap-7 border-t border-border px-4 py-5 sm:px-5">
      {operation.description ? (
        <p className="text-sm leading-6 text-muted-foreground">
          {operation.description}
        </p>
      ) : null}

      {scopes.length > 0 ? (
        <section>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <KeyRound className="size-4 text-primary" /> OAuth access
          </h4>
          <div className="flex flex-wrap items-center gap-2">
            {scopes.map((scope, index) => (
              <span className="contents" key={scope}>
                {index > 0 ? (
                  <span className="text-[11px] font-semibold uppercase text-muted-foreground">or</span>
                ) : null}
                <code className="rounded-md border border-violet-400/20 bg-violet-400/10 px-2 py-1 text-xs text-violet-200">
                  {scope}
                </code>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {(operation.parameters?.length ?? 0) > 0 ? (
        <section>
          <h4 className="mb-3 text-sm font-semibold text-foreground">Parameters</h4>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-muted/65 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Location</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Description</th>
                </tr>
              </thead>
              <tbody>
                {operation.parameters?.map((parameter) => (
                  <tr className="border-t border-border align-top" key={`${parameter.in}-${parameter.name}`}>
                    <td className="px-3 py-2.5 font-mono text-foreground">
                      {parameter.name}
                      {parameter.required ? <span className="ml-1 text-rose-300">*</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{parameter.in}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-violet-300">
                      {schemaType(parameter.schema, document)}
                    </td>
                    <td className="min-w-64 px-3 py-2.5 leading-5 text-muted-foreground">
                      {parameter.description || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {media ? (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-foreground">Request body</h4>
            <code className="text-xs text-muted-foreground">{media[0]}</code>
          </div>
          <SchemaPanel document={document} media={media[1]} />
        </section>
      ) : null}

      <section>
        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Braces className="size-4 text-primary" /> Request example
        </h4>
        <CodeBlock value={curlExample(operation, document)} />
      </section>

      {responses.length > 0 ? (
        <section>
          <h4 className="mb-3 text-sm font-semibold text-foreground">Responses</h4>
          <div className="grid gap-2">
            {responses.map(([status, response]) => {
              const responseMedia = Object.entries(response.content ?? {})[0];
              return (
                <details
                  className="group overflow-hidden rounded-lg border border-border bg-background/45"
                  key={status}
                  open={status.startsWith("2") || undefined}
                >
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 text-xs marker:hidden">
                    <code className={status.startsWith("2") ? "text-emerald-300" : "text-amber-300"}>
                      {status}
                    </code>
                    <span className="text-muted-foreground">{response.description ?? "Response"}</span>
                    <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  {responseMedia ? (
                    <div className="border-t border-border p-3">
                      <p className="mb-3 font-mono text-[11px] text-muted-foreground">
                        {responseMedia[0]}
                      </p>
                      <SchemaPanel document={document} media={responseMedia[1]} />
                    </div>
                  ) : null}
                </details>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function ApiReference() {
  const [document, setDocument] = useState<OpenApiDocument | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/openapi", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("API contract unavailable");
        return (await response.json()) as OpenApiDocument;
      })
      .then(setDocument)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError("The API reference could not be loaded. Try again shortly.");
      });
    return () => controller.abort();
  }, []);

  const allOperations = useMemo(
    () => (document ? operationsFrom(document) : []),
    [document],
  );
  const filtered = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return allOperations;
    return allOperations.filter((operation) =>
      [
        operation.method,
        operation.path,
        operation.summary,
        operation.operationId,
        operation.tag,
        ...securityLabel(operation),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [allOperations, query]);
  const groups = useMemo(() => {
    const grouped = new Map<string, ApiOperation[]>();
    for (const operation of filtered) {
      grouped.set(operation.tag, [...(grouped.get(operation.tag) ?? []), operation]);
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [filtered]);

  return (
    <div className="min-w-0">
      <header className="border-b border-border pb-8">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-primary">
          Developers
        </p>
        <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          API reference
        </h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">
          Explore every Taicho REST operation, its OAuth requirements, parameters,
          request body, and response contract.
        </p>
        {document ? (
          <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-border bg-card px-3 py-1">
              OpenAPI {document.openapi}
            </span>
            <span className="rounded-full border border-border bg-card px-3 py-1">
              {allOperations.length} operations
            </span>
            <span className="rounded-full border border-border bg-card px-3 py-1">
              {document.info.version}
            </span>
          </div>
        ) : null}
      </header>

      <div className="sticky top-20 z-20 my-7 rounded-xl border border-border bg-background/90 p-3 shadow-xl shadow-black/10 backdrop-blur-xl">
        <label className="flex items-center gap-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <span className="sr-only">Filter API operations</span>
          <input
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by path, operation, scope, or product…"
            type="search"
            value={query}
          />
          {document ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {filtered.length} shown
            </span>
          ) : null}
        </label>
      </div>

      {!document && !error ? (
        <div aria-live="polite" className="grid gap-3">
          {[0, 1, 2, 3, 4].map((item) => (
            <div className="h-16 animate-pulse rounded-xl border border-border bg-card/65" key={item} />
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-400/25 bg-rose-400/10 p-5 text-sm text-rose-200" role="alert">
          {error}
        </div>
      ) : null}

      {document && groups.length === 0 ? (
        <div className="rounded-xl border border-border bg-card/65 p-8 text-center text-sm text-muted-foreground">
          No operations match “{query}”.
        </div>
      ) : null}

      {document ? (
        <div className="grid gap-10">
          {groups.map(([tag, operations]) => (
            <section id={tag.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")} key={tag}>
              <div className="mb-3 flex items-end justify-between gap-4">
                <h2 className="font-heading text-xl font-bold text-foreground">{tag}</h2>
                <span className="text-xs text-muted-foreground">
                  {operations.length} {operations.length === 1 ? "operation" : "operations"}
                </span>
              </div>
              <div className="grid gap-2">
                {operations.map((operation) => {
                  const open = expanded === operation.id;
                  const scopes = securityLabel(operation);
                  return (
                    <article className="overflow-hidden rounded-xl border border-border bg-card/70" key={operation.id}>
                      <button
                        aria-expanded={open}
                        className="flex w-full min-w-0 items-start gap-3 p-3 text-left transition-colors hover:bg-accent/45 sm:items-center sm:p-4"
                        onClick={() => setExpanded(open ? null : operation.id)}
                        type="button"
                      >
                        <span className={`mt-0.5 inline-flex w-16 shrink-0 justify-center rounded-md border px-2 py-1 font-mono text-[11px] font-bold uppercase sm:mt-0 ${methodStyles[operation.method]}`}>
                          {operation.method}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block break-all font-mono text-sm font-semibold text-foreground">
                            {operation.path}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                            {operation.summary ?? operation.operationId}
                          </span>
                        </span>
                        {scopes.length > 0 ? (
                          <KeyRound className="mt-1 hidden size-4 shrink-0 text-violet-300 sm:block" />
                        ) : null}
                        <ChevronDown className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform sm:mt-0 ${open ? "rotate-180" : ""}`} />
                      </button>
                      {open ? <OperationDetails document={document} operation={operation} /> : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
