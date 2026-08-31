/**
 * Vector-scored dimension research (RESEARCH_SCORING=vector).
 *
 * Owner-directed redesign (2026-08-18): instead of the LLM reading capped
 * page snippets and judging fit, the corpus is scraped deep, chunked, and
 * embedded; every fit dimension carries ~10 positive and ~10 negative anchor
 * paragraphs (LLM-generated once from the dimension definition), and the
 * match score is the contrastive margin — similarity to the positive anchor
 * set minus similarity to the negative set. Vectors retrieve and score; the
 * LLM's only remaining jobs are anchor generation (cached) and hard-exclusion
 * rules (delegated to the classic evaluator for the few dimensions that
 * define one). Observations quote the winning chunks verbatim — receipts,
 * not prose.
 *
 * Timing dimensions keep the classic dated-signal path untouched: decay
 * arithmetic needs literal dates, which vectors do not carry.
 */
import { z } from 'zod';
import { createLogger, traceable } from '@content-automation/observability';
import { searchTavily } from './tavily-tool';
import {
  defaultCompleteJson,
  researchDimensions as researchDimensionsClassic,
  type DimensionResearchDeps,
  type ResearchEntity,
} from './dimension-research';
import { buildDimensionQuery } from './dimension-research';
import { evaluateFitMatches as evaluateFitMatchesClassic } from './match-evaluator';
import { effectiveConfidence } from '../domain/scoring';
import type {
  DimensionDefinition,
  DimensionMatch,
  MatchClassification,
  ObservationRecord,
} from '../domain/qualification';

const log = createLogger('vector-research');

export function vectorScoringEnabled(): boolean {
  return process.env.RESEARCH_SCORING?.trim() === 'vector';
}

/**
 * Vector-mode qualification thresholds. Vector confidence is evidence-honest
 * (median ~0.6 where the classic LLM asserted ~0.85), so effective scores run
 * ~30% lower for the same underlying fit; thresholds shift accordingly.
 * Owner decision 2026-08-18: keep confidence strict, adjust thresholds —
 * classic-path thresholds stay untouched.
 */
export const VECTOR_THRESHOLDS = {
  icpMinimum: 50,
  personaMinimum: 46,
  lowConfidenceCutoff: 0.35,
} as const;

// ---------------------------------------------------------------------------
// Embeddings (OpenAI text-embedding-3-small, batched)
// ---------------------------------------------------------------------------

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBED_BATCH = 96;

/** Belt-and-braces cap: no single embedding input may exceed this. */
const EMBED_INPUT_MAX_CHARS = 8_000;

async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('Vector research requires OPENAI_API_KEY.');
  const safeTexts = texts.map((text) => text.slice(0, EMBED_INPUT_MAX_CHARS));
  const vectors: number[][] = [];
  for (let start = 0; start < safeTexts.length; start += EMBED_BATCH) {
    const batch = safeTexts.slice(start, start + EMBED_BATCH);
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`Embeddings API returned ${response.status}: ${detail}`);
    }
    const payload = (await response.json()) as { data: Array<{ index: number; embedding: number[] }> };
    if (payload.data.length !== batch.length) {
      throw new Error(`Embeddings API returned ${payload.data.length} vectors for ${batch.length} inputs.`);
    }
    const ordered = [...payload.data].sort((a, b) => a.index - b.index);
    for (const row of ordered) vectors.push(row.embedding);
  }
  return vectors;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Anchor generation (10 positive + 10 negative paragraphs per fit dimension)
// ---------------------------------------------------------------------------

const anchorSchema = z.object({
  positives: z.array(z.string()).min(6).max(12),
  negatives: z.array(z.string()).min(6).max(12),
});

export interface DimensionAnchors {
  positives: string[];
  negatives: string[];
  positiveVectors: number[][];
  negativeVectors: number[][];
}

/** Process-lifetime cache: anchors are stable per dimension definition. */
const anchorCache = new Map<string, Promise<DimensionAnchors>>();

function anchorCacheKey(dim: DimensionDefinition): string {
  return `${dim.key}::${dim.idealValue ?? ''}::${dim.researchInstruction ?? ''}`;
}

