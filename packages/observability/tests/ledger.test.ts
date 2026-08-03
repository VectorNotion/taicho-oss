import assert from "node:assert/strict";
import test from "node:test";
import { supportCodeFor } from "../support";

test("support codes are stable, opaque, and human readable", () => {
  process.env.OBSERVABILITY_ID_HASH_KEY = "test-key";
  const first = supportCodeFor("request-private-1");
  assert.equal(first, supportCodeFor("request-private-1"));
  assert.notEqual(first, supportCodeFor("request-private-2"));
  assert.match(first, /^TX-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  assert.doesNotMatch(first, /request|private/i);
});
