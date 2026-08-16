/**
 * Browser-side client for the registry-served API (/api/v1).
 *
 * The dashboard authenticates with its session cookie (same-origin fetch);
 * responses are the external API envelope { data, meta } and RFC 7807-style
 * problems on error. Mutations carry a generated Idempotency-Key, giving
 * every UI action safe-retry semantics for free.
 *
 * This module is client-safe: fetch + web APIs only.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Envelope<T> = { data: T; meta: { requestId: string; replayed: boolean; summary: string } };

async function problemFrom(response: Response): Promise<ApiError> {
  const fallback = new ApiError(response.status, "INTERNAL", `API request failed with status ${response.status}.`);
  try {
    const body = await response.json() as { code?: string; detail?: string; title?: string; details?: unknown };
    return new ApiError(
      response.status,
      typeof body.code === "string" ? body.code : "INTERNAL",
      body.detail ?? body.title ?? fallback.message,
      body.details,
    );
  } catch {
    return fallback;
  }
}

async function unwrap<T>(response: Response): Promise<Envelope<T>> {
  if (!response.ok) throw await problemFrom(response);
  return await response.json() as Envelope<T>;
}

/** GET a query capability. Input travels as query parameters. */
export async function apiGet<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const url = new URL(`/api/v1${path}`, window.location.origin);
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  const envelope = await unwrap<T>(await fetch(url, { headers: { Accept: "application/json" } }));
  return envelope.data;
}

/** Execute a command capability. An idempotency key is always attached. */
export async function apiMutate<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  options?: { idempotencyKey?: string },
): Promise<Envelope<T>> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Idempotency-Key": options?.idempotencyKey ?? crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return unwrap<T>(response);
}

export type ApiStreamHandlers<C, T> = {
  onChunk?: (chunk: C) => void;
  onResult?: (result: { data: T; meta: { requestId: string; replayed: boolean; summary: string } }) => void;
  onError?: (error: ApiError) => void;
};

/**
 * Consume the SSE projection of a stream capability (POST <path>/stream).
 * Resolves with the final result; rejects on a terminal error event or
 * transport failure. Abort via the returned controller to cancel server-side
 * work.
 */
export function apiStream<C, T>(
  path: string,
  body: unknown,
  handlers: ApiStreamHandlers<C, T>,
): { done: Promise<{ data: T; meta: { requestId: string; replayed: boolean; summary: string } }>; abort: () => void } {
  const controller = new AbortController();
  const done = (async () => {
    const response = await fetch(`/api/v1${path}/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw await problemFrom(response);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let final: { data: T; meta: { requestId: string; replayed: boolean; summary: string } } | undefined;
    let terminalError: ApiError | undefined;

    const handleFrame = (frame: string) => {
      const lines = frame.split("\n");
      const event = lines.find((line) => line.startsWith("event: "))?.slice("event: ".length).trim();
      const data = lines.filter((line) => line.startsWith("data: ")).map((line) => line.slice("data: ".length)).join("\n");
      if (!event || !data) return;
      if (event === "chunk") handlers.onChunk?.(JSON.parse(data) as C);
      else if (event === "result") {
        final = JSON.parse(data) as { data: T; meta: { requestId: string; replayed: boolean; summary: string } };
        handlers.onResult?.(final);
      } else if (event === "error") {
        const payload = JSON.parse(data) as { code?: string; message?: string };
        terminalError = new ApiError(500, payload.code ?? "INTERNAL", payload.message ?? "The stream failed.");
        handlers.onError?.(terminalError);
      }
    };

    while (true) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        handleFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
    if (terminalError) throw terminalError;
    if (!final) throw new ApiError(500, "INTERNAL", "The stream ended without a terminal event.");
    return final;
  })();
  return { done, abort: () => controller.abort() };
}
