/**
 * Shared action registry for request-scoped and MCP operation execution.
 *
 * Each handler receives a camelCase operation payload plus an operation id and
 * adapts those fields to the product orchestrator.
 */

// Content-generator orchestrators (products/content-generator/agent/actions/*).
import { runDoResearch } from '@/products/content-generator/agent/actions/research';
import { runBuildProjectGraph } from '@/products/content-generator/agent/actions/project-graph';
import { runGenerateContentIdeas } from '@/products/content-generator/agent/actions/ideas';
import { runRefineContentIdea } from '@/products/content-generator/agent/actions/refine';
import { generatePostFromCreativeAssets } from '@/products/content-generator/media/service';
import { runExtractTopics } from '@/products/content-generator/agent/actions/topics';
import {
  readyPublishingPool,
  scheduleDraftPost,
} from '@/products/content-generator/publishing/schedule-draft';

// Outreach orchestrators (products/outreach/agent/*).
import { runProspectResearch } from '@/products/outreach/agent/prospect-research';
import { runAccountResearch } from '@/products/outreach/agent/account-research';
import { generateOutreach } from '@/products/outreach/agent/generator';
import { runQualifyProspect } from '@/products/outreach/agent/qualify-prospect';
import { generateProspectInsights } from '@/products/outreach/agent/prospect-insights';
import type { DimensionProgress, ResearchActivity } from '@/products/outreach/agent/dimension-progress';
import { getProspectById } from '@/products/outreach/data/prospect-repository';
import { resolveAccountForProspect } from '@/products/outreach/data/account-repository';
import { getProspectCatalogItem } from '@/products/outreach/data/catalog-repository';
import { catalogItemContext } from '@/products/outreach/domain/catalog';
import type { OutreachMedium } from '@/products/outreach/domain/types';
import { requireGraphOrganizationId } from '../data/organization-context';
import type { ExecutableAction } from './contracts';
import { runAddToFunnel } from './add-to-funnel';

/**
 * A background action handler: adapts the route payload, invokes the
 * orchestrator, and returns whatever becomes the job's `result` JSONB.
 */
export type ActionHandler = (
  payload: Record<string, unknown>,
  jobId: string,
  context?: ActionExecutionContext,
) => Promise<unknown>;

export interface ActionExecutionContext {
  reportProgress?: (input: { progress: number; result: Record<string, unknown> }) => Promise<void>;
}

type ResearchBackgroundTarget = { prospectId: string; phase: 'researching' };

const PHASE_WEIGHT: Record<DimensionProgress['phase'], number> = {
  searching: 0.2,
  found: 0.65,
  matched: 1,
};

function durableResearchProgress(
  mode: 'account' | 'prospect',
  reportProgress?: ActionExecutionContext['reportProgress'],
) {
  const dimensions = new Map<string, DimensionProgress>();
  const backgroundTargets = new Map<string, ResearchBackgroundTarget>();
  const activities: Array<ResearchActivity & { id: string }> = [];
  const activeQueries = new Map<string, string>();
  const startedAt = new Date().toISOString();
  let activitySequence = 0;
  let queriesStarted = 0;
  let queriesCompleted = 0;
  let pagesFound = 0;
  let pagesRead = 0;
  let pagesFailed = 0;
  let pending = Promise.resolve();

  function scopeFor(part: DimensionProgress) {
    return part.scope ?? (mode === 'prospect' ? 'person' : 'account');
  }

  function snapshot() {
    const lanes = [...dimensions.values()];
    return {
      kind: 'dimension-research' as const,
      dimensions: lanes,
      backgroundTargets: [...backgroundTargets.values()].map((target) => ({
        entityId: target.prospectId,
        scope: 'person' as const,
        phase: target.phase,
      })),
      telemetry: {
        startedAt,
        queriesStarted,
        queriesCompleted,
        pagesFound,
        pagesRead,
        pagesFailed,
        activeQueries: [...activeQueries.values()],
        activities: activities.slice(-60),
      },
      updatedAt: new Date().toISOString(),
    };
  }

  function publish() {
    if (!reportProgress) return;
    const lanes = [...dimensions.values()];
    const average = (scope: 'person' | 'account') => {
      const scoped = lanes.filter((lane) => scopeFor(lane) === scope);
      return scoped.length === 0
        ? 0
        : scoped.reduce((total, lane) => total + PHASE_WEIGHT[lane.phase], 0) / scoped.length;
    };
    const executionScope = mode === 'account' ? 'account' : 'person';
    const computed = dimensions.size === 0
      ? 5
      : 5 + average(executionScope) * 90;
    pending = pending
      .then(() => reportProgress({
        progress: Math.min(95, Math.round(computed)),
        result: { progressSnapshot: snapshot() },
      }))
      .catch(() => undefined);
  }

  return {
    onDimension(part: DimensionProgress) {
      const scope = scopeFor(part);
      const key = `${scope}:${part.dimensionKey}`;
      const previous = dimensions.get(key);
      dimensions.set(key, { ...previous, ...part, scope });
      publish();
    },
    onProspect(part: ResearchBackgroundTarget) {
      backgroundTargets.set(part.prospectId, part);
      publish();
    },
    onActivity(part: ResearchActivity) {
      const key = `${part.scope}:${part.dimensionKey ?? part.type}`;
      if (part.type === 'query_started') {
        queriesStarted += 1;
        if (part.query) activeQueries.set(key, part.query);
      } else if (part.type === 'query_completed' || part.type === 'query_failed') {
        queriesCompleted += 1;
        activeQueries.delete(key);
        pagesFound += part.pagesFound ?? 0;
        pagesRead += part.pagesRead ?? 0;
        pagesFailed += part.pagesFailed ?? 0;
      }
      activities.push({ ...part, id: `research-activity-${++activitySequence}` });
      publish();
    },
    snapshot,
    flush: () => pending,
  };
}

