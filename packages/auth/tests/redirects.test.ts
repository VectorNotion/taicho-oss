import assert from "node:assert/strict";
import test from "node:test";

import { safeReturnTo } from "../redirects";

test("return destinations stay inside the application", () => {
  assert.equal(safeReturnTo("/content/projects?view=mine#drafts"), "/content/projects?view=mine#drafts");
  assert.equal(
    safeReturnTo("/payments/start?plan=pro&seats=3"),
    "/payments/start?plan=pro&seats=3",
  );
  assert.equal(safeReturnTo("/"), "/");

  for (const unsafe of [
    "https://evil.example/phish",
    "//evil.example/phish",
    "/\\evil.example/phish",
    "javascript:alert(1)",
    "/sign-in?returnTo=/sign-in",
    "/safe\nLocation: https://evil.example",
    "",
  ]) {
    assert.equal(safeReturnTo(unsafe), "/", unsafe);
  }
});

test("callers can supply a known-safe fallback", () => {
  assert.equal(safeReturnTo("https://evil.example", "/outreach"), "/outreach");
});
