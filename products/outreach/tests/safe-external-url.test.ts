import assert from "node:assert/strict";
import test from "node:test";
import { safeExternalUrl } from "../ui/safe-external-url";

test("safeExternalUrl accepts only absolute HTTP(S) evidence links", () => {
  assert.equal(safeExternalUrl("https://example.com/evidence"), "https://example.com/evidence");
  assert.equal(safeExternalUrl("http://example.com/evidence"), "http://example.com/evidence");
  assert.equal(safeExternalUrl(" javascript:alert(document.domain) "), null);
  assert.equal(safeExternalUrl("data:text/html,unsafe"), null);
  assert.equal(safeExternalUrl("/relative/evidence"), null);
  assert.equal(safeExternalUrl("not a URL"), null);
});
