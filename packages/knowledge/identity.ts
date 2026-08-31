import type { CanonicalEntity, KnowledgeSensitivity } from './domain';
import { KNOWLEDGE_SCHEMA_VERSION, stableKnowledgeId } from './domain';

export function normalizeEntityName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ');
}

export function externalIdentityKey(externalIds: Record<string, string>): string | undefined {
  const entries = Object.entries(externalIds)
    .map(([provider, value]) => [provider.trim().toLowerCase(), value.trim()] as const)
    .filter(([, value]) => value.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length ? entries.map(([provider, value]) => `${provider}:${value}`).join('|') : undefined;
}

export type EntityResolution =
  | { status: 'resolved' | 'created'; entity: CanonicalEntity; score: number; reasons: string[] }
  | { status: 'review_required'; candidates: Array<{ entity: CanonicalEntity; score: number; reasons: string[] }> };

export function buildCanonicalEntity(input: {
  organizationId: string;
  typeKey: string;
  name: string;
  aliases?: string[];
  externalIds?: Record<string, string>;
  sensitivity?: KnowledgeSensitivity;
  now?: string;
}): CanonicalEntity {
  const normalizedName = normalizeEntityName(input.name);
  const externalKey = externalIdentityKey(input.externalIds ?? {});
  const now = input.now ?? new Date().toISOString();
  return {
    id: stableKnowledgeId('entity', input.organizationId, externalKey ?? `${input.typeKey}:${normalizedName}`),
    schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
    organizationId: input.organizationId,
    typeKey: input.typeKey,
    typeKeys: [input.typeKey],
    name: input.name.trim(),
    normalizedName,
    aliases: [...new Set((input.aliases ?? []).map(normalizeEntityName).filter(Boolean))],
    externalIds: input.externalIds ?? {},
    sensitivity: input.sensitivity ?? 'workspace',
    createdAt: now,
    updatedAt: now,
  };
}

export function scoreIdentityCandidate(input: { typeKey: string; name: string; externalIds?: Record<string, string> }, candidate: CanonicalEntity) {
  const reasons: string[] = [];
  let score = 0;
  const expectedExternal = Object.entries(input.externalIds ?? {})
    .map(([provider, value]) => [provider.trim().toLowerCase(), value.trim()] as const)
    .filter(([, value]) => Boolean(value));
  const actualExternal = new Map(Object.entries(candidate.externalIds)
    .map(([provider, value]) => [provider.trim().toLowerCase(), value.trim()] as const));
  if (expectedExternal.some(([provider, value]) => actualExternal.get(provider) === value)) {
    score += 1;
    reasons.push('matching external identifier');
  }
  if ((candidate.typeKeys ?? [candidate.typeKey]).includes(input.typeKey)) { score += 0.2; reasons.push('same registered type or role'); }
  const normalized = normalizeEntityName(input.name);
  if (candidate.normalizedName === normalized) { score += 0.55; reasons.push('exact normalized name'); }
  else if (candidate.aliases.includes(normalized)) { score += 0.45; reasons.push('exact alias'); }
  return { score: Math.min(score, 1), reasons };
}
