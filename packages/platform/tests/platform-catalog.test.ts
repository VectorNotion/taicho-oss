import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { platformCatalogSchema } from "../models/catalog-schema";
import {
  clearPlatformCatalogMemoryCache,
  localDevelopmentPlatformCatalog,
  refreshPlatformCatalog,
} from "../models/catalog-service";
import { readPlatformCatalogSnapshot, writePlatformCatalogSnapshot } from "../models/catalog-repository";

const catalog = {
  schemaVersion: 1,
  catalogVersion: "a".repeat(64),
  generatedAt: "2026-07-31T10:00:00.000Z",
  models: [{
    key: "text-balanced", name: "Balanced", family: "Test", description: "Approved model",
    provider: "litellm", deploymentId: "taicho-text-balanced", kind: "language",
    capabilities: ["text-generation", "tool-use"], surfaces: ["chat", "squad"],
    speed: "balanced", creditMultiplier: 1, status: "available", recommended: true,
    credentialReference: "secret://taicho/litellm", operationalStatus: "configured", sortOrder: 10,
  }],
} as const;

const apiKey = "catalog-test-api-key-with-at-least-32-characters";
const secret = "catalog-test-signing-secret-with-at-least-32-characters";

function response(signatureBody: string, responseBody = signatureBody) {
  const signature = createHmac("sha256", secret).update(signatureBody).digest("hex");
  return new Response(responseBody, {
    headers: { "x-platform-catalog-signature": `sha256=${signature}` },
  });
}

test("the deterministic local catalog keeps workspace Chat discoverable after a database reset", () => {
  const local = platformCatalogSchema.parse(localDevelopmentPlatformCatalog());
  const chatModels = local.models.filter((model) => model.surfaces.includes("chat"));
  assert.equal(chatModels.length, 3);
  assert.ok(chatModels.every((model) => model.capabilities.includes("tool-use")));
  assert.equal(chatModels.some((model) => model.key === "text-balanced"), true);
});

test("retired automation surfaces do not hide models used by the homepage assistant", () => {
  const parsed = platformCatalogSchema.parse({
    ...catalog,
    models: [
      { ...catalog.models[0], surfaces: ["chat", "squad", "automations"] },
      { ...catalog.models[0], key: "retired-only", surfaces: ["automations"] },
    ],
  });

  assert.deepEqual(parsed.models.map((model) => model.key), ["text-balanced"]);
  assert.deepEqual(parsed.models[0]?.surfaces, ["chat", "squad"]);
});

test("accepts a valid signed CMS catalog and persists the verified value", async () => {
  const previous = {
    url: process.env.PLATFORM_CATALOG_URL,
    key: process.env.PLATFORM_CATALOG_API_KEY,
    secret: process.env.PLATFORM_CATALOG_SIGNING_SECRET,
  };
  process.env.PLATFORM_CATALOG_URL = "http://cms.internal/api/platform/catalog";
  process.env.PLATFORM_CATALOG_API_KEY = apiKey;
  process.env.PLATFORM_CATALOG_SIGNING_SECRET = secret;
  clearPlatformCatalogMemoryCache();
  let persisted = "";
  try {
    const body = JSON.stringify(catalog);
    const result = await refreshPlatformCatalog(async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("x-api-key"), apiKey);
      return response(body);
    }, async (value) => { persisted = value.catalogVersion; });
    assert.equal(result.catalogVersion, catalog.catalogVersion);
    assert.equal(persisted, catalog.catalogVersion);
  } finally {
    if (previous.url === undefined) delete process.env.PLATFORM_CATALOG_URL; else process.env.PLATFORM_CATALOG_URL = previous.url;
    if (previous.key === undefined) delete process.env.PLATFORM_CATALOG_API_KEY; else process.env.PLATFORM_CATALOG_API_KEY = previous.key;
    if (previous.secret === undefined) delete process.env.PLATFORM_CATALOG_SIGNING_SECRET; else process.env.PLATFORM_CATALOG_SIGNING_SECRET = previous.secret;
  }
});

test("rejects a catalog whose body was changed after signing", async () => {
  process.env.PLATFORM_CATALOG_URL = "http://cms.internal/api/platform/catalog";
  process.env.PLATFORM_CATALOG_API_KEY = apiKey;
  process.env.PLATFORM_CATALOG_SIGNING_SECRET = secret;
  const signed = JSON.stringify(catalog);
  const tampered = JSON.stringify({ ...catalog, catalogVersion: "b".repeat(64) });
  await assert.rejects(
    refreshPlatformCatalog(async () => response(signed, tampered), async () => undefined),
    /signature verification failed/,
  );
});

test("uses the CMS directly when the optional production snapshot database is absent", async () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.PLATFORM_CATALOG_DATABASE_URL,
  };
  process.env.NODE_ENV = "production";
  delete process.env.PLATFORM_CATALOG_DATABASE_URL;
  try {
    assert.equal(await readPlatformCatalogSnapshot(), null);
    await writePlatformCatalogSnapshot(catalog);
  } finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.databaseUrl === undefined) delete process.env.PLATFORM_CATALOG_DATABASE_URL;
    else process.env.PLATFORM_CATALOG_DATABASE_URL = previous.databaseUrl;
  }
});
