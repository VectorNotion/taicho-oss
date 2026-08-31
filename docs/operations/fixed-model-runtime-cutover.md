# Fixed model runtime cutover

This cutover removes CMS and database model authority. The same immutable
application artifact must advance through staging and production; changing the
language or creative targets requires a new reviewed release.

## Pre-cutover evidence and checks

1. From the pre-cutover CMS release, export the final catalog evidence to
   protected storage:

   ```sh
   pnpm --filter @content-automation/cms export:model-retirement-evidence -- --output /protected/platform-model-retirement.json
   ```

   Retain the generated SHA-256, row counts, and file with the release record.
   The exporter refuses to overwrite an existing artifact.
2. Confirm `OPENROUTER_API_KEY` and `FAL_KEY` are present in the target
   environment. Remove the retired catalog, LiteLLM, and model-override
   variables; the production validator rejects them if they remain.
3. Run `pnpm agents:migrate-model-keys`. Retain its per-organization before,
   rewritten, and after counts. Every after count must be zero.
4. Exercise Chat, MCP Chat, hosted Agents, research, and each enabled creative
   operation in staging. Usage records must contain the actual provider/model,
   operation, runtime version, and simulation state.

## Rollout order

1. Deploy the application artifact and workers with the fixed runtime adapter.
2. Verify Chat and hosted-agent readiness without making CMS available.
3. Apply the application migration that drops `platform_catalog_snapshots`.
4. Apply the CMS migration that drops Platform Models, its versions and joins,
   and the Payload lock relation.
5. Verify the CMS Admin has no Platform Models collection and that import
   providers, billing, support, assistant, and administration collections still
   operate.
6. Revoke the retired catalog signing, webhook, and API secrets after the
   observation window.

## Rollback boundary

Before the destructive migrations, roll back by redeploying the previous
artifact and environment contract. After catalog storage is dropped, rollback
is artifact-based: restore the protected pre-cutover PostgreSQL/CMS snapshot
and catalog evidence, then deploy the previous artifact. Do not recreate or
republish Platform Models by hand. A model-target change after cutover is a new
application release, never a CMS edit or environment override.
