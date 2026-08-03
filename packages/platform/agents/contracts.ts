import actionCatalog from './action-catalog.json';

export type Product = 'content' | 'outreach' | 'cascade' | 'resonance';

export type ContentAction =
  | 'build_project_graph'
  | 'do_research'
  | 'extract_topics'
  | 'refine_content_idea'
  | 'generate_content_ideas'
  | 'generate_content_draft'
  | 'schedule_post';

export type OutreachAction = 'research_lead' | 'qualify_lead' | 'generate_outreach';
export type CascadeAction = 'enroll_in_funnel';
export type ResonanceAction = 'resonance_run';
export type BackgroundAction =
  | ContentAction
  | OutreachAction
  | CascadeAction
  | ResonanceAction;

/**
 * Actions available through the shared request/MCP execution registry.
 * `resonance_run` is excluded because Modal executes it directly.
 */
export type ExecutableAction = Exclude<BackgroundAction, 'resonance_run'>;

export interface AgentCommand<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  product: Product;
  action: BackgroundAction;
  payload: TPayload;
}

export interface AgentResult<TData extends Record<string, unknown> = Record<string, unknown>> {
  status: 'success' | 'skipped' | 'error';
  data?: TData;
  error?: string;
}

export const ACTION_CATALOG = actionCatalog;

export function getActionProduct(action: BackgroundAction): Product {
  if ((ACTION_CATALOG.content as string[]).includes(action)) {
    return 'content';
  }
  if ((ACTION_CATALOG.outreach as string[]).includes(action)) {
    return 'outreach';
  }
  if ((ACTION_CATALOG.cascade as string[]).includes(action)) {
    return 'cascade';
  }
  if ((ACTION_CATALOG.resonance as string[]).includes(action)) {
    return 'resonance';
  }
  throw new Error(`Unknown background action: ${action}`);
}