function durableOutreachProgress(
  reportProgress?: ActionExecutionContext['reportProgress'],
) {
  const progressByStage = {
    context: { running: 10, complete: 35 },
    draft: { running: 40, complete: 75 },
    save: { running: 80, complete: 95 },
  } as const;
  let pending = Promise.resolve();
  return {
    onProgress: (step: {
      id: 'context' | 'draft' | 'save';
      label: string;
      state: 'running' | 'complete';
    }) => {
      if (!reportProgress) return;
      pending = pending.then(() => reportProgress({
        progress: progressByStage[step.id][step.state],
        result: {
          progressSnapshot: {
            kind: 'outreach-generation',
            phase: step.id,
            label: step.label,
            state: step.state,
            updatedAt: new Date().toISOString(),
          },
        },
      }));
    },
    flush: () => pending,
  };
}

// `resonance_run` is dispatched by Modal and deliberately has no entry here.
export const actionHandlers: Record<ExecutableAction, ActionHandler> = {
  // --- content ---------------------------------------------------------------
  //
  // The content orchestrators take camelCase payloads matching the route field
  // names, so adaptation here is a typed passthrough of the relevant fields.

  // Route sends { sourceIds, timeRange } (DoResearchPayload).
  do_research: async (payload) =>
    runDoResearch({
      sourceIds: payload.sourceIds as string[] | undefined,
      timeRange: payload.timeRange as string | undefined,
    }),

  // Route sends { projectId } (spec §2).
  build_project_graph: async (payload) =>
    runBuildProjectGraph({ projectId: payload.projectId as string }),

  // Route sends { count } (spec §3).
  generate_content_ideas: async (payload) =>
    runGenerateContentIdeas({ count: payload.count as number | undefined }),

  // Route sends { ideaId } (spec §5).
  refine_content_idea: async (payload) =>
    runRefineContentIdea({ ideaId: payload.ideaId as string }),

  // Route sends the Content Base plus the images selected before generation.
  generate_content_draft: async (payload) =>
    generatePostFromCreativeAssets({
      organizationId: requireGraphOrganizationId(),
      userId: 'system',
      assetIds: payload.mediaAssetIds as string[],
      contentType: payload.contentType as string,
      expectedContentBaseId: payload.ideaId as string,
    }),

  // Spec §6: no payload is used (route's daysBack is ignored downstream).
  extract_topics: async () => runExtractTopics(),

  // --- outreach --------------------------------------------------------------

  // Prospect and account research are separate durable executions. Product
  // surfaces may start both, but neither operation owns or cascades into the
  // other one's lifecycle.
  research_prospect: async (payload, _jobId, context) => {
    const progress = durableResearchProgress('prospect', context?.reportProgress);
    try {
      const result = await runProspectResearch(payload.prospectId as string, {
        cascade: false,
        forceRefresh: true,
        onDimension: progress.onDimension,
        onActivity: progress.onActivity,
      });
      return { ...result, progressSnapshot: progress.snapshot() };
    } finally {
      await progress.flush();
    }
  },

  // ICP fit + timing research for this account only. Requalifying or
  // researching related prospects is a separate operation.
  research_account: async (payload, _jobId, context) => {
    const progress = durableResearchProgress('account', context?.reportProgress);
    try {
      const prospectId = typeof payload.prospectId === 'string' ? payload.prospectId : null;
      const prospect = prospectId ? await getProspectById(prospectId) : null;
      if (prospectId && !prospect) throw new Error(`Prospect not found: ${prospectId}`);
      const resolvedAccount = prospect ? await resolveAccountForProspect(prospect) : null;
      const accountId = typeof payload.accountId === 'string' && payload.accountId.trim()
        ? payload.accountId
        : resolvedAccount?.id;
      if (!accountId) throw new Error('Add a company before researching the account.');
      const catalogItem = prospect?.catalogItemId ? await getProspectCatalogItem(prospect.id) : null;
      const result = await runAccountResearch(accountId, {
        cascade: false,
        forceRefresh: true,
        catalogItemId: catalogItem?.id,
        commercialContext: catalogItemContext(catalogItem),
        onDimension: progress.onDimension,
        onActivity: progress.onActivity,
      });
      return { ...result, progressSnapshot: progress.snapshot() };
    } finally {
      await progress.flush();
    }
  },

  // Route sends { prospectId }; the decision reads scores only (design §8).
  qualify_prospect: async (payload, _jobId, context) => {
    await context?.reportProgress?.({
      progress: 20,
      result: {
        progressSnapshot: {
          kind: 'qualification',
          phase: 'loading',
          label: 'Loading research scores and targeting policy',
          updatedAt: new Date().toISOString(),
        },
      },
    });
    const result = await runQualifyProspect(payload.prospectId as string);
    await context?.reportProgress?.({
      progress: 90,
      result: {
        progressSnapshot: {
          kind: 'qualification',
          phase: 'persisted',
          label: result.status === 'success' ? 'Qualification decision persisted' : 'Qualification completed without a decision',
          updatedAt: new Date().toISOString(),
        },
      },
    });
    return result;
  },

  // The operation id is also the insight snapshot id. If the snapshot write
  // landed before the worker receipt was persisted, a retry recovers that
  // exact revision without another model call or duplicate revision.
  refresh_prospect_insights: async (payload, jobId, context) => {
    await context?.reportProgress?.({
      progress: 15,
      result: {
        progressSnapshot: {
          kind: 'prospect-insights',
          phase: 'evidence',
          label: 'Loading current prospect evidence',
          updatedAt: new Date().toISOString(),
        },
      },
    });
    await context?.reportProgress?.({
      progress: 40,
      result: {
        progressSnapshot: {
          kind: 'prospect-insights',
          phase: 'generate',
          label: 'Generating a source-linked insight',
          updatedAt: new Date().toISOString(),
        },
      },
    });
    const insight = await generateProspectInsights({
      organizationId: requireGraphOrganizationId(),
      prospectId: payload.prospectId as string,
      reason: 'manual',
      snapshotId: jobId,
    });
    await context?.reportProgress?.({
      progress: 95,
      result: {
        progressSnapshot: {
          kind: 'prospect-insights',
          phase: 'persisted',
          label: `Insight revision ${insight.revision} persisted`,
          updatedAt: new Date().toISOString(),
        },
      },
    });
    return {
      insightId: insight.id,
      prospectId: insight.prospectId,
      revision: insight.revision,
      summary: insight.summary,
      insight,
    };
  },

  // --- shipping actions (spec 2026-07-31 §5 item 3) --------------------------

  // Payload: SchedulePostPayload. Frozen output feeds flow templating
  // ({{steps.<id>.output.postId}}). Org comes from AsyncLocalStorage — every
  // dispatcher establishes it.
  schedule_post: async (payload) => {
    const pool = await readyPublishingPool(requireGraphOrganizationId());
    const post = await scheduleDraftPost(pool, {
      draftId: payload.draftId as string,
      destination: payload.destination as string,
      channelId: payload.channelId as string | undefined,
      when: payload.when as string | undefined,
    });
    return {
      postId: post.id,
      publishAt: post.publishAt.toISOString(),
      destination: post.destination,
      channelId: post.channelId,
      draftId: post.draftId ?? (payload.draftId as string),
    };
  },

  // Payload: AddToFunnelPayload (prospectId → Cascade import rendezvous, or a
  // direct Cascade contactId).
  add_to_funnel: async (payload) =>
    runAddToFunnel({
      prospectId: payload.prospectId as string | undefined,
      contactId: payload.contactId as string | undefined,
      funnelId: payload.funnelId as string,
    }),

  // Payload: GenerateOutreachPayload. generateOutreach persists the draft
  // message itself (products/outreach/agent/generator.ts); this handler only
  // adapts and freezes the output shape. `message` preserves the MCP
  // operation's historical result key.
  generate_outreach: async (payload, jobId, context) => {
    const progress = durableOutreachProgress(context?.reportProgress);
    try {
      const result = await generateOutreach({
        prospectId: payload.prospectId as string,
        medium: payload.medium as OutreachMedium,
        targetContent: payload.targetContent as string | undefined,
        simulation: payload.__simulation as string | undefined,
        // The durable operation id is also the graph idempotency key. If a DB
        // write landed before the worker receipt failed, retry returns that
        // same message instead of creating another draft or follow-up.
        generationId: jobId,
      }, { onProgress: progress.onProgress });
      if (!result.success || !result.message) {
        throw new Error(result.error ?? 'Outreach generation failed.');
      }
      return {
        messageId: result.message.id,
        prospectId: result.message.prospectId,
        medium: result.message.medium,
        subject: result.message.subject ?? null,
        content: result.message.content,
        message: result.message,
        simulation: result.simulation ?? null,
      };
    } finally {
      await progress.flush();
    }
  },
};
