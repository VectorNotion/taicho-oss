/**
 * Distill per-draft aggregates onto the ContentDraft graph node.
 *
 * The graph gets the distilled signal ONLY — four properties in v1
 * (metricsImpressions, metricsClicks, metricsEngagements,
 * metricsLastMeasuredAt); raw snapshots stay in Postgres. Write pattern
 * mirrors updateContentDraft's dynamic SET clauses
 * (products/content-generator/data/content-repository.ts).
 * openCypher 9: localdatetime(), no subquery forms (docs/graph-backend.md).
 */

import { getSession } from '../data/graph';
import { latestAggregateDetail } from './snapshots';

const ROLLUP_KEYS = [
  ['impressions', 'metricsImpressions'],
  ['clicks', 'metricsClicks'],
  ['engagements', 'metricsEngagements'],
] as const;

/** FalkorDB localdatetime() parses ISO without offset: 2026-07-31T12:34:56 */
function graphLocalDateTime(date: Date): string {
  return date.toISOString().slice(0, 19);
}

export async function rollupDraftMetrics(
  organizationId: string,
  draftId: string,
): Promise<boolean> {
  const { totals, lastMeasuredAt } = await latestAggregateDetail(organizationId, draftId);
  if (!lastMeasuredAt) return false;

  // Only measured keys are written — no fake zeros. Deliberately does NOT
  // touch d.updatedAt: measurement is not an edit, and
  // metricsLastMeasuredAt carries the freshness signal.
  const setClauses = ['d.metricsLastMeasuredAt = localdatetime($lastMeasuredAt)'];
  const params: Record<string, unknown> = {
    draftId,
    lastMeasuredAt: graphLocalDateTime(lastMeasuredAt),
  };
  for (const [key, property] of ROLLUP_KEYS) {
    if (totals[key] !== undefined) {
      setClauses.push(`d.${property} = $${property}`);
      params[property] = totals[key];
    }
  }

  const session = await getSession(organizationId);
  try {
    const result = await session.run(
      `MATCH (d:ContentDraft {id: $draftId})
       SET ${setClauses.join(', ')}
       RETURN d.id AS id`,
      params,
    );
    return result.records.length > 0;
  } finally {
    await session.close();
  }
}
