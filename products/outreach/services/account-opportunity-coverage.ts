import { createHash } from "node:crypto";
import { createLogger } from "@content-automation/observability";
import { getSession } from "@content-automation/platform/data/graph";
import {
  getAccountOpportunitySimilarityMatches,
  listAccountOpportunityAngles,
  listWorkspaceAccountOpportunityContexts,
  type OpportunitySimilarityMatches,
} from "../data/account-opportunity-repository";
import {
  calculateOpportunityCoverage,
  DEFAULT_OPPORTUNITY_COVERAGE_THRESHOLDS,
  similarityPercent,
  type AccountOpportunityCoverageResult,
  type OpportunityCoverageThresholds,
  type WorkspaceAccountOpportunityCoverageResult,
} from "../domain/account-opportunity";
import { DEFAULT_THRESHOLDS as DEFAULT_QUALIFICATION_THRESHOLDS } from "../domain/qualification";
import {
  embedTexts,
  prospectSemanticSearchConfigFromEnvironment,
  type ProspectSemanticSearchConfig,
} from "./prospect-semantic-search";

const log = createLogger("account-opportunity-coverage");
const MAX_EMBEDDING_CHARACTERS = 8_000;

interface EmbeddingCandidate {
  id: string;
  kind: "catalog" | "content";
  text: string;
  currentHash: string;
  hasEmbedding: boolean;
}

function embeddingHash(config: ProspectSemanticSearchConfig, text: string): string {
  return createHash("sha256")
    .update(config.embeddingModel)
    .update("\0")
    .update(String(config.embeddingDimensions))
    .update("\0")
    .update(config.documentInputType ?? "")
    .update("\0")
    .update(text)
    .digest("hex");
}

export function catalogOpportunityEmbeddingText(item: {
  name: string;
  kind: string;
  summary: string;
  positioning: string;
  outcomes: string;
  differentiators: string;
  proof: string;
}): string {
  return [
    `${item.name} (${item.kind})`,
    item.summary,
    item.positioning,
    item.outcomes,
    item.differentiators,
    item.proof,
  ].filter(Boolean).join("\n").slice(0, MAX_EMBEDDING_CHARACTERS);
}

export function contentOpportunityEmbeddingText(item: {
  title: string;
  type: string;
  content: string;
  performanceInsights?: string;
}): string {
  return [
    `${item.title} (${item.type})`,
    item.content,
    item.performanceInsights,
  ].filter(Boolean).join("\n").slice(0, MAX_EMBEDDING_CHARACTERS);
}

