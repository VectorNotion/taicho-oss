import assert from "node:assert/strict";
import test from "node:test";
import { createLangfuseObservability } from "../ai";
import { initializeObservability } from "../node";

test("cloud exporters cannot start without the HMAC identity key", async () => {
  const previous = {
    enabled: process.env.OBSERVABILITY_ENABLED,
    hashKey: process.env.OBSERVABILITY_ID_HASH_KEY,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
  };
  try {
    process.env.OBSERVABILITY_ENABLED = "true";
    delete process.env.OBSERVABILITY_ID_HASH_KEY;
    await assert.rejects(
      initializeObservability({ serviceName: "test-cloud-config" }),
      /OBSERVABILITY_ID_HASH_KEY/,
    );

    process.env.OBSERVABILITY_ENABLED = "false";
    process.env.LANGFUSE_PUBLIC_KEY = "public-test";
    process.env.LANGFUSE_SECRET_KEY = "secret-test";
    assert.throws(
      () => createLangfuseObservability("test-cloud-config"),
      /OBSERVABILITY_ID_HASH_KEY/,
    );
  } finally {
    for (const [key, value] of Object.entries({
      OBSERVABILITY_ENABLED: previous.enabled,
      OBSERVABILITY_ID_HASH_KEY: previous.hashKey,
      LANGFUSE_PUBLIC_KEY: previous.publicKey,
      LANGFUSE_SECRET_KEY: previous.secretKey,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
