import { safeCorrelationId } from "./correlation";

const SUPPORT_CODE_HEADER = "x-vector-notion-support-code";

/** Returns only a validated, server-owned support code from an HTTP response. */
export function responseSupportCode(response: Pick<Response, "headers">): string | undefined {
  return safeCorrelationId(response.headers.get(SUPPORT_CODE_HEADER));
}

/**
 * Builds a customer-safe failure message without reading or reflecting the
 * response body, status text, URL, or an exception message.
 */
export function responseFailureMessage(
  response: Pick<Response, "headers">,
  fallback: string,
): string {
  const supportCode = responseSupportCode(response);
  return supportCode
    ? `${fallback} Support code: ${supportCode}.`
    : fallback;
}

export { safeCorrelationId };
