import { getSession } from '@content-automation/platform/data/graph';
import { graphNumber, migrationArgs } from './cli';

const { organizationId } = migrationArgs();
const session = await getSession(organizationId);
try {
  const [research, observations, generated, sources, claims, artifacts] = await Promise.all([
    session.run('MATCH (node:ResearchItem) RETURN count(node) AS count'),
    session.run('MATCH (node) WHERE node:AccountObservation OR node:ProspectObservation RETURN count(node) AS count'),
    session.run('MATCH (node) WHERE node:ContentIdea OR node:ContentDraft OR node:OutreachMessage RETURN count(node) AS count'),
    session.run("MATCH (node:KnowledgeSource {schemaVersion: 'knowledge.v1'}) RETURN count(node) AS count"),
    session.run("MATCH (node:Claim {schemaVersion: 'knowledge.v1', status: 'accepted'}) RETURN count(node) AS count"),
    session.run("MATCH (node:Artifact {schemaVersion: 'knowledge.v1'}) RETURN count(node) AS count"),
  ]);
  const count = (result: typeof research) => graphNumber(result.records[0]?.get('count'));
  console.log(JSON.stringify({ organizationId, legacy: { researchItems: count(research), observations: count(observations), generatedArtifacts: count(generated) }, knowledgeV1: { sources: count(sources), acceptedClaims: count(claims), artifacts: count(artifacts) }, note: 'These are comparison signals; source revisions and claims intentionally do not have one-to-one legacy cardinality.' }, null, 2));
} finally { await session.close(); }