async function generateAnchors(
  dim: DimensionDefinition,
  completeJson: NonNullable<DimensionResearchDeps['completeJson']>,
): Promise<DimensionAnchors> {
  const prompt = `Dimension: ${dim.name} (key: ${dim.key})
Research instruction: ${dim.researchInstruction}
Ideal value: ${dim.idealValue ?? '(not specified)'}

Write anchor paragraphs for embedding-based evidence retrieval about this dimension.

- "positives": 10 short paragraphs (1-3 sentences each) that sound like real web evidence STRONGLY SATISFYING the ideal value. Vary the wording, industry, and phrasing; write like news articles, LinkedIn profiles, and company pages actually read.
- "negatives": 10 short paragraphs of realistic evidence showing the OPPOSITE or ABSENCE of the ideal value — including near-miss phrasing that mentions the topic but contradicts the ideal.

Use generic placeholders like "the company" / "the executive" — never real names.`;
  const raw = await completeJson({
    schemaName: 'dimension_anchors',
    schema: anchorSchema,
    system: 'Generate contrastive anchor paragraphs for semantic retrieval. Return only JSON.',
    prompt,
  });
  const parsed = anchorSchema.parse(raw);
  const vectors = await embedTexts([...parsed.positives, ...parsed.negatives]);
  return {
    positives: parsed.positives,
    negatives: parsed.negatives,
    positiveVectors: vectors.slice(0, parsed.positives.length),
    negativeVectors: vectors.slice(parsed.positives.length),
  };
}

export function dimensionAnchors(
  dim: DimensionDefinition,
  completeJson: NonNullable<DimensionResearchDeps['completeJson']> = defaultCompleteJson,
): Promise<DimensionAnchors> {
  const key = anchorCacheKey(dim);
  let cached = anchorCache.get(key);
  if (!cached) {
    cached = generateAnchors(dim, completeJson).catch((error) => {
      anchorCache.delete(key);
      throw error;
    });
    anchorCache.set(key, cached);
  }
  return cached;
}

// ---------------------------------------------------------------------------
// Corpus: deep scrape → chunk → dedupe
// ---------------------------------------------------------------------------

export interface CorpusChunk {
  text: string;
  url: string;
  title: string;
}

const CHUNK_MIN_CHARS = 200;
const CHUNK_MAX_CHARS = 1_200;
const MAX_CHUNKS_PER_RUN = 800;

export function chunkContent(content: string, url: string, title: string): CorpusChunk[] {
  const chunks: CorpusChunk[] = [];
  const paragraphs = content
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= CHUNK_MIN_CHARS);
  for (const paragraph of paragraphs) {
    if (paragraph.length <= CHUNK_MAX_CHARS) {
      chunks.push({ text: paragraph, url, title });
      continue;
    }
    // Split oversized paragraphs at sentence boundaries. Markdown from
    // structure-less pages (link farms, tables, walls of text) can be one
    // enormous "sentence", so every emitted chunk is hard-capped regardless.
    let current = '';
    for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
      if (current.length + sentence.length + 1 > CHUNK_MAX_CHARS && current.length >= CHUNK_MIN_CHARS) {
        chunks.push({ text: current.trim().slice(0, CHUNK_MAX_CHARS), url, title });
        current = '';
      }
      current += `${sentence} `;
    }
    if (current.trim().length >= CHUNK_MIN_CHARS) {
      chunks.push({ text: current.trim().slice(0, CHUNK_MAX_CHARS), url, title });
    }
  }
  // Prose filter: drop chunks that are mostly links/markup/symbols — they
  // carry no evidence, pollute retrieval, and waste embedding tokens. URLs
  // and link syntax are stripped first so link farms cannot pass as prose.
  return chunks.filter((chunk) => {
    const stripped = chunk.text
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[|#*_`>[\]()]/g, ' ');
    const letters = (stripped.match(/[a-zA-Z]/g) ?? []).length;
    return stripped.trim().length >= CHUNK_MIN_CHARS / 2 && letters / chunk.text.length >= 0.4;
  });
}

