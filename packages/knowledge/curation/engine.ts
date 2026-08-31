import { normalizeEntityName } from '../identity';
import { baseEntityKinds, type BaseEntityKind } from '../registry/types';
import type { TypeCandidate } from '../ontology/types';
import { cosineSimilarity } from './embeddings';

export interface CurationThresholds {
  /** Candidates whose definition embeddings meet this similarity cluster together. */
  clusterSimilarity: number;
  /** A cluster this similar to an existing type becomes an alias of it, not a new type. */
  aliasSimilarity: number;
  /** Distinct source documents required before a cluster becomes a type. */
  minimumSources: number;
  /** Open candidates older than this with a single source are dismissed. */
  candidateTtlDays: number;
  /** Learned types with zero instances for this long are removed. */
  typeDecayDays: number;
}

export const defaultCurationThresholds: CurationThresholds = {
  clusterSimilarity: 0.82,
  aliasSimilarity: 0.86,
  minimumSources: Number(process.env.ONTOLOGY_MIN_SOURCES ?? 2),
  candidateTtlDays: Number(process.env.ONTOLOGY_CANDIDATE_TTL_DAYS ?? 30),
  typeDecayDays: Number(process.env.ONTOLOGY_TYPE_DECAY_DAYS ?? 45),
};

export interface ExistingTypeSummary {
  key: string;
  name: string;
  description: string;
  baseKind: BaseEntityKind;
  embedding: number[];
}

export interface CurationPlan {
  /** Candidate clusters that are really an existing type under another name. */
  aliasMappings: Array<{ typeKey: string; candidateIds: string[]; entityIds: string[]; surfaces: string[] }>;
  /** Clusters durable enough to become learned types right now. */
  newTypes: Array<{
    key: string;
    name: string;
    description: string;
    baseKind: BaseEntityKind;
    candidateIds: string[];
    entityIds: string[];
    surfaces: string[];
    sources: number;
  }>;
  /** Stale single-source candidates to drop. */
  dismissedCandidateIds: string[];
  /** Candidates that cannot be promoted until grounded evidence is present. */
  deferredCandidateIds: string[];
  /** Clusters left open — not yet recurrent enough. */
  stillOpen: number;
}

export function candidateHasPromotionEvidence(candidate: TypeCandidate): boolean {
  return Boolean(
    candidate.definition.trim()
    && candidate.evidence.trim()
    && candidate.docRefs.length > 0,
  );
}

export function learnedTypeKey(name: string, taken: ReadonlySet<string>): string {
  const slug = normalizeEntityName(name).replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/^_+|_+$/g, '').slice(0, 60) || 'concept';
  let key = `learned.${slug}`;
  let suffix = 2;
  while (taken.has(key)) {
    key = `learned.${slug}_${suffix}`;
    suffix += 1;
  }
  return key;
}

interface Cluster {
  members: TypeCandidate[];
  centroid: number[];
}

function averageVectors(vectors: readonly number[][]): number[] {
  const centroid = new Array<number>(vectors[0].length).fill(0);
  for (const vector of vectors) for (let index = 0; index < vector.length; index += 1) centroid[index] += vector[index];
  return centroid.map((value) => value / vectors.length);
}

/**
 * Two-stage clustering. Stage 1 groups by the model's own normalized proposed
 * type name — the extractor already told us what type it thinks each concept
 * is, and that signal beats definition similarity (definitions describe the
 * instance, not the type). Stage 2 greedily merges name-groups whose centroids
 * are close enough, catching synonymous proposals ("technique" / "method").
 * Deterministic given input order (the store sorts by recurrence, then name).
 */
export function clusterCandidates(candidates: readonly TypeCandidate[], similarity: number): Cluster[] {
  const byName = new Map<string, TypeCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.embedding || candidate.embedding.length === 0) continue;
    const nameKey = candidate.normalizedProposedTypeName || candidate.normalizedSurface;
    byName.set(nameKey, [...(byName.get(nameKey) ?? []), candidate]);
  }
  const clusters: Cluster[] = [];
  for (const members of byName.values()) {
    const centroid = averageVectors(members.map((member) => member.embedding!));
    const match = clusters.find((cluster) => cosineSimilarity(cluster.centroid, centroid) >= similarity);
    if (match) {
      match.members.push(...members);
      match.centroid = averageVectors(match.members.map((member) => member.embedding!));
    } else {
      clusters.push({ members, centroid });
    }
  }
  return clusters;
}

function majorityBaseKind(members: readonly TypeCandidate[]): BaseEntityKind {
  const counts = new Map<BaseEntityKind, number>();
  for (const member of members) counts.set(member.baseKind, (counts.get(member.baseKind) ?? 0) + member.recurrence);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0][0];
}

