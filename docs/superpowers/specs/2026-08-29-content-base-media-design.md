# Content Base Media and Media-Led Posts — Design

**Date:** 2026-08-29
**Status:** Approved product direction; ready for implementation

## Problem

The current implementation treats generated media as an attachment owned by a
Post. A Content Base can start image or video generation, but it does so by
creating a synthetic Post and then redirects the user into a large Post-level
"Creative assets" form. This creates the wrong product model:

- a durable image or video disappears conceptually behind one disposable Post;
- regenerating or deleting Post copy has unclear effects on its media;
- media cannot naturally become the starting point for several Posts;
- generated files are not presented as a browsable Content Base gallery;
- the form exposes implementation details such as model choice, aspect ratio,
  variation count, credit multipliers, and raw prompt controls before the core
  workflow is understandable;
- Post preview does not render the selected generated asset;
- research and generated-media lineage are not clearly visible in the Brain.

The result is a feature that technically generates files but does not form a
coherent content system.

## Product decision

The **Content Base owns media**. A Post may use one or more Content Base media
assets, and a media asset may be used by several Posts. Posts can be generated
with or without media.

```text
Content Base
├── research, ideas, facts, and relationships
├── visual direction
├── Media gallery
│   ├── Image
│   ├── Video
│   └── Derived variation
└── Posts
    └── references zero or more Media assets
```

Ownership and generation origin are separate:

- Every asset belongs to one Content Base.
- An asset generated while viewing a Post records that Post as its origin.
- The originating Post receives a usage link to the new asset.
- Deleting or regenerating the Post does not delete the asset.
- Deleting an asset is an explicit Content Base media action and must disclose
  any Posts that currently use it.

This gives the system strong semantic coupling between a Post and its visual
without coupling their lifecycles.

## Decision summary

| Decision | Choice |
|---|---|
| Canonical media owner | Content Base |
| Post relationship | Many-to-many `USES_MEDIA` reference |
| Post generation | Content Base only, or Content Base plus selected media |
| Media-first workflow | Every media card offers **Generate Post** |
| Post-first workflow | A Post offers **Create visual**; the result is saved to the Content Base and linked back to the Post |
| User input | Required visual type, optional exact on-media text, optional creative direction |
| Model selection | No model or provider selection in the product UI or request contract |
| Runtime routing | One server-owned deployment per media operation |
| Structured visuals | Application-rendered from a typed visual specification |
| Generative visuals | Provider-generated pixels; text overlays remain application-rendered |
| Provenance | Immutable brief, compiled prompt, sources, execution metadata, and lineage |
| Brain | Direct, explainable nodes and relationships; no claim reconciliation system |

## Core concepts

### Content Base

The durable source package for a content idea. It contains the research,
outline, key points, source material, visual direction, media gallery, and the
Posts derived from them.

### Media asset

A durable image, video, or derived variation owned by a Content Base. It has a
stable identity independent of any Post that created or uses it.

### Visual Brief

The small, user-understandable instruction that says what visual should be
created. It is a product concept, not a provider prompt and not model
configuration.

V1 fields:

| Field | Requirement | Notes |
|---|---|---|
| Media kind | Required | `image` or `video`; normally implied by the action the user chose |
| Visual type | Required | The communication form, such as infographic or illustration |
| On-media text | Optional | Exact text rendered into the media by Taicho, not by the image model |
| Creative direction | Optional | Tone, scene, visual metaphor, colors, or other human direction |

The server passes the Visual Brief and grounded Content Base to an LLM visual
director, which creates the detailed provider-ready prompt. That compiled
prompt, provider parameters, and provider response are derived system data and
are not exposed as required user inputs.

### Media usage

A link from a Post to a Media asset. It may record placement and order, but it
does not transfer ownership.

## Visual types

The user must choose a visual type. There is no silent "Auto" choice in V1.
This keeps the user's communication intent in control while allowing the
system to choose the provider deployment.

### Image visual types

| Type | Purpose | Rendering path |
|---|---|---|
| Editorial scene | A photographic or cinematic scene supporting the idea | Image generation |
| Illustration | Conceptual, artistic, or branded artwork | Image generation |
| Infographic | Structured facts, steps, or comparisons | Image generation |
| Diagram | Flow, timeline, hierarchy, process, or relationship | Image generation |
| Data chart | A chart backed by verified numeric data | Image generation |
| Quote/stat card | One quote, fact, or number with strong typography | Image generation + exact-text post-processing when requested |
| Meme | Recognizable setup with exact caption text | Image generation + exact-text post-processing when requested |
| Product showcase | Product/reference image with composed callouts | Image generation |

