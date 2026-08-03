import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTOR_ID_HEADER,
  ACTOR_TYPE_HEADER,
  CONNECTOR_ID_HEADER,
  EVENT_ORIGIN_HEADER,
  EXTERNAL_EVENT_ID_HEADER,
  EXECUTION_ID_HEADER,
  ORGANIZATION_ID_HEADER,
  PARENT_EXECUTION_ID_HEADER,
  REQUEST_ID_HEADER,
  SESSION_ID_HEADER,
  SUPPORT_CODE_HEADER,
  headersAtExternalBoundary,
  headersWithExecutionContext,
  publicCorrelationHeaders,
  readHeaderAttribution,
} from "../headers";

test("execution headers preserve valid incoming correlation and add attribution", () => {
  const source = new Headers({ [REQUEST_ID_HEADER]: "request-1" });
  const headers = headersWithExecutionContext(source, {
    organizationId: "org-1",
    actorId: "user-1",
    actorType: "user",
  });
  assert.equal(headers.get(REQUEST_ID_HEADER), "request-1");
  assert.equal(headers.get(EXECUTION_ID_HEADER), "request-1");
  assert.equal(readHeaderAttribution(headers).organizationId, "org-1");
});

test("external boundaries reject forged internal attribution", () => {
  const source = new Headers({
    [REQUEST_ID_HEADER]: "forged-request",
    [EXECUTION_ID_HEADER]: "forged-execution",
    [PARENT_EXECUTION_ID_HEADER]: "forged-parent",
    [ORGANIZATION_ID_HEADER]: "forged-org",
    [ACTOR_ID_HEADER]: "forged-user",
    [ACTOR_TYPE_HEADER]: "user",
    [SESSION_ID_HEADER]: "forged-session",
    [SUPPORT_CODE_HEADER]: "TX-FORGE-FORGE",
    [EVENT_ORIGIN_HEADER]: "external_connector",
    [CONNECTOR_ID_HEADER]: "forged-connector",
    [EXTERNAL_EVENT_ID_HEADER]: "forged-event",
    authorization: "Bearer retained-for-authentication",
  });
  const trusted = headersAtExternalBoundary(source);
  assert.notEqual(trusted.get(REQUEST_ID_HEADER), "forged-request");
  assert.notEqual(trusted.get(EXECUTION_ID_HEADER), "forged-execution");
  assert.equal(trusted.get(PARENT_EXECUTION_ID_HEADER), null);
  assert.equal(trusted.get(ORGANIZATION_ID_HEADER), null);
  assert.equal(trusted.get(ACTOR_ID_HEADER), null);
  assert.equal(trusted.get(ACTOR_TYPE_HEADER), null);
  assert.equal(trusted.get(SESSION_ID_HEADER), null);
  assert.equal(trusted.get(EVENT_ORIGIN_HEADER), null);
  assert.equal(trusted.get(CONNECTOR_ID_HEADER), null);
  assert.equal(trusted.get(EXTERNAL_EVENT_ID_HEADER), null);
  assert.notEqual(trusted.get(SUPPORT_CODE_HEADER), "TX-FORGE-FORGE");
  assert.equal(trusted.get("authorization"), "Bearer retained-for-authentication");
});

test("public correlation headers never expose internal attribution", () => {
  const source = headersWithExecutionContext(new Headers(), {
    organizationId: "org-1",
    actorId: "user-1",
    actorType: "user",
  });
  const publicHeaders = publicCorrelationHeaders(source);
  assert.equal(publicHeaders.has(ORGANIZATION_ID_HEADER), false);
  assert.equal(publicHeaders.has(ACTOR_ID_HEADER), false);
  assert.equal(publicHeaders.has(REQUEST_ID_HEADER), true);
  assert.equal(publicHeaders.has(EXECUTION_ID_HEADER), true);
});