function dedupeChunks(chunks: CorpusChunk[]): CorpusChunk[] {
  const seen = new Set<string>();
  const out: CorpusChunk[] = [];
  for (const chunk of chunks) {
    const key = chunk.text.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 400);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(chunk);
  }
  return out.slice(0, MAX_CHUNKS_PER_RUN);
}

// ---------------------------------------------------------------------------
// Contrastive scoring
// ---------------------------------------------------------------------------

/** Sigmoid over the positive-negative margin; temperature tuned via benchmark. */
const MARGIN_TEMPERATURE = 0.05;
const TOP_CHUNKS_PER_DIMENSION = 3;
/** Below this best-positive similarity the corpus simply isn't about the topic. */
const MIN_TOPICAL_SIMILARITY = 0.30;

export interface DimensionScore {
  dimensionKey: string;
  matchScore: number;
  confidence: number;
  topChunks: Array<CorpusChunk & { margin: number; simPos: number }>;
}

export function scoreDimension(
  dim: DimensionDefinition,
  anchors: DimensionAnchors,
  chunks: CorpusChunk[],
  chunkVectors: number[][],
): DimensionScore {
  const scored = chunks.map((chunk, index) => {
    const vector = chunkVectors[index];
    let simPos = -1;
    for (const anchor of anchors.positiveVectors) simPos = Math.max(simPos, cosine(vector, anchor));
    let simNeg = -1;
    for (const anchor of anchors.negativeVectors) simNeg = Math.max(simNeg, cosine(vector, anchor));
    return { ...chunk, margin: simPos - simNeg, simPos };
  });
  const topical = scored.filter((c) => c.simPos >= MIN_TOPICAL_SIMILARITY);
  topical.sort((a, b) => b.margin - a.margin);
  const top = topical.slice(0, TOP_CHUNKS_PER_DIMENSION);
  if (top.length === 0) {
    return { dimensionKey: dim.key, matchScore: 0, confidence: 0, topChunks: [] };
  }
  const meanMargin = top.reduce((sum, c) => sum + c.margin, 0) / top.length;
  const matchScore = 1 / (1 + Math.exp(-meanMargin / MARGIN_TEMPERATURE));
  // Evidence confidence tracks how squarely the corpus addresses the topic.
  // Calibrated against the classic LLM evaluator (benchmark 2026-08-18):
  // typical on-topic best similarities land 0.40-0.55 with
  // text-embedding-3-small and should map near the classic ~0.85.
  const bestSim = top[0].simPos;
  const confidence = Math.min(0.95, Math.max(0.2, 0.25 + (bestSim - MIN_TOPICAL_SIMILARITY) * 3));
  return { dimensionKey: dim.key, matchScore, confidence, topChunks: top };
}

function classify(matchScore: number): MatchClassification {
  if (matchScore >= 0.8) return 'strong_match';
  if (matchScore >= 0.5) return 'partial_match';
  if (matchScore >= 0.25) return 'weak_match';
  return 'mismatch';
}

// ---------------------------------------------------------------------------
// Summary polish (LLM as writer over already-scored evidence)
// ---------------------------------------------------------------------------

const polishSchema = z.object({
  summaries: z.array(z.object({ dimensionKey: z.string(), summary: z.string() })),
});

