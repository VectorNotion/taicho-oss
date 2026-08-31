/**
 * Pass 2 of the extraction thread: typing against the ontology.
 *
 * The model extracts with a free type phrase; this module matches each item
 * against the organization's runtime type index (module types + learned
 * types). Exact and alias matches are settled by name normalization; the
 * remainder is settled by definition-embedding similarity. Anything no type
 * fits stays in the graph under its generic core kind and is recorded as a
 * type candidate — the raw material the curation pass learns new types from.
 */
import {
  baseEntityKinds,
  cosineSimilarity,
  defaultEmbedTexts,
  normalizeEntityName,
  type BaseEntityKind,
  type CompiledKnowledgeRegistry,
  type EmbedTexts,
} from '@content-automation/knowledge';

export interface RawExtractedEntity {
  name: string;
  /** Free type phrase from the model — a registered key, its label, or a proposal. */
  type: string;
  kind: BaseEntityKind;
  definition: string;
}

export interface TypedExtractedEntity {
  name: string;
  typeKey: string;
  definition: string;
  /** Present when no registered type fit: this observation becomes a type candidate. */
  miss?: { proposedTypeName: string; kind: BaseEntityKind };
}

export interface TypeIndexEntry {
  key: string;
  name: string;
  description: string;
  baseKind: BaseEntityKind;
}

const coreFallback: Record<BaseEntityKind, string> = {
  person: 'core.person',
  organization: 'core.organization',
  concept: 'core.concept',
  place: 'core.place',
  event: 'core.event',
  thing: 'core.thing',
};

/** Concrete (non-core) types the extractor may assign directly. */
export function typeIndexFromRegistry(registry: CompiledKnowledgeRegistry, allowedKeys: readonly string[]): TypeIndexEntry[] {
  const allowed = new Set(allowedKeys);
  return [...registry.entityTypes.values()]
    .filter(({ key }) => allowed.has(key) || key.startsWith('learned.'))
    .filter(({ key }) => !key.startsWith('core.'))
    .map(({ key, name, description, baseKind }) => ({ key, name, description, baseKind }));
}

function matchByName(raw: RawExtractedEntity, index: readonly TypeIndexEntry[]): TypeIndexEntry | undefined {
  const normalized = normalizeEntityName(raw.type);
  if (!normalized) return undefined;
  return index.find((entry) =>
    entry.key === raw.type.trim()
    || normalizeEntityName(entry.name) === normalized
    || normalizeEntityName(entry.key.split('.').slice(1).join(' ').replace(/_/g, ' ')) === normalized);
}

export const TYPE_MATCH_THRESHOLD = Number(process.env.ONTOLOGY_TYPE_MATCH_THRESHOLD ?? 0.86);

/**
 * Resolve every extracted item to a type key. Name/alias matches are free;
 * one batched embedding call settles the rest; misses fall back to the core
 * kind the model assigned.
 */
export async function resolveExtractedTypes(
  entities: readonly RawExtractedEntity[],
  index: readonly TypeIndexEntry[],
  embedTexts: EmbedTexts = defaultEmbedTexts(),
): Promise<TypedExtractedEntity[]> {
  const results: Array<TypedExtractedEntity | null> = entities.map((raw) => {
    const named = matchByName(raw, index);
    return named ? { name: raw.name, typeKey: named.key, definition: raw.definition } : null;
  });
  const unresolved = entities.map((raw, position) => ({ raw, position })).filter(({ position }) => results[position] === null);
  if (unresolved.length > 0 && index.length > 0) {
    const vectors = await embedTexts([
      ...unresolved.map(({ raw }) => `${raw.type}: ${raw.definition}`),
      ...index.map((entry) => `${entry.name}: ${entry.description}`),
    ]);
    const itemVectors = vectors.slice(0, unresolved.length);
    const typeVectors = vectors.slice(unresolved.length);
    for (let position = 0; position < unresolved.length; position += 1) {
      const { raw, position: resultPosition } = unresolved[position];
      let best = -1;
      let bestScore = 0;
      for (let typePosition = 0; typePosition < index.length; typePosition += 1) {
        const score = cosineSimilarity(itemVectors[position], typeVectors[typePosition]);
        if (score > bestScore) { bestScore = score; best = typePosition; }
      }
      if (best >= 0 && bestScore >= TYPE_MATCH_THRESHOLD) {
        results[resultPosition] = { name: raw.name, typeKey: index[best].key, definition: raw.definition };
      }
    }
  }
  return entities.map((raw, position) => {
    if (results[position]) return results[position]!;
    // A proposal that is itself a bare core kind ("organization", "concept")
    // teaches the ontology nothing — the core kind already expresses it fully.
    const proposal = raw.type.trim();
    const proposalIsCoreKind = (baseEntityKinds as readonly string[]).includes(normalizeEntityName(proposal));
    return {
      name: raw.name,
      typeKey: coreFallback[raw.kind] ?? 'core.concept',
      definition: raw.definition,
      ...(proposal && !proposalIsCoreKind ? { miss: { proposedTypeName: proposal, kind: raw.kind } } : {}),
    };
  });
}
