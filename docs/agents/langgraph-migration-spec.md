# LangGraph → Mastra Migration Spec (8 background actions)

> **Historical (status 2026-07-21):** this migration is complete. All 8 actions
> now run as Mastra orchestrators dispatched by `packages/platform/agents/registry.ts`
> from the product API and streaming routes; Bree and the
> LangGraph service are gone. The model layer moved to OpenRouter — the
> `ANTHROPIC_API_KEY` / `claude-*` / `anthropic/` references below are superseded
> by `packages/platform/agents/model.ts` (`routerModel()`, OpenRouter + Qwen).
> Retained as the per-action behavior reference; not current setup guidance.

Compiled 2026-07-20 from the deleted Python service (`git show de2ac97^:graph/...`), the on-disk Bree workers, and the TS repositories. Ground truth for the Mastra migration — implementers work from THIS, not the Python.

## Shared facts

- Every action was a single LangGraph node, stateless (no checkpoints), dispatched by `action` string with an `action_payload`.
- All LLM calls: Anthropic via `model_name` (default `claude-sonnet-4-5-20250929`), structured output (Pydantic → migrate to Mastra `structuredOutput` zod schemas).
- Prompt preambles inject `{mission}{identity}{voice}` loaded from Neo4j `Settings {id:"global"}` via `packages/platform/settings/repository.ts` (`getSettings`, falls back to defaults).
- Env: `OPENROUTER_API_KEY` (fixed language runtime), `TAVILY_API_KEY` (do_research, research_lead), `OPENAI_API_KEY` (extract_topics embeddings only), and graph credentials.
- Historical calling chain: route → `createJob` → Bree `scheduleJob` → worker → LangGraph. Product routes now invoke the TypeScript orchestrators directly.

## Actions

### 1. do_research (chains → persist step)
- Payload: `{ source_ids?: string[]|null, time_range?: string }` (route sends `{ sourceIds, timeRange }`, default range `week` route-side / `day` node-side).
- Flow: pick sources (by ids | all enabled | none→combined active-topics query) → Tavily search per source (`topic:"news"`, `search_depth:"advanced"`, `time_range`, `max_results:5`, `include_raw_content:"markdown"`, `include_domains=[domain]` for website sources; search_term sources use their `url` field as query; content truncated 10 000 chars) → per-source LLM extraction (temp **0.3**) → persist.
- Extraction prompt: "Extract valuable research insights…" + mission/identity; focus: emerging trends, best practices, tools/frameworks, industry insights, content angles; per finding: concise title, 2–3 sentence summary, 3–5 lowercase-hyphenated tags, priority high|medium|low; "Extract up to 5 most valuable findings. Return an empty list if content is not relevant." User msg: `Source: {source_name}\n\nSearch Results:{search_results}`.
- Schema: `{ items: Array<{ title, content, tags: string[], priority: 'low'|'medium'|'high' }> }`.
- Persist per item: dedup by `sourceUrl` (skip existing); create `ResearchItem { id:'research-item-<uuid>', …, addedBy:'researcher_agent', status:'unprocessed' }` + `(:ResearchSource)-[:YIELDED]->(item)`; then link `(item)-[:COVERS_TOPIC]->(t:Topic{status:'active'})` where any tag ~ topic name (case-insensitive CONTAINS both ways).
- Reads: `getTopics(false)`, `getEnabledResearchSources()`, `getResearchSourceById(id)`, `researchItemExistsByUrl(url)` — all exist.