async function polishObservations(
  records: Array<Omit<ObservationRecord, 'id'>>,
  fitDims: DimensionDefinition[],
  scores: Map<string, DimensionScore>,
  entity: ResearchEntity,
  completeJson: NonNullable<DimensionResearchDeps['completeJson']>,
): Promise<void> {
  const withEvidence = fitDims.filter((dim) => (scores.get(dim.key)?.topChunks.length ?? 0) > 0);
  if (withEvidence.length === 0) return;
  const blocks = withEvidence.map((dim) => {
    const score = scores.get(dim.key)!;
    const chunkLines = score.topChunks
      .map((c) => `  - [margin ${c.margin.toFixed(3)}] "${c.text.slice(0, 350)}" (${c.title})`)
      .join('\n');
    return `### ${dim.key}\nDimension: ${dim.name} — ${dim.researchInstruction}\nMatched evidence:\n${chunkLines}`;
  }).join('\n\n');
  const raw = await completeJson({
    schemaName: 'observation_summaries',
    schema: polishSchema,
    system:
      'Rewrite pre-scored research evidence into short factual observations. You are a writer, not a judge: never grade fit, never add facts beyond the quoted evidence. Return only JSON.',
    prompt: `Subject: ${entity.kind === 'account' ? `company ${entity.name}` : `${entity.name}${entity.title ? `, ${entity.title}` : ''}${entity.company ? ` at ${entity.company}` : ''}`}.

For each dimension below, write a 1-2 sentence factual observation grounded strictly in its matched evidence quotes.

${blocks}`,
  });
  const parsed = polishSchema.parse(raw);
  const summaries = new Map(parsed.summaries.map((s) => [s.dimensionKey, s.summary.trim()]));
  for (const record of records) {
    const summary = summaries.get(record.dimensionKey);
    if (summary && record.observedValue !== 'No evidence found.') {
      record.observedValue = summary;
    }
  }
}

// ---------------------------------------------------------------------------
// Run state: research() computes scores; evaluate() reads them back.
// ---------------------------------------------------------------------------

// Account and prospect dimension keys are disjoint sets, so one map per run
// holds both entities' scores. Bounded: oldest runs evicted past 50.
const runScores = new Map<string, Map<string, DimensionScore>>();
const RUN_SCORE_LIMIT = 50;

