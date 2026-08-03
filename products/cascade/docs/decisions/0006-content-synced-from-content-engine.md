# ADR 0006 — Content is synced from the content engine, not authored in Cascade

**Status:** Accepted (product owner decision, July 2026)

## Context

Content (video, articles, posts) is produced continuously by the content engine (`products/content-generator`) and feeds every touchpoint: funnel emails, the newsletter queue, everything. The content landscape is still fragmented; full integration into Cascade may happen later, but not in this version.

## Decision

Cascade **pulls** content through a sync boundary and snapshots it into its own `assets` table (source id, type, title, url, topics, published date). Email `content` records reference `assets` in their slot fills. The sync is a scheduled or manually triggered pull — a workspace import of the content engine's repositories today, an HTTP API if products deploy separately. The interface lives in `products/cascade/data` so the transport can change without touching anything else.

The engine renders only from Cascade's own tables. Nothing on the hot path reads the content engine, Neo4j, or any foreign store.

## Consequences

- The hot path stays deterministic and self-contained; a content-engine outage degrades freshness, never sending.
- Per-asset performance becomes measurable (which video drives interest clicks), feeding both Cascade's optimizer and, eventually, the content engine's planning.
- The newsletter queue becomes mechanical: new published assets → new appended steps referencing them.
- Sync staleness is a real state; the validation gate must reject variants referencing assets that no longer resolve.
- If content production later moves into Cascade, only the sync implementation is replaced.