A carousel is a container of several visual assets, not a visual type. It is a
later capability.

### Video visual types

V1 may expose a deliberately smaller set:

| Type | Purpose |
|---|---|
| Cinematic clip | Short visual scene or B-roll derived from the Content Base |
| Explainer | A short sequence that explains an idea or process |
| Motion graphic | Animated typography, shapes, facts, or diagram elements |
| Product showcase | A focused demonstration or presentation of a product |

If the first implementation can reliably support only cinematic clips, expose
only that type. Do not display unavailable types.

## Three different kinds of text

The UI and data model must not collapse these fields:

- **Post copy** is the social caption or body of the Post.
- **On-media text** is exact text rendered visibly inside an image or video.
- **Alt text** describes the final asset for accessibility.

The image model must not be trusted to spell or position exact text. For memes,
infographics, diagrams, charts, quote cards, and other typographic visuals, the
application renders text through HTML/SVG/canvas or a server-side equivalent.
The language model may create a typed render specification, but the renderer
owns the final pixels and validates required data.

## User workflows

### Create media from a Content Base

1. User opens a Content Base and selects **Create visual**.
2. User chooses Image or Video and a required visual type.
3. User may enter exact on-media text and creative direction.
4. Taicho generates the asset asynchronously.
5. The asset appears in the Content Base Media gallery with its generation
   state and provenance.
6. From the asset card, the user may choose **Generate Post**.

No synthetic Post is created merely to host the generation.

### Generate a Post without media

The existing Content Base -> Generate Post flow remains valid. The generated
Post has no media usage links.

### Generate a Post from media

1. User selects **Generate Post** from a Media card, or selects media in the
   normal Generate Post flow.
2. Taicho sends the Content Base context, media provenance, and the actual
   asset pixels to a vision-capable Post-generation path.
3. The Post is generated around what is visibly present in the asset, not just
   around the prompt that once requested it.
4. Taicho stores `Post USES_MEDIA MediaAsset`.

The prompt alone is insufficient because generated pixels may differ from the
prompt.

### Create media from a Post

1. User selects **Create visual** while viewing a Post.
2. The Visual Brief is prefilled from the Post but remains editable.
3. The generated asset is stored in the parent Content Base Media gallery.
4. The asset records `originPostId` and the Post receives a media usage link.

Regenerating Post copy retains its media usage links unless the user explicitly
changes them. Deleting the Post removes the usage links, not the assets.

## UI design

### Content Base page

Add a first-class **Media** section beside the existing Posts section.

Each media card shows:

- the actual thumbnail or playable preview;
- visual type and media kind;
- a short human description;
- generation state when incomplete;
- source/lineage access;
- usage count or the Posts using it;
- actions: **Generate Post**, **Use in Post**, **Create variation**, and
  explicit delete.

The header may keep **Create image** and **Create video** shortcuts, but both
open the same compact Visual Brief dialog and generate directly under the
Content Base.

### Visual Brief dialog

V1 shows only:

1. visual type;
2. on-media text, when applicable;
3. optional creative direction;
4. Generate.

There is no model, provider, speed, "Auto", raw prompt, negative prompt, model
price multiplier, or deployment selector. Dimensions and layout may be inferred
from the intended destination and hidden behind a later Advanced section only
when users actually need them.

### Post page

Replace the large provider-oriented Creative assets panel with a smaller
**Media used by this Post** section:

- show the actual selected media in the Post preview;
- allow attaching an existing Content Base asset;
- allow creating a new visual through the compact Visual Brief dialog;
- allow detaching the Post's usage link without deleting the asset;
- link back to the canonical asset in the Content Base gallery.

## Why model selection and model gating exist today

The current implementation grew from a generic multi-model platform design.
It was intended to support:

- multiple model choices with "Fast", "Balanced", and other labels;
- an "Auto" resolver;
- different models for chat, content, outreach, and creative surfaces;
- capability checks such as image generation versus video generation;
- workspace model allowlists;
- operational switching through a signed CMS catalog;
- per-model credit multipliers;
- provider deployment lookup without exposing raw provider IDs.

For creative media today, that path is:

1. the UI fetches templates plus every eligible public model;
2. the request optionally submits `modelKey`;
3. the server fetches the platform catalog;
4. the resolver filters by the `creative` surface and a required capability;
5. the chosen catalog entry supplies the provider deployment ID and credit
   multiplier;
6. generation fails if no catalog entry survives the filters.

