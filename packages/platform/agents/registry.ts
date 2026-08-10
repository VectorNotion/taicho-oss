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
import { runGenerateContentDraft } from '@/products/content-generator/agent/actions/draft';
import { runExtractTopics } from '@/products/content-generator/agent/actions/topics';
import {
  readyPublishingPool,
  scheduleDraftPost,
} from '@/products/content-generator/publishing/schedule-draft';

// Outreach orchestrators + the research-input builder (products/outreach/agent/*).
import {
  runProspectResearch,
  buildResearchInput,
} from '@/products/outreach/agent/prospect-research';
import { generateOutreach } from '@/products/outreach/agent/generator';
import { runQualifyProspect } from '@/products/outreach/agent/qualify-prospect';
import { getProspectById } from '@/products/outreach/data/prospect-repository';
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
  jobId: string
) => Promise<unknown>;

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

  // Route sends { ideaId, contentType } (spec §4).
  generate_content_draft: async (payload) =>
    runGenerateContentDraft({
      ideaId: payload.ideaId as string,
      contentType: payload.contentType as string,
    }),

  // Spec §6: no payload is used (route's daysBack is ignored downstream).
  extract_topics: async () => runExtractTopics(),

  // --- outreach --------------------------------------------------------------

  // Route sends { prospectId }. The research orchestrator needs the full prospect
  // (name/company/title/location), so hydrate it here; runProspectResearch chains
  // qualify_prospect internally (failure non-fatal, matching the Python semantics).
  research_prospect: async (payload) => {
    const prospectId = payload.prospectId as string;
    const prospect = await getProspectById(prospectId);
    if (!prospect) {
      throw new Error(`Prospect not found: ${prospectId}`);
    }
    return runProspectResearch(buildResearchInput(prospect));
  },

  // Route sends { prospectId }; orchestrator takes the id directly (spec §8).
  qualify_prospect: async (payload) => runQualifyProspect(payload.prospectId as string),

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
  generate_outreach: async (payload) => {
    const result = await generateOutreach({
      prospectId: payload.prospectId as string,
      medium: payload.medium as OutreachMedium,
      targetContent: payload.targetContent as string | undefined,
      tenantId: process.env.CMS_TENANT_ID,
    });
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
    };
  },
};
