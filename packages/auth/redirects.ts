const DEFAULT_RETURN_TO = "/";
const MAX_RETURN_TO_LENGTH = 2_048;

/**
 * Accept only an application-relative destination. This function is the final
 * boundary before a browser redirect; callers must not pass through absolute,
 * protocol-relative, backslash-normalized, or control-character input.
 */
export function safeReturnTo(
  value: string | null | undefined,
  fallback = DEFAULT_RETURN_TO,
): string {
  if (
    !value
    || value.length > MAX_RETURN_TO_LENGTH
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(value, "https://cloud.taicho.ai");
    if (parsed.origin !== "https://cloud.taicho.ai") return fallback;
    const destination = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return destination.startsWith("/sign-in") ? fallback : destination;
  } catch {
    return fallback;
  }
}