That is the "model gating": a generic policy layer decides whether an operation
may reach the configured provider. It solves a future multi-model marketplace
problem that the current product does not have. With one product-controlled
model per operation, the user makes no meaningful model decision, no price is
based on that decision, and the gate creates avoidable configuration and
failure modes.

## Model simplification decision

The content media domain will not know about selectable models.

### Remove from the content media product contract

- model picker and "Auto" from the UI;
- `modelKey` from media-generation requests;
- public `models[]` from media-template responses;
- creative-surface catalog lookup during a user request;
- workspace model allowlisting for content media;
- model capability filtering for content media;
- model-based credit multipliers and model-specific user messaging.

### Keep internally

The server still needs to know which provider endpoint executes an operation.
That is deployment plumbing, not a user-facing content concept.

V1 has one configured adapter target per supported operation:

```text
image generation -> configured image provider deployment
video generation -> configured video provider deployment
```

Every image visual type uses the configured image provider. Visual type changes
the LLM visual director's instructions, never the execution path. The provider
receives the resulting detailed composition prompt rather than a generic visual
type sentence or a raw Content Base dump. There is no deterministic image
renderer, local placeholder, or silent fallback; prompt generation, provider,
or storage failure is reported as a failed generation.

The deployment target is release-owned server configuration, validated at
startup. Provider credentials remain secrets. Changing the deployment is an
operator/deployment action and must not require changing a user's Content Base
or choosing a model in the UI.

If product usage must be metered, meter stable product operations such as one
image, one variation, or one second of video. Do not make a user's price depend
on an invisible model selection.

### Keep model identity as provenance only

Each completed generation records the actual provider, deployment/model ID,
model or API version when available, seed, and provider parameters. These
fields answer "how was this asset produced?" They are written by the provider
adapter after routing and are never accepted as a user choice.

The subsequent fixed-runtime cutover retired the broader platform model catalog
globally. Chat, Agents, Content, Outreach, and Cascade now share release-owned
language or media targets and retain provider/model identity only as execution
provenance.

## Data model

Names are illustrative; implementation should follow existing database naming
conventions.

### `content_media_generations`

| Field | Notes |
|---|---|
| `id`, `organization_id` | Identity and tenant boundary |
| `content_base_id` | Required canonical owner |
| `origin_post_id` | Nullable; Post from which the brief was started |
| `parent_asset_id` | Nullable; for variations/edits |
| `media_kind`, `visual_type` | Product-level intent |
| `visual_brief` | Immutable user brief snapshot |
| `compiled_prompt`, `negative_prompt` | Exact provider instructions |
| `provider`, `provider_deployment`, `provider_parameters` | Execution provenance, not product selection |
| `provider_request_id` | Provider job identity |
| `provider_status_url`, `provider_result_url`, `provider_cancel_url` | Exact URLs returned by the provider |
| `status`, `progress`, `error` | Async lifecycle |
| timestamps and creator | Audit fields |

Provider URLs must be persisted from the submission response and used exactly.
They must not be reconstructed from the requested deployment ID; providers may
canonicalize a submission onto a different queue route.

### `content_media_assets`

| Field | Notes |
|---|---|
| `id`, `organization_id`, `content_base_id` | Stable Content Base ownership |
| `generation_id`, `parent_asset_id` | Generation and derivation lineage |
| `media_kind`, `visual_type` | Product classification |
| file/storage metadata | Object key, MIME type, dimensions, duration, size |
| `description` | Human-readable description of the final asset |
| `alt_text` | Accessibility description |
| `metadata` | Output-specific immutable metadata |
| timestamps | Audit fields |

There is no globally "selected" asset on a Content Base. Selection is a Post
usage decision.

### `content_post_media`

| Field | Notes |
|---|---|
| `organization_id`, `post_id`, `asset_id` | Tenant-scoped many-to-many link |
| `placement`, `sort_order` | Optional presentation information |
| timestamps | Audit fields |

Unique key: `(organization_id, post_id, asset_id)`.

### Existing-data migration

- Backfill each draft-owned generation and asset to its Content Base through
  the existing Post/draft `ideaId` relationship.
- Preserve the old Post as `origin_post_id`.
- Create a Post-media usage link for previously selected assets.
- Preserve existing model/deployment fields as historical provenance.
- Remove required draft ownership only after the backfill is verified.

## Provenance and attribution

Every Media asset must make the following inspectable:

