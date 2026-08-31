import type { Claim, KnowledgeSensitivity } from './domain';
import type { KnowledgeUse } from './registry/types';

const sensitivityRank: Record<KnowledgeSensitivity, number> = { public: 0, workspace: 1, restricted: 2 };

export interface KnowledgePolicyContext {
  organizationId: string;
  use: KnowledgeUse;
  maxSensitivity: KnowledgeSensitivity;
  now?: Date;
  includeStale?: boolean;
}

export function claimIsAuthorized(claim: Claim, context: KnowledgePolicyContext): boolean {
  if (claim.organizationId !== context.organizationId || claim.status !== 'accepted') return false;
  if (!claim.allowedUses.includes(context.use)) return false;
  if (sensitivityRank[claim.sensitivity] > sensitivityRank[context.maxSensitivity]) return false;
  if (!context.includeStale && claim.validUntil && new Date(claim.validUntil) < (context.now ?? new Date())) return false;
  return true;
}

export function restrictClaims(claims: readonly Claim[], context: KnowledgePolicyContext): Claim[] {
  return claims.filter((claim) => claimIsAuthorized(claim, context));
}