### 2. build_project_graph
- Payload: `{ project_id }`. Skip if `Project.processed` truthy.
- Prompt: entity extraction, 8 types (Framework, Database, Cloud, Language, AIComponent, Feature, Integration, BusinessValue), "Extract 8-20 entities", canonical names, explicit/strongly-implied only. User: `Project: {name}\n\nDescription: {description}`. Temp **0.3**.
- Schema: `{ entities: Array<{ name: string, type: <one of 8> }> }`.
- Writes per entity: dedup `MATCH (e:{Type} {name})` → found: `SET e.last_mentioned=datetime()`; else `CREATE (e:{Type} { id:'{type_lower}-<uuid>', name, first_mentioned:datetime(), last_mentioned:datetime() })`. Then typed rel `MERGE (p)-[r:{REL}]->(e) SET r.created_at=datetime()` — REL map: Framework→USES_FRAMEWORK, Database→USES_DATABASE, Cloud→DEPLOYED_ON, Language→WRITTEN_IN, AIComponent→IMPLEMENTS, Feature→HAS_FEATURE, Integration→INTEGRATES_WITH, BusinessValue→ACHIEVES. Finally `SET p.processed=true, p.processed_at=datetime(), p.entity_count=$count`.

### 3. generate_content_ideas
- Payload: `{ count?: number }` (default 5; slice result).
- Prompt: "expert content strategist" + mission/identity/voice; generate 3–5 ideas, format-agnostic, prioritize research coverage + gaps; user msg injects `{research_insights}{topics}{content_gaps}{high_performing_patterns}`. Temp **0.8**.
- Schema: `{ ideas: Array<{ title, description, rationale, priority: low|medium|high, source_topics: string[] }> }` (source_topics are topic NAMES → map to ids).
- Reads: recent research (14 days), `getTopics(false)`, content-gaps query, high-performing query (see gaps below).
- Write: `createContentIdea({title, description, rationale, priority, sourceTopicIds, sourceResearchIds})` — exists, exact.

### 4. generate_content_draft
- Payload: `{ idea_id, content_type ∈ video_script|blog_post|tweet_thread|linkedin_post }`. Guard: idea must be `status='refined'`.
- Four prompt+schema pairs (all inject mission/identity/voice):
  - video_script (temp 0.7): `{hook,intro,main_sections[],demo_notes[],conclusion,call_to_action,full_script}` → store `full_script`.
  - blog_post (temp 0.7, MDX with `<Callout>`, 1000–2000 words): `{title,meta_description,introduction,sections[],code_examples[],conclusion,full_content}` → `full_content`.
  - tweet_thread (temp 0.8, 5–10 tweets ≤280 chars): `{tweets[],thread_hook,full_thread}` → `full_thread`.
  - linkedin_post (temp 0.7, ≤1300 chars): `{hook,body,call_to_action,hashtags[],full_post}` → `full_post`.
