import assert from "node:assert/strict";
import test from "node:test";
import {
  commercialProvider,
  setCommercialProvider,
  UnmeteredCommercialProvider,
} from "../commercial/provider";

test("commercial provider registration is shared through the process-wide symbol registry", () => {
  const original = commercialProvider();
  const replacement = new UnmeteredCommercialProvider();
  const providerKey = Symbol.for("content-automation.commercial-provider");

  try {
    setCommercialProvider(replacement);
    assert.equal(commercialProvider(), replacement);
    assert.equal(
      (globalThis as typeof globalThis & Record<symbol, unknown>)[providerKey],
      replacement,
    );
  } finally {
    setCommercialProvider(original);
  }
});
