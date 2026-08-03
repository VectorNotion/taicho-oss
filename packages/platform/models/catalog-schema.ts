import { z } from "zod";
import { MODEL_CAPABILITIES, MODEL_PROVIDERS, MODEL_SURFACES } from "./catalog";

const operationalStatus = z.enum(["configured", "degraded"]);
const visibleStatus = z.enum(["available", "preview"]);
const catalogSurface = z.union([
  z.enum(MODEL_SURFACES),
  // Compatibility for catalog snapshots written before the automation
  // product was retired. The value is removed during parsing and never
  // reaches the live model catalog.
  z.literal("automations"),
]);

const catalogModelSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/),
  name: z.string().min(1).max(160),
  family: z.string().min(1).max(160),
  description: z.string().min(1).max(2_000),
  provider: z.enum(MODEL_PROVIDERS),
  deploymentId: z.string().min(1).max(300),
  kind: z.enum(["language", "image", "video", "audio"]),
  capabilities: z.array(z.enum(MODEL_CAPABILITIES)).min(1),
  surfaces: z.array(catalogSurface).min(1).transform((surfaces) =>
    surfaces.filter(
      (surface): surface is (typeof MODEL_SURFACES)[number] => surface !== "automations",
    ),
  ),
  speed: z.enum(["fast", "balanced", "deliberate"]),
  creditMultiplier: z.number().positive(),
  status: visibleStatus,
  recommended: z.boolean().default(false),
  credentialReference: z.string().max(500).nullable().optional(),
  operationalStatus,
  sortOrder: z.number().finite(),
});

export const platformCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  catalogVersion: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.string().datetime(),
  models: z.array(catalogModelSchema).max(200).transform((models) =>
    models.filter((model) => model.surfaces.length > 0),
  ),
});