- human Visual Brief;
- Content Base and originating Post, if any;
- source research, facts, or graph entities used;
- exact compiled prompt and negative prompt;
- prompt-director and media-provider execution provenance;
- provider, actual deployment/model, parameters, seed, and generation time;
- parent asset and transformation chain;
- final description, tags, and alt text;
- creator and timestamps.

Provenance describes how the actual asset was produced. It does not turn raw
provider configuration into a normal user control.

## Brain representation

Write only direct, explainable relationships:

```text
ContentBase -HAS_MEDIA-> MediaAsset
ContentBase -HAS_POST-> Post
Post        -USES_MEDIA-> MediaAsset
MediaAsset  -DERIVED_FROM-> MediaAsset
MediaAsset  -GROUNDED_IN-> ResearchSource | Fact | Entity
Post        -GENERATED_FROM_MEDIA-> MediaAsset
```

Content Base research must also materialize the entities and relationships it
discovers, with source references. The Content Base and its generated media and
Posts should therefore be navigable in the Brain rather than existing as an
isolated publishing record.

No claim reconciliation, confidence-resolution workflow, inferred duplicate
merging, or ontology proposal system is required for V1. Store the grounded
facts and relationships that were actually used; add reconciliation only after
real conflicting-data cases justify it.

## API shape

The existing `idea` identifier may remain the internal Content Base identifier
during implementation.

- `GET /content/ideas/:contentBaseId/media` — gallery, active runs, and supported visual types
- `POST /content/ideas/:contentBaseId/media` — create from a Visual Brief
- `GET /content/media/runs/:runId` — reconcile/read generation state
- `POST /content/media/runs/:runId/cancel` — cancel through stored provider URL
- `POST /content/media/:assetId/posts` — generate a Post from the actual asset
- `POST /content/drafts/:postId/media-links` — attach an existing Base asset
- `DELETE /content/drafts/:postId/media-links/:assetId` — detach only
- `POST /content/drafts/:postId/media` — convenience Post-first creation; server resolves the parent Content Base and links the result

Generation requests contain the Visual Brief. They do not accept `modelKey`,
provider, deployment ID, price multiplier, or provider credentials.

## Failure language

Errors must describe the user operation and its actionable configuration:

- "Image generation is not configured for this environment."
- "Video generation is temporarily unavailable."
- "The provider accepted the request but its status could not be checked."

Do not expose generic policy errors such as "No allowed model can satisfy
creative with the required capabilities." The user did not choose a model and
cannot act on that message.

## Implementation slices

1. **Correct ownership and provider execution**
   - Add Content Base ownership and Post-media links.
   - Backfill existing assets.
   - Persist and use provider-returned queue URLs.
   - Route image/video operations directly through the server-owned provider
     adapter.

2. **Simplify the product contract**
   - Remove model choice/catalog data from content media API and UI.
   - Remove synthetic Posts from Content Base media generation.
   - Add the compact Visual Brief schema and dialog.

3. **Make media first-class**
   - Add the Content Base Media gallery.
   - Render used media in Post cards and Post preview.
   - Add attach, detach, media-first Generate Post, and Post-first Create visual.

4. **Add structured rendering and lineage**
   - Implement deterministic render specs for the reliable V1 visual types.
   - Record complete provenance.
   - Materialize the direct Brain nodes and relationships.

## Acceptance criteria

- Creating image or video media from a Content Base does not create a Post.
- The resulting media is visible in that Content Base's Media gallery.
- The generation UI contains no model/provider/Auto control.
- The media API accepts no user-provided model or deployment selection.
- Each supported operation uses one validated server-owned deployment.
- A user can create a text-only Post.
- A user can select an asset and generate a Post that uses the actual asset as
  vision input.
- A user can create media from a Post; the asset is owned by the Content Base
  and linked to the Post.
- Deleting or regenerating a Post does not delete its assets.
- Post previews and Post cards render their used media.
- On-media text is stored separately from Post copy and alt text.
- Structured visual text is rendered deterministically, not entrusted to an
  image model.
- Provider prompts, actual execution identity, source lineage, and render
  method are inspectable for every generated asset.
- Provider status/result/cancel URLs returned at submission are persisted and
  used without reconstruction.
- Content Base, Media, Post, sources, entities, and their direct relationships
  are visible in the Brain.
- Failures name the unavailable user operation instead of exposing model-policy
  terminology.

## Out of scope

- User-facing model marketplace or model comparison.
- Model-based pricing.
- Workspace-specific creative-model allowlists.
- Carousel authoring.
- Complex claim reconciliation or automatic entity merging.
- Full visual-layout editor.
- Deleting the broader platform catalog used by unrelated product surfaces.