/** Cache only embeddings on source nodes; match scores remain calculated. */
export async function syncOpportunityMatchEmbeddings(
  config: ProspectSemanticSearchConfig,
  deps: { embed?: typeof embedTexts } = {},
): Promise<{ catalog: number; content: number }> {
  const session = await getSession();
  try {
    const catalogResult = await session.run(
      `MATCH (item:CatalogItem {status: 'active'})
       RETURN item ORDER BY item.id`,
    );
    const contentResult = await session.run(
      `MATCH (content:ContentDraft {status: 'published'})
       WHERE content.publishedUrl IS NOT NULL
       RETURN content ORDER BY content.id`,
    );
    const candidates: EmbeddingCandidate[] = [
      ...catalogResult.records.map((record): EmbeddingCandidate => {
        const item = record.get("item").properties as Record<string, unknown>;
        return {
          id: String(item.id),
          kind: "catalog",
          currentHash: String(item.opportunityEmbeddingHash ?? ""),
          hasEmbedding: item.opportunityEmbedding != null,
          text: catalogOpportunityEmbeddingText({
            name: String(item.name),
            kind: String(item.kind),
            summary: String(item.summary ?? ""),
            positioning: String(item.positioning ?? ""),
            outcomes: String(item.outcomes ?? ""),
            differentiators: String(item.differentiators ?? ""),
            proof: String(item.proof ?? ""),
          }),
        };
      }),
      ...contentResult.records.map((record): EmbeddingCandidate => {
        const item = record.get("content").properties as Record<string, unknown>;
        return {
          id: String(item.id),
          kind: "content",
          currentHash: String(item.opportunityEmbeddingHash ?? ""),
          hasEmbedding: item.opportunityEmbedding != null,
          text: contentOpportunityEmbeddingText({
            title: String(item.title),
            type: String(item.type),
            content: String(item.content ?? ""),
            performanceInsights: item.performanceInsights
              ? String(item.performanceInsights)
              : undefined,
          }),
        };
      }),
    ];
    const changed = candidates.filter((candidate) =>
      !candidate.hasEmbedding
      || candidate.currentHash !== embeddingHash(config, candidate.text));
    const embeddings = await (deps.embed ?? embedTexts)(
      config,
      changed.map((candidate) => candidate.text),
      config.documentInputType,
    );
    const updates = changed.map((candidate, index) => ({
      id: candidate.id,
      kind: candidate.kind,
      hash: embeddingHash(config, candidate.text),
      embedding: embeddings[index],
    }));
    const catalogUpdates = updates.filter((item) => item.kind === "catalog");
    const contentUpdates = updates.filter((item) => item.kind === "content");
    if (catalogUpdates.length > 0) {
      await session.run(
        `UNWIND $items AS row
         MATCH (item:CatalogItem {id: row.id})
         SET item.opportunityEmbedding = vecf32(row.embedding),
             item.opportunityEmbeddingHash = row.hash,
             item.opportunityEmbeddingModel = $embeddingModel,
             item.opportunityEmbeddingDimensions = $embeddingDimensions`,
        {
          items: catalogUpdates,
          embeddingModel: config.embeddingModel,
          embeddingDimensions: config.embeddingDimensions,
        },
      );
    }
    if (contentUpdates.length > 0) {
      await session.run(
        `UNWIND $items AS row
         MATCH (content:ContentDraft {id: row.id})
         SET content.opportunityEmbedding = vecf32(row.embedding),
             content.opportunityEmbeddingHash = row.hash,
             content.opportunityEmbeddingModel = $embeddingModel,
             content.opportunityEmbeddingDimensions = $embeddingDimensions`,
        {
          items: contentUpdates,
          embeddingModel: config.embeddingModel,
          embeddingDimensions: config.embeddingDimensions,
        },
      );
    }
    return {
      catalog: catalogResult.records.length,
      content: contentResult.records.length,
    };
  } finally {
    await session.close();
  }
}

export async function getAccountOpportunityCoverage(input: {
  accountId: string;
  accountEligible: boolean;
  thresholds?: OpportunityCoverageThresholds;
}): Promise<AccountOpportunityCoverageResult> {
  const thresholds = input.thresholds ?? DEFAULT_OPPORTUNITY_COVERAGE_THRESHOLDS;
  const opportunities = await listAccountOpportunityAngles(input.accountId);
  const unavailable = (reason: string): AccountOpportunityCoverageResult => ({
    calculationStatus: "unavailable",
    unavailableReason: reason,
    accountEligible: input.accountEligible,
    thresholds,
    opportunities: opportunities.map((opportunity) => ({
      ...opportunity,
      solutionMatches: [],
      contentMatches: [],
      coverage: null,
    })),
  });
  const config = prospectSemanticSearchConfigFromEnvironment();
  if (!config) return unavailable("Opportunity matching embeddings are not configured.");

  try {
    await syncOpportunityMatchEmbeddings(config);
    const matches = await getAccountOpportunitySimilarityMatches({
      accountId: input.accountId,
      embeddingModel: config.embeddingModel,
      embeddingDimensions: config.embeddingDimensions,
    });
    const matchedOpportunityIds = new Set(matches.map((item) => item.opportunityId));
    if (opportunities.some((opportunity) => !matchedOpportunityIds.has(opportunity.id))) {
      return unavailable("Opportunity embeddings need to be refreshed before coverage can be calculated.");
    }
    const byOpportunity = new Map(matches.map((item) => [item.opportunityId, item]));
    return {
      calculationStatus: "ready",
      accountEligible: input.accountEligible,
      thresholds,
      opportunities: opportunities.map((opportunity) => {
        const raw = byOpportunity.get(opportunity.id);
        const solutionMatches = (raw?.solutionMatches ?? []).map(({ similarity, ...match }) => ({
          ...match,
          score: similarityPercent(similarity),
        }));
        const contentMatches = (raw?.contentMatches ?? []).map(({ similarity, ...match }) => ({
          ...match,
          score: similarityPercent(similarity),
        }));
        return {
          ...opportunity,
          solutionMatches,
          contentMatches,
          coverage: calculateOpportunityCoverage(
            solutionMatches,
            contentMatches,
            input.accountEligible,
            thresholds,
          ),
        };
      }),
    };
  } catch (error) {
    log.error("outreach.account_opportunity_coverage.failed", error, {
      account_id: input.accountId,
    });
    return unavailable("Opportunity coverage could not be calculated right now.");
  }
}