- User templates inject `{title,description,outline,key_points,hook(=idea.rationale),citations,inner_links}` (video/blog) or `{title,description,key_points,hook,cta:"What do you think?"}` (tweet/linkedin).
- Reads: `getContentIdeaById(id)` (exists), related published content by shared topics (gap query).
- Write: `createContentDraft({ideaId,title,type,content,citations:[],innerLinks})` — exists. NOTE: TS version also sets idea.status='draft' (Python didn't) — KEEP the TS behavior, it's better.

### 5. refine_content_idea
- Payload: `{ idea_id }`. 400 if already refined.
- Prompt: "refine into a detailed actionable outline" + mission/identity/voice; user injects `{title,content_type,description,target_platform,rationale,research_context,related_content,source_topics}`. Temp **0.7**.
- Schema: `{ outline: string[], key_points: string[], suggested_citations: string[], inner_link_suggestions: string[], hook: string, call_to_action: string }`.
- Reads: `getContentIdeaById`, related content (gap), research items covering the idea's topics (gap: `MATCH (r:ResearchItem)-[:COVERS_TOPIC]->(t:Topic) WHERE t.id IN $ids RETURN DISTINCT r… LIMIT 10`).
- Write: `updateContentIdea(id, {status:'refined', outline, keyPoints, suggestedCitations})` — exists, exact. hook/cta/inner_link_suggestions NOT persisted (match Python).

### 6. extract_topics
- Payload: none used.
- Reads: `getTopics(true)` (all incl. dismissed, for dedup), entities-by-project-count aggregation (gap; AIComponent/Feature/BusinessValue only, weights 2.0/2.0/1.0, top 100).
- Prompt: "analyzing project entities to identify content topics", lists existing topic names ("DO NOT recreate"), "Generate 5-15 content topics". Temp **0.3**.
- Schema: `{ topics: Array<{ name (lowercase-hyphenated), display_name, description, source_entities: string[], confidence: number }> }`.
- Dedup: exact name (createTopic already MERGEs) + **semantic**: OpenAI `text-embedding-3-small`, cosine ≥ 0.85, vs existing topics AND within batch. MIGRATION DECISION: if `OPENAI_API_KEY` present use embeddings dedup; else name-dedup only (log a notice).
- Writes: `createTopic({name,displayName,description,source:'llm_extracted'})` (exists) + link DERIVED_FROM to entities (gap) + link COVERS_TOPIC from matching research (gap).

### 7. research_lead — ALREADY IN TS
- `products/outreach/agent/lead-research.ts` `runLeadResearch()` + `leadResearchAgent` + `storeLeadResearch()` are complete. Migration = the route (`leads/[id]/research`) stops scheduling Bree and calls this path (async via the job runner), then CHAINS qualify_lead.
- Known TS-vs-Python drift (accepted): delete-and-recreate research, drops competitor.recentNews, logs a research_completed activity.

### 8. qualify_lead — repos exist, orchestrator missing
- Payload: `{ lead_id }`.
- Flow: `getLeadById` + `getLeadResearch` → `getPersonas(true)`; if no active personas → status 'skipped', no write. Else per-persona LLM score (temp **0.2**), keep highest.
- Prompt: system injects mission/identity/voice + persona fields `{persona_name, persona_description, target_titles, company_size, funding_stages, target_domains, signals}`; rubric 4×0-25 (title fit, company fit, signals, mission alignment); "be conservative, 80+ only with strong evidence". User: lead `{name,title,company,location}` + research `{industry, company_summary, talking_points, outreach_angle}`.
- Schema: `{ score: number (0-100 int), notes: string }`.
- Writes (best match): `createLeadQualification(leadId, {matchedPersonaId, matchedPersonaName, score, notes})` + `updateLeadPriorityByScore(leadId, score)` — both exist, exact. Does NOT set Lead.status.

## Repository gaps to implement (contract — exact names)

In `products/content-generator/data/project-repository.ts`:
- `getProjectProcessingState(id): Promise<{ processed: boolean; entityCount: number } | null>`
- `storeProjectEntity(projectId, entity: { name, type }): Promise<void>` (dedup + typed rel per REL map)
- `markProjectProcessed(projectId, entityCount): Promise<void>`
- `getEntitiesByProjectCount(): Promise<Array<{ entityType, name, id, projectNames: string[], projectCount: number }>>` (AIComponent|Feature|BusinessValue only)

In `products/content-generator/data/research-repository.ts`:
- `createResearchItemFromAgent(input): Promise<{ id, deduped: boolean }>` (URL dedup + addedBy 'researcher_agent' + YIELDED)
- `linkResearchToMatchingTopics(itemId, tags: string[]): Promise<void>`
- `getRecentResearchItems(days: number): Promise<ResearchItem[]>`
- `getResearchItemsByTopicIds(topicIds: string[], limit?): Promise<Array<{id,title,content,sourceUrl}>>`

In `products/content-generator/data/topic-repository.ts`:
- `linkTopicToEntities(topicId, entityNames: string[]): Promise<void>` (DERIVED_FROM)
- `linkTopicToResearch(topicId, topicName): Promise<void>` (COVERS_TOPIC by tag/content/title CONTAINS)

In `products/content-generator/data/content-repository.ts`:
- `queryContentGaps(limit = 10): Promise<Array<{ topicId, topicName, researchCount, suggestedPriority }>>`
- `queryHighPerformingContent(limit = 5): Promise<Array<{ id, title, type, performanceLevel, insights, topics: string[] }>>`
- `queryRelatedPublishedContent(topicIds: string[], limit = 5): Promise<Array<{ id, title, type, publishedUrl }>>`

Cypher for each is quoted in the per-action sections above / matches the Python verbatim (labels, properties, and relationship names in existing TS repos already match the Python graph exactly).
