import type { Attributes, AttributeValue } from "@opentelemetry/api";

const SENSITIVE_KEY = /(^|[._-])(authorization|cookie|credential|email|file|header|input|message|name|output|password|payload|phone|prompt|query|recipient|request_body|response|result|secret|subject|token|url)([._-]|$)/i;
const SECRET_VALUE = /(bearer\s+[a-z0-9._~+/-]+=*|api[_-]?key\s*[:=]|password\s*[:=]|secret\s*[:=])/i;
// These OpenInference fields are aggregate model metadata, not content or
// credentials; keep the allowlist exact so prompt/message bodies still fail
// the generic sensitive-key check below.
const SAFE_AI_METADATA_KEYS = new Set([
  "llm.provider",
  "llm.model_name",
  "llm.token_count.prompt",
  "llm.token_count.completion",
  "llm.token_count.completion_details.reasoning",
  "llm.token_count.prompt_details.cache_input",
  "llm.token_count.total",
  "llm.cost.total",
]);
const ERROR_FINGERPRINTS = {
  AggregateError: "62e36272211d5e9f",
  Error: "cb5e100e5a9a3e7f",
  EvalError: "42b1207a75992869",
  RangeError: "541498c30159c2e9",
  ReferenceError: "0d8eb333293241a2",
  SyntaxError: "404b90f249fbb4bd",
  TypeError: "ea0f33978305b64d",
  URIError: "7577df52c0fc3fe0",
  UnknownError: "994e65988b3ac029",
} as const;

function safeValue(value: unknown): AttributeValue | undefined {
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (SECRET_VALUE.test(value)) return "[REDACTED]";
    return value.slice(0, 512);
  }
  if (Array.isArray(value)) {
    const values: string[] = value
      .filter((item): item is string | number | boolean =>
        typeof item === "string" || typeof item === "number" || typeof item === "boolean")
      .slice(0, 32)
      .map((item) => String(item).slice(0, 256));
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}

function classifiedErrorType(error: Error): keyof typeof ERROR_FINGERPRINTS {
  if (error instanceof AggregateError) return "AggregateError";
  if (error instanceof EvalError) return "EvalError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  if (error instanceof SyntaxError) return "SyntaxError";
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof URIError) return "URIError";
  return "Error";
}

export function safeAttributes(input: Record<string, unknown> | undefined): Attributes {
  if (!input) return {};
  const output: Attributes = {};
  for (const [key, raw] of Object.entries(input)) {
    if (
      !/^[a-zA-Z0-9_.-]{1,96}$/.test(key)
      || (!SAFE_AI_METADATA_KEYS.has(key) && SENSITIVE_KEY.test(key))
    ) continue;
    const normalized = safeValue(raw);
    if (normalized !== undefined) output[key] = normalized;
  }
  return output;
}

export function safeError(error: unknown): {
  type: string;
  code?: string;
  message: string;
  fingerprint: string;
  stack?: string;
} {
  if (!(error instanceof Error)) {
    return {
      type: "UnknownError",
      message: "An unknown error occurred.",
      fingerprint: ERROR_FINGERPRINTS.UnknownError,
    };
  }
  const rawCode = "code" in error && typeof error.code === "string" ? error.code : undefined;
  const code = rawCode && rawCode.length <= 64 && /^[A-Z][A-Z0-9_]{1,63}$/.test(rawCode)
    ? rawCode
    : undefined;
  const type = classifiedErrorType(error);
  // In non-production, surface the real message + stack so local logs are
  // actually debuggable. Production stays fully redacted.
  const reveal = process.env.NODE_ENV !== "production";
  return {
    type,
    code,
    message: reveal ? error.message : "Operation failed.",
    fingerprint: ERROR_FINGERPRINTS[type],
    stack: reveal ? error.stack : undefined,
  };
}