/** Calculate the workspace feed once for dashboard consumers. */
export async function getWorkspaceAccountOpportunityCoverage(input: {
  thresholds?: OpportunityCoverageThresholds;
} = {}): Promise<WorkspaceAccountOpportunityCoverageResult> {
  const thresholds = input.thresholds ?? DEFAULT_OPPORTUNITY_COVERAGE_THRESHOLDS;
  const contexts = await listWorkspaceAccountOpportunityContexts();
  const accountEligible = (context: (typeof contexts)[number]): boolean =>
    !context.account.hardExcluded
    && context.account.icpScore != null
    && context.account.icpScore >= DEFAULT_QUALIFICATION_THRESHOLDS.icpMinimum;
  const unavailable = (reason: string): WorkspaceAccountOpportunityCoverageResult => ({
    calculationStatus: "unavailable",
    unavailableReason: reason,
    thresholds,
    opportunities: contexts.map((context) => ({
      ...context.opportunity,
      account: { ...context.account, eligible: accountEligible(context) },
      solutionMatches: [],
      contentMatches: [],
      coverage: null,
    })),
  });
  if (contexts.length === 0) {
    return { calculationStatus: "ready", thresholds, opportunities: [] };
  }
  const config = prospectSemanticSearchConfigFromEnvironment();
  if (!config) return unavailable("Opportunity matching embeddings are not configured.");

  try {
    await syncOpportunityMatchEmbeddings(config);
    const matches: OpportunitySimilarityMatches[] = [];
    for (const accountId of [...new Set(contexts.map((context) => context.account.id))]) {
      matches.push(...await getAccountOpportunitySimilarityMatches({
        accountId,
        embeddingModel: config.embeddingModel,
        embeddingDimensions: config.embeddingDimensions,
      }));
    }
    const matchedOpportunityIds = new Set(matches.map((item) => item.opportunityId));
    if (contexts.some((context) => !matchedOpportunityIds.has(context.opportunity.id))) {
      return unavailable("Outreach opportunity embeddings need to be refreshed before coverage can be calculated.");
    }
    const byOpportunity = new Map(matches.map((item) => [item.opportunityId, item]));
    return {
      calculationStatus: "ready",
      thresholds,
      opportunities: contexts.map((context) => {
        const raw = byOpportunity.get(context.opportunity.id);
        const solutionMatches = (raw?.solutionMatches ?? []).map(({ similarity, ...match }) => ({
          ...match,
          score: similarityPercent(similarity),
        }));
        const contentMatches = (raw?.contentMatches ?? []).map(({ similarity, ...match }) => ({
          ...match,
          score: similarityPercent(similarity),
        }));
        const eligible = accountEligible(context);
        return {
          ...context.opportunity,
          account: { ...context.account, eligible },
          solutionMatches,
          contentMatches,
          coverage: calculateOpportunityCoverage(
            solutionMatches,
            contentMatches,
            eligible,
            thresholds,
          ),
        };
      }),
    };
  } catch (error) {
    log.error("outreach.workspace_opportunity_coverage.failed", error);
    return unavailable("Outreach opportunity coverage could not be calculated right now.");
  }
}
