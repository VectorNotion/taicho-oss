import { getSession } from '@content-automation/platform/data/graph';
import { graphNumber, migrationArgs } from './cli';

const { organizationId } = migrationArgs();
const session = await getSession(organizationId);
try {
  const nodes = await session.run('MATCH (n) RETURN labels(n) AS labels, count(n) AS count ORDER BY count DESC');
  const relationships = await session.run('MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS count ORDER BY count DESC');
  const orphanClaims = await session.run("MATCH (c:Claim {schemaVersion: 'knowledge.v1'}) WHERE NOT (c)-[:SUPPORTED_BY]->(:Evidence) RETURN count(c) AS count");
  const orphanEvidence = await session.run("MATCH (e:Evidence {schemaVersion: 'knowledge.v1'}) WHERE NOT (:SourceRevision)-[:CONTAINS]->(e) RETURN count(e) AS count");
  const duplicateSources = await session.run("MATCH (s:KnowledgeSource {schemaVersion: 'knowledge.v1'}) WITH s.kind AS kind, s.canonicalUri AS canonicalUri, count(s) AS count WHERE count > 1 RETURN kind, canonicalUri, count ORDER BY count DESC");
  const legacy = await session.run("OPTIONAL MATCH (r:ResearchItem) WITH count(r) AS researchItems OPTIONAL MATCH (p:ProspectResearch) WITH researchItems, count(p) AS prospectResearch OPTIONAL MATCH (i:CompanyInsight) RETURN researchItems, prospectResearch, count(i) AS companyInsights");
  const legacyRow = legacy.records[0];
  console.log(JSON.stringify({
    organizationId,
    nodes: nodes.records.map((row) => ({ labels: row.get('labels'), count: graphNumber(row.get('count')) })),
    relationships: relationships.records.map((row) => ({ type: row.get('type'), count: graphNumber(row.get('count')) })),
    acceptedClaimsWithoutEvidence: graphNumber(orphanClaims.records[0]?.get('count')),
    orphanEvidence: graphNumber(orphanEvidence.records[0]?.get('count')),
    duplicateSources: duplicateSources.records.map((row) => ({ kind: row.get('kind'), canonicalUri: row.get('canonicalUri'), count: graphNumber(row.get('count')) })),
    legacy: {
      researchItems: graphNumber(legacyRow?.get('researchItems')),
      prospectResearch: graphNumber(legacyRow?.get('prospectResearch')),
      companyInsights: graphNumber(legacyRow?.get('companyInsights')),
    },
  }, null, 2));
} finally { await session.close(); }
