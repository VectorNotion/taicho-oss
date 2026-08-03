import { supportCodeFor } from "./support";
import { safeCorrelationId } from "./correlation";

export { safeCorrelationId } from "./correlation";

export const REQUEST_ID_HEADER = "x-vector-notion-request-id";
export const EXECUTION_ID_HEADER = "x-vector-notion-execution-id";
export const ORGANIZATION_ID_HEADER = "x-vector-notion-organization-id";
export const ACTOR_ID_HEADER = "x-vector-notion-actor-id";
export const ACTOR_TYPE_HEADER = "x-vector-notion-actor-type";
export const SESSION_ID_HEADER = "x-vector-notion-session-id";
export const PARENT_EXECUTION_ID_HEADER = "x-vector-notion-parent-execution-id";
export const SUPPORT_CODE_HEADER = "x-vector-notion-support-code";
export const EVENT_ORIGIN_HEADER = "x-vector-notion-event-origin";
export const CONNECTOR_ID_HEADER = "x-vector-notion-connector-id";
export const EXTERNAL_EVENT_ID_HEADER = "x-vector-notion-external-event-id";

export type HeaderAttribution = {
  requestId?: string;
  executionId?: string;
  parentExecutionId?: string;
  organizationId?: string;
  actorId?: string;
  actorType?: "user" | "service" | "system";
  sessionId?: string;
  eventOrigin?: "internal" | "external_connector";
  connectorId?: string;
  externalEventId?: string;
};

function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function headersWithExecutionContext(
  source: Headers,
  attribution: HeaderAttribution = {},
): Headers {
  const headers = new Headers(source);
  const requestId = safeCorrelationId(attribution.requestId)
    ?? safeCorrelationId(headers.get(REQUEST_ID_HEADER))
    ?? newId();
  const executionId = safeCorrelationId(attribution.executionId)
    ?? safeCorrelationId(headers.get(EXECUTION_ID_HEADER))
    ?? requestId;

  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set(EXECUTION_ID_HEADER, executionId);
  headers.set(SUPPORT_CODE_HEADER, supportCodeFor(requestId));

  const values: Array<[string, string | undefined]> = [
    [PARENT_EXECUTION_ID_HEADER, safeCorrelationId(attribution.parentExecutionId)],
    [ORGANIZATION_ID_HEADER, safeCorrelationId(attribution.organizationId)],
    [ACTOR_ID_HEADER, safeCorrelationId(attribution.actorId)],
    [ACTOR_TYPE_HEADER, attribution.actorType],
    [SESSION_ID_HEADER, safeCorrelationId(attribution.sessionId)],
    [EVENT_ORIGIN_HEADER, attribution.eventOrigin],
    [CONNECTOR_ID_HEADER, safeCorrelationId(attribution.connectorId)],
    [EXTERNAL_EVENT_ID_HEADER, safeCorrelationId(attribution.externalEventId)],
  ];
  for (const [name, value] of values) {
    if (value) headers.set(name, value);
  }
  return headers;
}

/**
 * Starts a trusted correlation chain at a public network boundary.
 * `x-vector-notion-*` headers are server-owned and must never be accepted
 * from an arbitrary caller as identity or correlation evidence.
 */
export function headersAtExternalBoundary(source: Headers): Headers {
  const headers = new Headers(source);
  for (const name of [
    REQUEST_ID_HEADER,
    EXECUTION_ID_HEADER,
    PARENT_EXECUTION_ID_HEADER,
    ORGANIZATION_ID_HEADER,
    ACTOR_ID_HEADER,
    ACTOR_TYPE_HEADER,
    SESSION_ID_HEADER,
    SUPPORT_CODE_HEADER,
    EVENT_ORIGIN_HEADER,
    CONNECTOR_ID_HEADER,
    EXTERNAL_EVENT_ID_HEADER,
  ]) {
    headers.delete(name);
  }
  return headersWithExecutionContext(headers);
}

export function readHeaderAttribution(headers: Headers): HeaderAttribution {
  const actorType = headers.get(ACTOR_TYPE_HEADER);
  const eventOrigin = headers.get(EVENT_ORIGIN_HEADER);
  return {
    requestId: safeCorrelationId(headers.get(REQUEST_ID_HEADER)),
    executionId: safeCorrelationId(headers.get(EXECUTION_ID_HEADER)),
    parentExecutionId: safeCorrelationId(headers.get(PARENT_EXECUTION_ID_HEADER)),
    organizationId: safeCorrelationId(headers.get(ORGANIZATION_ID_HEADER)),
    actorId: safeCorrelationId(headers.get(ACTOR_ID_HEADER)),
    actorType: actorType === "user" || actorType === "service" || actorType === "system"
      ? actorType
      : undefined,
    sessionId: safeCorrelationId(headers.get(SESSION_ID_HEADER)),
    eventOrigin: eventOrigin === "internal" || eventOrigin === "external_connector"
      ? eventOrigin
      : undefined,
    connectorId: safeCorrelationId(headers.get(CONNECTOR_ID_HEADER)),
    externalEventId: safeCorrelationId(headers.get(EXTERNAL_EVENT_ID_HEADER)),
  };
}

export function publicCorrelationHeaders(headers: Headers): Headers {
  const publicHeaders = new Headers();
  const requestId = safeCorrelationId(headers.get(REQUEST_ID_HEADER));
  const executionId = safeCorrelationId(headers.get(EXECUTION_ID_HEADER));
  const supportCode = safeCorrelationId(headers.get(SUPPORT_CODE_HEADER))
    ?? (requestId ? supportCodeFor(requestId) : undefined);
  if (requestId) publicHeaders.set(REQUEST_ID_HEADER, requestId);
  if (executionId) publicHeaders.set(EXECUTION_ID_HEADER, executionId);
  if (supportCode) publicHeaders.set(SUPPORT_CODE_HEADER, supportCode);
  return publicHeaders;
}
