import { getSession, runWithGraphOrganization } from '@content-automation/platform/data/graph';
import { compileKnowledgeRegistry, coreKnowledgeManifest, knowledgeRegistry } from '..';
import { contentKnowledgeManifest } from '../../../products/content-generator/knowledge-manifest';
import { outreachKnowledgeManifest } from '../../../products/outreach/knowledge-manifest';
import { cascadeKnowledgeManifest } from '../../../products/cascade/knowledge-manifest';
import { ingestContentResearchKnowledge } from '../../../products/content-generator/knowledge-service';
import { ingestLegacyProspectResearchKnowledge, ingestOutreachObservationKnowledge } from '../../../products/outreach/knowledge-service';
import { graphNumber, migrationArgs } from './cli';

const { organizationId, apply } = migrationArgs();
knowledgeRegistry.install(compileKnowledgeRegistry([coreKnowledgeManifest, contentKnowledgeManifest, outreachKnowledgeManifest, cascadeKnowledgeManifest]));
const session = await getSession(organizationId);
try {
  const contentResult = await session.run('MATCH (r:ResearchItem) RETURN r ORDER BY r.createdAt DESC');
  const contentRows = contentResult.records.map((record) => record.get('r').properties as Record<string, unknown>);
  const observationResult = await session.run(`
    MATCH (entity)-[:HAS_OBSERVATION]->(observation)
    WHERE (entity:Account AND observation:AccountObservation) OR (entity:Prospect AND observation:ProspectObservation)
    RETURN labels(entity) AS entityLabels, entity.id AS entityId, entity.name AS entityName, observation
    ORDER BY observation.researchedAt DESC
  `);
  const researchResult = await session.run(`
    MATCH (prospect:Prospect)-[:HAS_RESEARCH]->(research:ProspectResearch)
    OPTIONAL MATCH (research)-[:HAS_INSIGHT]->(insight:CompanyInsight)
    RETURN prospect.id AS prospectId, prospect.name AS prospectName, prospect.company AS company, insight
  `);
  const legacyResearch = new Map<string, { prospect: { id: string; name: string; company?: string }; insights: Array<{ id: string; category: string; content: string; sourceUrl?: string }> }>();
  for (const record of researchResult.records) {
    const prospectId = String(record.get('prospectId'));
    const entry = legacyResearch.get(prospectId) ?? { prospect: { id: prospectId, name: String(record.get('prospectName')), company: record.get('company') ? String(record.get('company')) : undefined }, insights: [] };
    const insight = record.get('insight')?.properties as Record<string, unknown> | undefined;
    if (insight?.content) entry.insights.push({ id: String(insight.id ?? `${entry.insights.length}`), category: String(insight.category ?? 'research'), content: String(insight.content), sourceUrl: insight.sourceUrl ? String(insight.sourceUrl) : undefined });
    legacyResearch.set(prospectId, entry);
  }
  const migrated = { contentResearch: 0, observations: 0, prospectResearch: 0 };
  if (apply) {
    await runWithGraphOrganization(organizationId, async () => {
      for (const row of contentRows) {
        const sourceUrl = String(row.sourceUrl ?? '').trim();
        const content = String(row.content ?? '').trim();
        if (!sourceUrl || !content) continue;
        await ingestContentResearchKnowledge({ title: String(row.title ?? 'Legacy research'), content, sourceUrl, tags: Array.isArray(row.tags) ? row.tags.map(String) : [], sourceId: row.sourceId ? String(row.sourceId) : null, findingId: String(row.id) });
        migrated.contentResearch += 1;
      }
      for (const record of observationResult.records) {
        const labels = record.get('entityLabels') as string[];
        const observation = record.get('observation').properties as Record<string, unknown>;
        const parseArray = <T>(value: unknown): T[] => {
          if (Array.isArray(value)) return value as T[];
          if (typeof value !== 'string' || !value) return [];
          try { return JSON.parse(value) as T[]; } catch { return []; }
        };
        const lineage = await ingestOutreachObservationKnowledge({
          entity: { kind: labels.includes('Account') ? 'account' : 'prospect', id: String(record.get('entityId')), name: String(record.get('entityName')) },
          observation: {
            dimensionKey: String(observation.dimensionKey),
            shape: observation.shape === 'signals' ? 'signals' : 'prose',
            observedValue: observation.observedValue ? String(observation.observedValue) : undefined,
            signals: parseArray(observation.signalsJson),
            evidence: parseArray<string>(observation.evidenceJson),
            confidence: graphNumber(observation.confidence),
            researchedAt: String(observation.researchedAt),
            runId: String(observation.runId ?? observation.id),
          },
        });
        await session.run('MATCH (o {id: $id}) SET o.claimIdsJson = $claimIdsJson, o.knowledgeEvidenceIdsJson = $evidenceIdsJson', { id: String(observation.id), claimIdsJson: JSON.stringify(lineage.claimIds), evidenceIdsJson: JSON.stringify(lineage.evidenceIds) });
        migrated.observations += 1;
      }
      for (const entry of legacyResearch.values()) {
        await ingestLegacyProspectResearchKnowledge(entry);
        migrated.prospectResearch += 1;
      }
    });
    await session.run(`MERGE (checkpoint:KnowledgeMigrationCheckpoint {id: $id, organizationId: $organizationId}) SET checkpoint.schemaVersion = 'knowledge.v1', checkpoint.completedAt = localdatetime(), checkpoint.countsJson = $countsJson`, { id: `knowledge.v1:${organizationId}`, organizationId, countsJson: JSON.stringify(migrated) });
  }
  console.log(JSON.stringify({ organizationId, mode: apply ? 'apply' : 'dry-run', discovered: { contentResearch: contentRows.length, observations: observationResult.records.length, prospectResearch: legacyResearch.size }, migrated, checkpoint: apply ? `knowledge.v1:${organizationId}` : null, destructiveChanges: 0 }, null, 2));
} finally { await session.close(); }