function rememberScores(runId: string, scores: Map<string, DimensionScore>): void {
  const existing = runScores.get(runId);
  if (existing) {
    for (const [key, value] of scores) existing.set(key, value);
  } else {
    runScores.set(runId, scores);
  }
  while (runScores.size > RUN_SCORE_LIMIT) {
    const oldest = runScores.keys().next().value;
    if (oldest === undefined) break;
    runScores.delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// Public API — drop-in replacements for the classic pair
// ---------------------------------------------------------------------------

export async function researchDimensionsVector(
  dims: DimensionDefinition[],
  entity: ResearchEntity,
  runId: string,
  now: Date,
  deps: DimensionResearchDeps = {},
): Promise<Array<Omit<ObservationRecord, 'id'>>> {
  const fitDims = dims.filter((d) => d.dimensionType === 'fit');
  const timingDims = dims.filter((d) => d.dimensionType === 'timing');
  const search = deps.search ?? searchTavily;
  const completeJson = deps.completeJson ?? defaultCompleteJson;
  const emitActivity = deps.onActivity ?? (() => undefined);

  // Timing keeps the classic dated-signal path. Backfill any unexpectedly
  // omitted dimension so the final scorecard remains complete and explicitly
  // represents unsupported timing criteria.
  const timingRecords = timingDims.length > 0
    ? await researchDimensionsClassic(timingDims, entity, runId, now, deps)
    : [];
  const timingKeys = new Set(timingRecords.map((r) => r.dimensionKey));
  for (const dim of timingDims) {
    if (timingKeys.has(dim.key)) continue;
    timingRecords.push({
      dimensionKey: dim.key,
      shape: 'signals',
      signals: [],
      evidence: [],
      confidence: 0,
      researchedAt: now.toISOString(),
      runId,
    });
  }
  if (fitDims.length === 0) return timingRecords;

  const run = traceable(async () => {
    // 1. Deep scrape: one search per fit dimension, full content, pooled corpus.
    const searches = await Promise.all(
      fitDims.map(async (dim) => {
        const query = buildDimensionQuery(dim, entity);
        const searchStartedAt = Date.now();
        emitActivity({
          type: 'query_started',
          scope: entity.kind === 'prospect' ? 'person' : 'account',
          occurredAt: new Date().toISOString(),
          dimensionKey: dim.key,
          dimensionName: dim.name,
          query,
        });
        try {
          const result = await search(
            { topic: 'company', query, maxResults: 4, fullContent: true },
            AbortSignal.timeout(180_000),
            { runId, entityKind: entity.kind, entityId: entity.id, dimensionKey: dim.key },
          );
          const pages = result.results.map((page) => ({
            title: page.title,
            url: page.url,
            contentPreview: page.content.trim().slice(0, 1_200),
            status: page.extractionStatus ?? (page.content.trim() ? 'snippet' as const : 'failed' as const),
            ...(page.extractionError ? { error: page.extractionError } : {}),
          }));
          emitActivity({
            type: 'query_completed',
            scope: entity.kind === 'prospect' ? 'person' : 'account',
            occurredAt: new Date().toISOString(),
            dimensionKey: dim.key,
            dimensionName: dim.name,
            query,
            pagesFound: result.telemetry?.pagesFound ?? result.results.length,
            pagesRead: result.telemetry?.pagesRead ?? pages.filter((page) => page.status !== 'failed').length,
            pagesFailed: result.telemetry?.pagesFailed ?? pages.filter((page) => page.status === 'failed').length,
            durationMs: result.telemetry?.durationMs ?? Date.now() - searchStartedAt,
            pages,
          });
          return result.results;
        } catch (error) {
          log.warn('vector_research.search_failed', { dimension: dim.key, error: String(error) });
          emitActivity({
            type: 'query_failed',
            scope: entity.kind === 'prospect' ? 'person' : 'account',
            occurredAt: new Date().toISOString(),
            dimensionKey: dim.key,
            dimensionName: dim.name,
            query,
            pagesFound: 0,
            pagesRead: 0,
            pagesFailed: 0,
            durationMs: Date.now() - searchStartedAt,
            error: error instanceof Error ? error.message : String(error),
          });
          return [];
        }
      }),
    );
    const sourceDocumentsByDimension = new Map(fitDims.map((dimension, index) => [
      dimension.key,
      searches[index]
        .filter(({ url, content }) => url.trim() && content.trim())
        .map(({ url, title, content, publishedDate }) => ({
          url,
          title,
          content: content.slice(0, 12_000),
          publishedDate: publishedDate ?? null,
        })),
    ]));
    const rawChunks = searches
      .flat()
      .flatMap((result) => chunkContent(result.content, result.url, result.title));
    const chunks = dedupeChunks(rawChunks);
    if (chunks.length === 0) {
      log.warn('vector_research.empty_corpus', { entity: entity.name });
    }

    const synthesisStartedAt = Date.now();
    emitActivity({
      type: 'synthesis_started',
      scope: entity.kind === 'prospect' ? 'person' : 'account',
      occurredAt: new Date().toISOString(),
    });

    // 2. Anchors (cached) + embeddings. Bounded-parallel with one retry;
    // a dimension whose anchors cannot be generated degrades to a
    // no-evidence observation instead of aborting the whole research.
    const anchorsByDim = new Map<string, DimensionAnchors>();
    const anchorStarted = Date.now();
    const queue = [...fitDims];
    const workers = Array.from({ length: 3 }, async () => {
      for (let dim = queue.shift(); dim; dim = queue.shift()) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            anchorsByDim.set(dim.key, await dimensionAnchors(dim, completeJson));
            break;
          } catch (error) {
            if (attempt === 1) {
              log.warn('vector_research.anchors_failed', { dimension: dim.key, error: String(error) });
            }
          }
        }
      }
    });
    await Promise.all(workers);
    log.info('vector_research.anchors_ready', {
      dimensions: fitDims.length,
      generated: anchorsByDim.size,
      duration_ms: Date.now() - anchorStarted,
    });
    const chunkVectors = chunks.length > 0 ? await embedTexts(chunks.map((c) => c.text)) : [];

    // 3. Contrastive scoring per dimension.
    const scores = new Map<string, DimensionScore>();
    const records: Array<Omit<ObservationRecord, 'id'>> = [];
    const researchedAt = now.toISOString();
    for (const dim of fitDims) {
      const anchors = anchorsByDim.get(dim.key);
      const score = anchors
        ? scoreDimension(dim, anchors, chunks, chunkVectors)
        : { dimensionKey: dim.key, matchScore: 0, confidence: 0, topChunks: [] };
      scores.set(dim.key, score);
      const hasEvidence = score.topChunks.length > 0;
      records.push({
        dimensionKey: dim.key,
        shape: 'prose',
        observedValue: hasEvidence
          ? score.topChunks.map((c) => `"${c.text.slice(0, 400)}" — ${c.title}`).join('\n')
          : 'No evidence found.',
        evidence: score.topChunks.map((c) => c.url),
        sourceDocuments: (sourceDocumentsByDimension.get(dim.key) ?? [])
          .filter(({ url }) => score.topChunks.some((chunk) => chunk.url === url)),
        confidence: hasEvidence ? score.confidence : 0,
        researchedAt,
        runId,
      });
    }

    // 4. Summary polish: one LLM call rewrites the scored evidence into prose
    // observations. The LLM is a writer here, not a judge — scores are
    // already fixed in vector space. Failure keeps the verbatim extracts.
    try {
      await polishObservations(records, fitDims, scores, entity, completeJson);
    } catch (error) {
      log.warn('vector_research.polish_failed', { entity: entity.name, error: String(error) });
    }
    rememberScores(runId, scores);
    log.info('vector_research.completed', {
      entity: entity.name,
      chunks: chunks.length,
      dimensions: fitDims.length,
    });
    emitActivity({
      type: 'synthesis_completed',
      scope: entity.kind === 'prospect' ? 'person' : 'account',
      occurredAt: new Date().toISOString(),
      durationMs: Date.now() - synthesisStartedAt,
      criteriaTotal: fitDims.length,
      criteriaCompleted: records.length,
      criteriaWithoutEvidence: records.filter((record) => record.confidence <= 0).length,
    });
    return records;
  }, {
    name: 'research.vector',
    kind: 'scoring',
    attributes: {
      'taicho.research.mode': 'vector',
      'taicho.research.entity_kind': entity.kind,
      'taicho.research.dimension_count': fitDims.length,
    },
  })();

  return [...(await run), ...timingRecords];
}