function clusterName(members: readonly TypeCandidate[]): string {
  const counts = new Map<string, { name: string; weight: number }>();
  for (const member of members) {
    const key = member.normalizedProposedTypeName || member.normalizedSurface;
    const entry = counts.get(key) ?? { name: member.proposedTypeName || member.surface, weight: 0 };
    entry.weight += member.recurrence;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((left, right) => right.weight - left.weight || left.name.localeCompare(right.name))[0].name;
}

/**
 * The zero-approval decision procedure. Pure: callers supply embedded
 * candidates and embedded existing types; the plan says exactly what the
 * effectful pass must apply. Vetoed names are permanent rejection memory.
 */
export function planCuration(input: {
  candidates: readonly TypeCandidate[];
  existingTypes: readonly ExistingTypeSummary[];
  vetoedNames: ReadonlySet<string>;
  takenTypeKeys: ReadonlySet<string>;
  thresholds?: CurationThresholds;
  now?: Date;
}): CurationPlan {
  const thresholds = input.thresholds ?? defaultCurationThresholds;
  const now = input.now ?? new Date();
  const open = input.candidates.filter((candidate) => candidate.status === 'open');
  const deferredCandidateIds = open
    .filter((candidate) => !candidateHasPromotionEvidence(candidate))
    .map(({ id }) => id);
  const eligible = open.filter((candidate) => candidateHasPromotionEvidence(candidate));
  const clusters = clusterCandidates(eligible, thresholds.clusterSimilarity);
  const plan: CurationPlan = {
    aliasMappings: [],
    newTypes: [],
    dismissedCandidateIds: [],
    deferredCandidateIds,
    stillOpen: deferredCandidateIds.length,
  };
  const taken = new Set(input.takenTypeKeys);
  for (const cluster of clusters) {
    const candidateIds = cluster.members.map(({ id }) => id);
    const entityIds = [...new Set(cluster.members.flatMap(({ entityIds: ids }) => ids))].sort();
    const surfaces = [...new Set(cluster.members.map(({ surface }) => surface))].sort();
    const sources = new Set(cluster.members.flatMap(({ docRefs }) => docRefs)).size;
    const name = clusterName(cluster.members);
    const normalizedName = normalizeEntityName(name);
    // A cluster carrying the exact name of an existing type IS that type.
    const exactExisting = input.existingTypes.find((type) => normalizeEntityName(type.name) === normalizedName);
    const nearestExisting = input.existingTypes
      .map((type) => ({ type, score: cosineSimilarity(cluster.centroid, type.embedding) }))
      .sort((left, right) => right.score - left.score)[0];
    if (exactExisting || (nearestExisting && nearestExisting.score >= thresholds.aliasSimilarity)) {
      plan.aliasMappings.push({ typeKey: (exactExisting ?? nearestExisting!.type).key, candidateIds, entityIds, surfaces });
      continue;
    }
    // A bare core kind ("organization", "concept") is never a learnable type —
    // the core layer already expresses it. Same permanence as a veto.
    if (input.vetoedNames.has(normalizedName) || (baseEntityKinds as readonly string[]).includes(normalizedName)) {
      plan.dismissedCandidateIds.push(...candidateIds);
      continue;
    }
    if (sources >= thresholds.minimumSources) {
      const key = learnedTypeKey(name, taken);
      taken.add(key);
      const description = cluster.members.sort((left, right) => right.recurrence - left.recurrence)[0].definition
        || `Concept cluster observed across ${sources} sources: ${surfaces.slice(0, 5).join(', ')}.`;
      plan.newTypes.push({ key, name, description, baseKind: majorityBaseKind(cluster.members), candidateIds, entityIds, surfaces, sources });
      continue;
    }
    const stale = cluster.members.every((member) =>
      member.docRefs.length <= 1
      && now.getTime() - new Date(member.createdAt).getTime() > thresholds.candidateTtlDays * 24 * 60 * 60 * 1000);
    if (stale) plan.dismissedCandidateIds.push(...candidateIds);
    else plan.stillOpen += cluster.members.length;
  }
  return plan;
}

/** Learned types with no instances for longer than the decay window are removed. */
export function planTypeDecay(input: {
  learnedTypes: ReadonlyArray<{ key: string; createdAt: string }>;
  instanceCounts: ReadonlyMap<string, number>;
  thresholds?: CurationThresholds;
  now?: Date;
}): string[] {
  const thresholds = input.thresholds ?? defaultCurationThresholds;
  const now = input.now ?? new Date();
  return input.learnedTypes
    .filter(({ key, createdAt }) =>
      (input.instanceCounts.get(key) ?? 0) === 0
      && now.getTime() - new Date(createdAt).getTime() > thresholds.typeDecayDays * 24 * 60 * 60 * 1000)
    .map(({ key }) => key);
}

/**
 * Self-repair: exact-normalized-name duplicates with a shared type are the
 * same thing recorded twice (usually created before a learned type existed).
 * The oldest entity survives; the rest merge into it.
 */
export function planEntityMerges(entities: ReadonlyArray<{
  id: string;
  normalizedName: string;
  typeKeys: string[];
  createdAt: string;
}>): Array<{ survivorId: string; duplicateId: string }> {
  const byName = new Map<string, typeof entities[number][]>();
  for (const entity of entities) {
    byName.set(entity.normalizedName, [...(byName.get(entity.normalizedName) ?? []), entity]);
  }
  const merges: Array<{ survivorId: string; duplicateId: string }> = [];
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    const survivor = sorted[0];
    for (const duplicate of sorted.slice(1)) {
      const sharesType = duplicate.typeKeys.some((key) => survivor.typeKeys.includes(key));
      if (sharesType) merges.push({ survivorId: survivor.id, duplicateId: duplicate.id });
    }
  }
  return merges;
}
