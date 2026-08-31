import { stableKnowledgeId, type KnowledgeRun } from '../domain';
import type { SourceAdapter } from '../ingestion/source-adapter';
import { normalizeSourceDocument } from '../ingestion/normalize';
import type { KnowledgeRepository } from '../repository';
import type { CompiledKnowledgeRegistry } from '../registry/types';
import { compileExtractionProfile } from './profile';
import { resolveExtractionCandidates } from './resolver';
import type { ExtractionChunk, ExtractorAdapter } from './types';

export function chunkForExtraction(content: string, maximumCharacters = 4_000, overlap = 300): ExtractionChunk[] {
  if (maximumCharacters < 500 || overlap < 0 || overlap >= maximumCharacters) throw new Error('Invalid extraction chunk settings.');
  const chunks: ExtractionChunk[] = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(content.length, start + maximumCharacters);
    if (end < content.length) {
      const boundary = Math.max(content.lastIndexOf('\n', end), content.lastIndexOf('. ', end));
      if (boundary > start + maximumCharacters / 2) end = boundary + 1;
    }
    chunks.push({ id: `chunk_${chunks.length}`, text: content.slice(start, end), start, end });
    if (end === content.length) break;
    start = end - overlap;
  }
  return chunks;
}

export async function runExtractionPipeline<I>(input: {
  adapter: SourceAdapter<I>;
  adapterInput: I;
  extractor: ExtractorAdapter;
  profileKey: string;
  registry: CompiledKnowledgeRegistry;
  repository: KnowledgeRepository;
  maxChunks?: number;
  signal?: AbortSignal;
}) {
  const document = normalizeSourceDocument(await input.adapter.load(input.adapterInput));
  const initialSource = await input.repository.upsertSource(document);
  const { revision, source, created: revisionCreated } = await input.repository.putSourceRevision({
    sourceId: initialSource.id,
    content: document.content,
    contentHash: document.contentHash,
    language: document.language,
    capturedAt: document.capturedAt,
    metadata: document.metadata,
  });
  const cached = await input.repository.findSuccessfulExtraction({ revisionId: revision.id, registryHash: input.registry.hash, profileKey: input.profileKey, adapterKey: input.extractor.key, adapterVersion: input.extractor.version });
  if (cached) {
    const entityIds = new Set(cached.claims.flatMap((claim) => [claim.subjectEntityId, ...(claim.object.kind === 'entity' ? [claim.object.entityId] : [])]));
    const entities = (await Promise.all([...entityIds].map((id) => input.repository.getEntity(id)))).filter((entity): entity is NonNullable<typeof entity> => !!entity);
    return {
      source,
      revision,
      revisionCreated,
      run: cached.run,
      candidates: { entities: [], claims: [], warnings: ['Reused the successful extraction for this unchanged revision and extractor version.'] },
      claims: [],
      entities,
      reviewRequired: [],
      reconciled: { claims: cached.claims, created: 0, unchanged: cached.claims.length, superseded: 0 },
      replayed: true,
    };
  }
  const startedAt = new Date().toISOString();
  const runId = stableKnowledgeId('run', input.repository.organizationId, 'extraction', revision.id, input.registry.hash, input.profileKey, input.extractor.key, input.extractor.version);
  const run = await input.repository.recordRun({ id: runId, kind: 'extraction', revisionId: revision.id, registryHash: input.registry.hash, profileKey: input.profileKey, adapterKey: input.extractor.key, adapterVersion: input.extractor.version, status: 'running', startedAt, metrics: {} });
  try {
    const schema = compileExtractionProfile(input.registry, [input.profileKey]);
    const chunks = chunkForExtraction(document.content).slice(0, input.maxChunks ?? 40);
    const candidates = await input.extractor.extract({ chunks, schema, signal: input.signal });
    const resolved = await resolveExtractionCandidates({ candidates, registry: input.registry, repository: input.repository, revisionId: revision.id });
    const reconciled = await input.repository.reconcileClaims({ ownerProfile: input.profileKey, revisionId: revision.id, extractionVersion: `${input.extractor.key}@${input.extractor.version}`, claims: resolved.claims });
    const completedAt = new Date().toISOString();
    const completed: KnowledgeRun = await input.repository.recordRun({ ...run, status: 'succeeded', completedAt, metrics: { chunks: chunks.length, candidates: candidates.claims.length, accepted: reconciled.claims.length, reviewRequired: resolved.reviewRequired.length } });
    return { source, revision, revisionCreated, run: completed, candidates, ...resolved, reconciled, replayed: false };
  } catch (error) {
    await input.repository.recordRun({ ...run, status: 'failed', completedAt: new Date().toISOString(), metrics: {} });
    throw error;
  }
}