/**
 * Match evaluation for vector mode. Each observation carries the runId that
 * produced it, which is the key into the in-process score store — so this is
 * a drop-in for the classic evaluator with the same signature. Dimensions
 * with a hard-exclusion rule, and observations whose scores are not in memory
 * (older runs still inside their freshness window), fall back to the classic
 * LLM evaluator.
 */
export async function evaluateFitMatchesVector(
  dims: DimensionDefinition[],
  observations: ObservationRecord[],
  now: Date,
): Promise<DimensionMatch[]> {
  const obsByKey = new Map(observations.map((o) => [o.dimensionKey, o]));
  const vectorDims: DimensionDefinition[] = [];
  const ruleDims: DimensionDefinition[] = [];
  const insufficientDims: DimensionDefinition[] = [];
  for (const dim of dims.filter((d) => d.dimensionType === 'fit')) {
    const obs = obsByKey.get(dim.key);
    if (!obs || obs.confidence <= 0 || /^no evidence found\b/i.test(obs.observedValue?.trim() ?? '')) {
      insufficientDims.push(dim);
      continue;
    }
    const score = obs.runId ? runScores.get(obs.runId)?.get(dim.key) : undefined;
    if (dim.hardExclusionRule != null || !score) ruleDims.push(dim);
    else vectorDims.push(dim);
  }

  const matches: DimensionMatch[] = insufficientDims.map((dim) => ({
    dimensionKey: dim.key,
    matchScore: 0,
    effectiveMatch: 0,
    classification: 'insufficient_evidence',
    hardExclusion: false,
    confidence: 0,
  }));
  for (const dim of vectorDims) {
    const obs = obsByKey.get(dim.key)!;
    const score = runScores.get(obs.runId!)!.get(dim.key)!;
    const confidence = effectiveConfidence(obs.confidence, obs.researchedAt, dim.freshnessWindowDays, now);
    matches.push({
      dimensionKey: dim.key,
      matchScore: score.matchScore,
      effectiveMatch: score.matchScore * confidence,
      classification: classify(score.matchScore),
      hardExclusion: false,
      confidence,
    });
  }
  if (ruleDims.length > 0) {
    matches.push(...await evaluateFitMatchesClassic(ruleDims, observations, now));
  }
  return matches;
}
