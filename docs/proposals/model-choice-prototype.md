# Retired platform model-choice prototype

Status: retired by the fixed-runtime cutover on 2026-08-29.

The prototype placed language and creative model availability in Payload CMS,
materialized a signed catalog in Taicho, and exposed safe model choices in
product surfaces. That ownership boundary is no longer part of the product.

Language generation now uses the release-owned target in
`packages/platform/agents/model.ts`. Creative generation uses the media-kind
targets in `products/content-generator/media/runtime.ts`. Provider credentials
remain runtime secrets, actual provider/model identity is recorded only as
execution provenance, and clients cannot choose or override either target.

Payload CMS continues to own CRM import-provider configuration. It no longer
contains Platform Models, publishes a model catalog, signs catalog responses,
or notifies application refresh routes.

See `docs/operations/fixed-model-runtime-cutover.md` for evidence export,
migration order, rollout, rollback, and retired-secret revocation.
