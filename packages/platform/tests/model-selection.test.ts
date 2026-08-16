import assert from "node:assert/strict";
import test from "node:test";
import {
  listModelOptions,
  supportsCapabilities,
  type PlatformModelDefinition,
} from "../models/catalog";
import {
  ModelPolicyError,
  languageModelConfig,
  languageModelConfigForStoredSelection,
  languageModelRuntimeIsConfigured,
  resolveModelSelection,
} from "../models/resolver";

const languageSurfaces = ["chat", "content", "outreach", "cascade", "squad"] as const;
const models: PlatformModelDefinition[] = [
  {
    key: "text-fast", name: "Fast", family: "Test", provider: "litellm", kind: "language",
    description: "Fast model", capabilities: ["text-generation", "tool-use"], surfaces: languageSurfaces,
    speed: "fast", creditMultiplier: 0.5, status: "available", deploymentId: "taicho-text-fast",
    operationalStatus: "configured", sortOrder: 10,
  },
  {
    key: "text-balanced", name: "Balanced", family: "Test", provider: "litellm", kind: "language",
    description: "Balanced model", capabilities: ["text-generation", "tool-use"], surfaces: languageSurfaces,
    speed: "balanced", creditMultiplier: 1, status: "available", deploymentId: "taicho-text-balanced",
    operationalStatus: "configured", recommended: true, sortOrder: 20,
  },
  {
    key: "text-reasoning", name: "Reasoning", family: "Test", provider: "litellm", kind: "language",
    description: "Reasoning model", capabilities: ["text-generation", "tool-use"], surfaces: languageSurfaces,
    speed: "deliberate", creditMultiplier: 3, status: "available", deploymentId: "taicho-text-reasoning",
    operationalStatus: "configured", sortOrder: 30,
  },
  {
    key: "image-brand", name: "Image", family: "Test", provider: "fal", kind: "image",
    description: "Image model", capabilities: ["image-generation", "image-edit"], surfaces: ["creative"],
    speed: "balanced", creditMultiplier: 4, status: "available", deploymentId: "fal/image",
    operationalStatus: "configured", sortOrder: 40,
  },
  {
    key: "video-cinematic", name: "Video", family: "Test", provider: "fal", kind: "video",
    description: "Video model", capabilities: ["video-generation"], surfaces: ["creative"],
    speed: "deliberate", creditMultiplier: 8, status: "preview", deploymentId: "fal/video",
    operationalStatus: "configured", sortOrder: 50,
  },
];

test("chat only exposes language models with tool support", () => {
  const options = listModelOptions(models, {
    surface: "chat",
    requiredCapabilities: ["text-generation", "tool-use"],
  });

  assert.deepEqual(
    options.map((model) => model.key),
    ["text-fast", "text-balanced", "text-reasoning"],
  );
  assert.ok(
    options.every((model) =>
      supportsCapabilities(model, ["text-generation", "tool-use"]),
    ),
  );
});

test("creative choices are filtered by the requested media operation", () => {
  assert.deepEqual(
    listModelOptions(models, {
      surface: "creative",
      requiredCapabilities: ["image-edit"],
    }).map((model) => model.key),
    ["image-brand"],
  );
  assert.deepEqual(
    listModelOptions(models, {
      surface: "creative",
      requiredCapabilities: ["video-generation"],
    }).map((model) => model.key),
    ["video-cinematic"],
  );
});

test("auto resolves through a compatible workspace default", () => {
  const selection = resolveModelSelection({
    models,
    surface: "chat",
    requestedKey: "auto",
    workspaceDefaultKey: "text-fast",
    requiredCapabilities: ["text-generation", "tool-use"],
  });

  assert.equal(selection.requestedKey, "auto");
  assert.equal(selection.resolvedKey, "text-fast");
  assert.equal(selection.source, "workspace-default");
  assert.equal(selection.deployment.provider, "litellm");
});

test("an incompatible FAL image model cannot be submitted to chat", () => {
  assert.throws(
    () =>
      resolveModelSelection({
        models,
        surface: "chat",
        requestedKey: "image-brand",
        requiredCapabilities: ["text-generation", "tool-use"],
      }),
    (error) =>
      error instanceof ModelPolicyError
      && error.code === "incompatible_surface",
  );
});

test("workspace allowlists are enforced before execution", () => {
  assert.throws(
    () =>
      resolveModelSelection({
        models,
        surface: "content",
        requestedKey: "text-reasoning",
        allowedModelKeys: ["text-fast", "text-balanced"],
        requiredCapabilities: ["text-generation"],
      }),
    (error) =>
      error instanceof ModelPolicyError
      && error.code === "model_not_allowed",
  );
});

test("LiteLLM model configs use server credentials and deployment aliases", () => {
  const previousUrl = process.env.LITELLM_BASE_URL;
  const previousKey = process.env.LITELLM_API_KEY;
  try {
    process.env.LITELLM_BASE_URL = "http://litellm.internal/v1/";
    process.env.LITELLM_API_KEY = "test-service-key";
    const selection = resolveModelSelection({
      models,
      surface: "chat",
      requestedKey: "text-reasoning",
      requiredCapabilities: ["text-generation", "tool-use"],
    });

    assert.deepEqual(languageModelConfig(selection), {
      providerId: "litellm",
      modelId: "taicho-text-reasoning",
      url: "http://litellm.internal/v1",
      apiKey: "test-service-key",
    });
  } finally {
    if (previousUrl === undefined) delete process.env.LITELLM_BASE_URL;
    else process.env.LITELLM_BASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.LITELLM_API_KEY;
    else process.env.LITELLM_API_KEY = previousKey;
  }
});

test("the language runtime requires both LiteLLM endpoint and credential", () => {
  assert.equal(languageModelRuntimeIsConfigured({}), false);
  assert.equal(languageModelRuntimeIsConfigured({
    LITELLM_BASE_URL: "http://litellm.internal/v1",
  }), false);
  assert.equal(languageModelRuntimeIsConfigured({
    LITELLM_API_KEY: "test-service-key",
  }), false);
  assert.equal(languageModelRuntimeIsConfigured({
    LITELLM_BASE_URL: "http://litellm.internal/v1",
    LITELLM_API_KEY: "test-service-key",
  }), true);
});

test("legacy squad slugs remain executable during catalog migration", () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  try {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    assert.equal(
      languageModelConfigForStoredSelection({
        models,
        storedSelection: "qwen/qwen3.7-plus",
        surface: "squad",
      }),
      "openrouter/qwen/qwen3.7-plus",
    );
  } finally {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});
