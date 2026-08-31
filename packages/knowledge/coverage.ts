import type { ContextBundle } from './domain';

export interface KnowledgeCoverage {
  projectionKey: string;
  status: 'sufficient' | 'missing' | 'weak' | 'contradictory' | 'stale';
  acceptedClaims: number;
  averageConfidence: number;
  contradictionCount: number;
  staleClaimIds: string[];
  recommendation: string;
}

export function evaluateKnowledgeCoverage(bundle: ContextBundle, options: { minimumClaims?: number; minimumAverageConfidence?: number; now?: Date } = {}): KnowledgeCoverage {
  const minimumClaims = options.minimumClaims ?? 1;
  const minimumAverageConfidence = options.minimumAverageConfidence ?? 0.65;
  const averageConfidence = bundle.claims.length ? bundle.claims.reduce((sum, claim) => sum + claim.confidence, 0) / bundle.claims.length : 0;
  const now = options.now ?? new Date();
  const staleClaimIds = bundle.claims.filter((claim) => claim.validUntil && new Date(claim.validUntil) < now).map(({ id }) => id);
  const contradictionCount = bundle.contradictions.length;
  let status: KnowledgeCoverage['status'] = 'sufficient';
  if (bundle.claims.length < minimumClaims) status = 'missing';
  else if (contradictionCount > 0) status = 'contradictory';
  else if (staleClaimIds.length > 0) status = 'stale';
  else if (averageConfidence < minimumAverageConfidence) status = 'weak';
  return {
    projectionKey: bundle.projectionKey,
    status,
    acceptedClaims: bundle.claims.length,
    averageConfidence,
    contradictionCount,
    staleClaimIds,
    recommendation: status === 'sufficient' ? 'No lookup is required.' : `Request bounded lookup for ${bundle.projectionKey}: coverage is ${status}.`,
  };
}
