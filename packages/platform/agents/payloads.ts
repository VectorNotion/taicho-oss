import type { ExecutableAction } from './contracts';

/**
 * Shipping-action payloads (spec 2026-07-31 §5 item 3). These are camelCase per
 * the frozen cross-plan contract; the older snake_case entries below are a
 * known pre-existing drift and are deliberately left alone.
 */
export interface SchedulePostPayload {
  draftId: string;
  destination: string;
  channelId?: string;
  when?: string;
}

export interface AddToFunnelPayload {
  prospectId?: string;
  contactId?: string;
  funnelId: string;
}

export interface GenerateOutreachPayload {
  prospectId: string;
  medium: 'inmail' | 'inmail_traditional' | 'email' | 'content_comment';
  targetContent?: string;
}

export interface ActionPayloads {
  build_project_graph: { project_id: string };
  do_research: { source_ids?: string[] };
  extract_topics: Record<string, never>;
  refine_content_idea: { idea_id: string };
  generate_content_ideas: { count: number };
  generate_content_draft: { idea_id: string; content_type: string; media_asset_ids: string[] };
  research_account: { account_id: string };
  research_prospect: { prospect_id: string };
  qualify_prospect: { prospect_id: string };
  refresh_prospect_insights: { prospect_id: string };
  schedule_post: SchedulePostPayload;
  add_to_funnel: AddToFunnelPayload;
  generate_outreach: GenerateOutreachPayload;
}

// `ActionPayloads` has keys for the shared executable actions, never
// `resonance_run` (Modal-dispatched, with no in-process payload shape here).
export type ActionPayload<TAction extends ExecutableAction> = ActionPayloads[TAction];
