import assert from "node:assert/strict";
import test from "node:test";
import {
  responseFailureMessage,
  responseSupportCode,
  safeCorrelationId,
} from "../client";

test("client failure messages include a validated support code", () => {
  const response = new Response(null, {
    headers: { "x-vector-notion-support-code": "TX-ABCDE-12345" },
    status: 500,
  });

  assert.equal(responseSupportCode(response), "TX-ABCDE-12345");
  assert.equal(
    responseFailureMessage(response, "The request could not be completed."),
    "The request could not be completed. Support code: TX-ABCDE-12345.",
  );
});

test("client failure messages reject unsafe header values", () => {
  const response = new Response(null, {
    headers: {
      "x-vector-notion-support-code": "bad code<script>alert(1)</script>",
    },
    status: 500,
  });

  assert.equal(responseSupportCode(response), undefined);
  assert.equal(
    responseFailureMessage(response, "Please try again."),
    "Please try again.",
  );
  assert.equal(safeCorrelationId(" request:123 "), "request:123");
  assert.equal(safeCorrelationId("line\nbreak"), undefined);
});
