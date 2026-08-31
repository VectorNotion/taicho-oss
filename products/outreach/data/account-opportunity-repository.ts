import { getSession } from "@content-automation/platform/data/graph";
import type {
  AccountOpportunityAngle,
  OpportunityContentMatch,
  OpportunitySolutionMatch,
} from "../domain/account-opportunity";

export interface StoreAccountOpportunityAngle {
  id: string;
  angle: string;
  sourceDimensionKeys: string[];
  sourceClaimIds?: string[];
  sourceEvidenceIds?: string[];
  evidence: string[];
  evidenceConfidence: number;
  researchRunId: string;
  generatedAt: string;
  embedding: number[];
  embeddingModel: string;
  embeddingDimensions: number;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof (value as { toNumber?: () => number }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapOpportunity(
  accountId: string,
  props: Record<string, unknown>,
): AccountOpportunityAngle {
  return {
    id: String(props.id),
    accountId,
    angle: String(props.angle),
    sourceDimensionKeys: parseJson<string[]>(props.sourceDimensionKeysJson, []),
    sourceClaimIds: parseJson<string[]>(props.sourceClaimIdsJson, []),
    sourceEvidenceIds: parseJson<string[]>(props.sourceEvidenceIdsJson, []),
    evidence: parseJson<string[]>(props.evidenceJson, []),
    evidenceConfidence: Number(props.evidenceConfidence ?? 0),
    researchRunId: String(props.researchRunId),
    generatedAt: String(props.generatedAt),
  };
}

/** Replace the account's flat list of current opportunity angles. */
export async function replaceAccountOpportunityAngles(
  accountId: string,
  opportunities: StoreAccountOpportunityAngle[],
): Promise<AccountOpportunityAngle[]> {
  const session = await getSession();
  try {
    const removed = await session.run(
      `MATCH (account:Account {id: $accountId})
       OPTIONAL MATCH (account)-[edge:HAS_OPPORTUNITY]->(old:AccountOpportunityAngle)
       WITH account, collect(edge) AS edges, collect(old) AS oldAngles
       FOREACH (item IN edges | DELETE item)
       FOREACH (item IN oldAngles | DELETE item)
       RETURN account.id AS accountId`,
      { accountId },
    );
    if (removed.records.length === 0) throw new Error(`Account not found: ${accountId}`);

    if (opportunities.length > 0) {
      await session.run(
        `MATCH (account:Account {id: $accountId})
         UNWIND $opportunities AS item
         CREATE (angle:AccountOpportunityAngle {
           id: item.id,
           angle: item.angle,
           sourceDimensionKeysJson: item.sourceDimensionKeysJson,
           sourceClaimIdsJson: item.sourceClaimIdsJson,
           sourceEvidenceIdsJson: item.sourceEvidenceIdsJson,
           evidenceJson: item.evidenceJson,
           evidenceConfidence: item.evidenceConfidence,
           researchRunId: item.researchRunId,
           generatedAt: item.generatedAt,
           embeddingModel: item.embeddingModel,
           embeddingDimensions: item.embeddingDimensions,
           embedding: vecf32(item.embedding)
         })
         CREATE (account)-[:HAS_OPPORTUNITY]->(angle)`,
        {
          accountId,
          opportunities: opportunities.map((item) => ({
            ...item,
            sourceDimensionKeysJson: JSON.stringify(item.sourceDimensionKeys),
            sourceClaimIdsJson: JSON.stringify(item.sourceClaimIds ?? []),
            sourceEvidenceIdsJson: JSON.stringify(item.sourceEvidenceIds ?? []),
            evidenceJson: JSON.stringify(item.evidence),
          })),
        },
      );
    }
    return listAccountOpportunityAngles(accountId, session);
  } finally {
    await session.close();
  }
}

export async function listAccountOpportunityAngles(
  accountId: string,
  existingSession?: Awaited<ReturnType<typeof getSession>>,
): Promise<AccountOpportunityAngle[]> {
  const session = existingSession ?? await getSession();
  try {
    const result = await session.run(
      `MATCH (:Account {id: $accountId})-[:HAS_OPPORTUNITY]->(angle:AccountOpportunityAngle)
       RETURN angle ORDER BY toLower(angle.angle), angle.id`,
      { accountId },
    );
    return result.records.map((record) =>
      mapOpportunity(accountId, record.get("angle").properties));
  } finally {
    if (!existingSession) await session.close();
  }
}

export interface WorkspaceAccountOpportunityContext {
  opportunity: AccountOpportunityAngle;
  account: {
    id: string;
    name: string;
    icpScore: number | null;
    timingScore: number | null;
    hardExcluded: boolean;
  };
}

export async function listWorkspaceAccountOpportunityContexts(): Promise<
  WorkspaceAccountOpportunityContext[]
> {
  const session = await getSession();
  try {
    const result = await session.run(
      `MATCH (account:Account)-[:HAS_OPPORTUNITY]->(angle:AccountOpportunityAngle)
       OPTIONAL MATCH (account)-[:HAS_SCORE]->(score:AccountScore)
       WHERE coalesce(score.contextKey, 'workspace') = 'workspace'
       RETURN account.id AS accountId, account.name AS accountName, angle, score
       ORDER BY toLower(account.name), toLower(angle.angle), angle.id`,
    );
    return result.records.map((record) => {
      const accountId = String(record.get("accountId"));
      const score = (record.get("score") as {
        properties?: Record<string, unknown>;
      } | null)?.properties;
      return {
        opportunity: mapOpportunity(accountId, record.get("angle").properties),
        account: {
          id: accountId,
          name: String(record.get("accountName")),
          icpScore: toNumber(score?.icpScore),
          timingScore: toNumber(score?.timingScore),
          hardExcluded: Boolean(score?.hardExcluded),
        },
      };
    });
  } finally {
    await session.close();
  }
}

export interface OpportunitySimilarityMatches {
  opportunityId: string;
  solutionMatches: Array<Omit<OpportunitySolutionMatch, "score"> & { similarity: number }>;
  contentMatches: Array<Omit<OpportunityContentMatch, "score"> & { similarity: number }>;
}

/** Exact cosine ranking over the current graph; no generated ranking step. */
export async function getAccountOpportunitySimilarityMatches(input: {
  accountId: string;
  embeddingModel: string;
  embeddingDimensions: number;
  limit?: number;
}): Promise<OpportunitySimilarityMatches[]> {
  const limit = Math.max(1, Math.min(10, Math.floor(input.limit ?? 3)));
  const session = await getSession();
  try {
    const opportunityResult = await session.run(
      `MATCH (:Account {id: $accountId})-[:HAS_OPPORTUNITY]->(angle:AccountOpportunityAngle)
       WHERE angle.embedding IS NOT NULL
         AND angle.embeddingModel = $embeddingModel
         AND angle.embeddingDimensions = $embeddingDimensions
       RETURN angle.id AS id ORDER BY angle.id`,
      input,
    );
    const matches: OpportunitySimilarityMatches[] = [];
    for (const record of opportunityResult.records) {
      const opportunityId = String(record.get("id"));
      const solutions = await session.run(
        `MATCH (angle:AccountOpportunityAngle {id: $opportunityId})
         MATCH (item:CatalogItem {status: 'active'})
         WHERE item.opportunityEmbedding IS NOT NULL
           AND item.opportunityEmbeddingModel = $embeddingModel
           AND item.opportunityEmbeddingDimensions = $embeddingDimensions
         WITH item, vec.cosineDistance(angle.embedding, item.opportunityEmbedding) AS distance
         RETURN item.id AS id, item.name AS name, item.kind AS kind,
                item.summary AS summary, item.positioning AS positioning,
                item.outcomes AS outcomes, item.differentiators AS differentiators,
                item.proof AS proof, 1 - distance AS similarity
         ORDER BY distance ASC, item.name
         LIMIT $limit`,
        { ...input, opportunityId, limit },
      );
      const content = await session.run(
        `MATCH (angle:AccountOpportunityAngle {id: $opportunityId})
         MATCH (content:ContentDraft {status: 'published'})
         WHERE content.publishedUrl IS NOT NULL
           AND content.opportunityEmbedding IS NOT NULL
           AND content.opportunityEmbeddingModel = $embeddingModel
           AND content.opportunityEmbeddingDimensions = $embeddingDimensions
         WITH content, vec.cosineDistance(angle.embedding, content.opportunityEmbedding) AS distance
         RETURN content.id AS id, content.title AS title, content.type AS type,
                content.publishedUrl AS publishedUrl, 1 - distance AS similarity
         ORDER BY distance ASC, content.title
         LIMIT $limit`,
        { ...input, opportunityId, limit },
      );
      matches.push({
        opportunityId,
        solutionMatches: solutions.records.map((solution) => ({
          catalogItemId: String(solution.get("id")),
          name: String(solution.get("name")),
          kind: String(solution.get("kind")),
          summary: solution.get("summary") ? String(solution.get("summary")) : undefined,
          positioning: solution.get("positioning")
            ? String(solution.get("positioning"))
            : undefined,
          outcomes: solution.get("outcomes") ? String(solution.get("outcomes")) : undefined,
          differentiators: solution.get("differentiators")
            ? String(solution.get("differentiators"))
            : undefined,
          proof: solution.get("proof") ? String(solution.get("proof")) : undefined,
          similarity: Number(solution.get("similarity")),
        })),
        contentMatches: content.records.map((item) => ({
          contentId: String(item.get("id")),
          title: String(item.get("title")),
          type: String(item.get("type")),
          publishedUrl: String(item.get("publishedUrl")),
          similarity: Number(item.get("similarity")),
        })),
      });
    }
    return matches;
  } finally {
    await session.close();
  }
}
