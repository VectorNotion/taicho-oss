import { getSession } from '@content-automation/platform/data/graph';
import { graphNumber, migrationArgs } from './cli';

const { organizationId } = migrationArgs();
const session = await getSession(organizationId);
try {
  const claimsResult = await session.run("MATCH (c:Claim {schemaVersion: 'knowledge.v1', status: 'accepted'}) RETURN count(c) AS count");
  const explainedResult = await session.run("MATCH (c:Claim {schemaVersion: 'knowledge.v1', status: 'accepted'})-[:SUPPORTED_BY]->(:Evidence)<-[:CONTAINS]-(:SourceRevision)<-[:HAS_REVISION]-(:KnowledgeSource) RETURN count(DISTINCT c) AS count");
  const artifactsResult = await session.run("MATCH (a:Artifact {schemaVersion: 'knowledge.v1'}) RETURN count(a) AS count");
  const groundedArtifactsResult = await session.run("MATCH (a:Artifact {schemaVersion: 'knowledge.v1'})-[:USES]->(c:Claim {status: 'accepted'}) RETURN count(DISTINCT a) AS count");
  const assessmentsResult = await session.run("MATCH (a:Assessment {schemaVersion: 'knowledge.v1'}) RETURN count(a) AS count");
  const groundedAssessmentsResult = await session.run("MATCH (a:Assessment {schemaVersion: 'knowledge.v1'})-[:BASED_ON]->(c:Claim {status: 'accepted'}) RETURN count(DISTINCT a) AS count");
  const checkpointResult = await session.run("MATCH (c:KnowledgeMigrationCheckpoint {id: $id, organizationId: $organizationId}) RETURN count(c) AS count", { id: `knowledge.v1:${organizationId}`, organizationId });
  const claims = graphNumber(claimsResult.records[0]?.get('count'));
  const explained = graphNumber(explainedResult.records[0]?.get('count'));
  const artifacts = graphNumber(artifactsResult.records[0]?.get('count'));
  const groundedArtifacts = graphNumber(groundedArtifactsResult.records[0]?.get('count'));
  const assessments = graphNumber(assessmentsResult.records[0]?.get('count'));
  const groundedAssessments = graphNumber(groundedAssessmentsResult.records[0]?.get('count'));
  const checkpointPresent = graphNumber(checkpointResult.records[0]?.get('count')) === 1;
  const lineageReady = claims === explained && artifacts === groundedArtifacts && assessments === groundedAssessments;
  console.log(JSON.stringify({ organizationId, claims, explainedClaims: explained, claimLineagePercent: claims ? explained / claims * 100 : 100, artifacts, groundedArtifacts, artifactLineagePercent: artifacts ? groundedArtifacts / artifacts * 100 : 100, assessments, groundedAssessments, assessmentLineagePercent: assessments ? groundedAssessments / assessments * 100 : 100, checkpointPresent, lineageReady, productionCutoverReady: false, remainingGate: lineageReady && checkpointPresent ? 'Observe legacy fallback counters at zero for one release before cutover.' : 'Complete backfill and lineage gates before observing fallback counters.' }, null, 2));
} finally { await session.close(); }
