import type { LucideIcon } from 'lucide-react';
import {
  BookOpenText,
  Bot,
  BrainCircuit,
  CheckCircle2,
  FilePenLine,
  GitBranch,
  Globe2,
  ListChecks,
  MessageSquareText,
  Radar,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserRoundSearch,
  UsersRound,
  Workflow,
} from 'lucide-react';

export type DemoPhase =
  | 'acknowledge'
  | 'interpret'
  | 'search'
  | 'evidence'
  | 'delegate'
  | 'synthesize'
  | 'complete';

export interface PhaseSpec {
  id: DemoPhase;
  shortLabel: string;
  label: string;
  visibleCopy: string;
  target: string;
  motion: string;
}

export const PHASES: PhaseSpec[] = [
  {
    id: 'acknowledge',
    shortLabel: 'Ack',
    label: 'Acknowledge',
    visibleCopy: 'I’ll check your workspace first, then verify anything that may be out of date.',
    target: '≤ 250 ms',
    motion: 'Message fades up 4 px; composer clears immediately.',
  },
  {
    id: 'interpret',
    shortLabel: 'Intent',
    label: 'Orient',
    visibleCopy: 'Looking for a matching prospect and your relationship history.',
    target: '≤ 400 ms',
    motion: 'One calm activity row expands beneath the acknowledgement.',
  },
  {
    id: 'search',
    shortLabel: 'Search',
    label: 'Search local knowledge',
    visibleCopy: 'Searching prospects for “Aisha Rahman”…',
    target: 'start ≤ 500 ms',
    motion: 'A scanning highlight crosses the active tool row; partial matches stream in.',
  },
  {
    id: 'evidence',
    shortLabel: 'Evidence',
    label: 'Load evidence',
    visibleCopy: 'Found one match. Loading relationship history and recent activity in parallel.',
    target: 'local result ≤ 2 s',
    motion: 'The search row settles to a check; the prospect card grows in place without layout jump.',
  },
  {
    id: 'delegate',
    shortLabel: 'Delegate',
    label: 'Delegate only if useful',
    visibleCopy: 'Scout is verifying the current company context.',
    target: 'visible ≤ 100 ms after call',
    motion: 'The specialist joins the same work rail; status and scope remain visible.',
  },
  {
    id: 'synthesize',
    shortLabel: 'Answer',
    label: 'Synthesize',
    visibleCopy: 'Bringing your history and Scout’s update into one answer.',
    target: 'first words ≤ 800 ms after evidence',
    motion: 'Work collapses to a compact receipt while answer text streams above it.',
  },
  {
    id: 'complete',
    shortLabel: 'Done',
    label: 'Complete with a next step',
    visibleCopy: 'Yes—you know Aisha. She is already a qualified prospect with two prior touchpoints.',
    target: 'no dead air > 700 ms',
    motion: 'Sources and suggested actions appear last; focus stays in the composer.',
  },
];

export interface DemoRuntimeEvent {
  id: string;
  event: string;
  phase: DemoPhase;
  source: 'client' | 'rlm' | 'tool' | 'specialist';
  delayMs: number;
  summary: string;
  targets: string[];
}

/** Mock runtime events used only by the standalone spec playback. */
export const DEMO_EVENT_SCRIPT: DemoRuntimeEvent[] = [
  { id: 'evt-01', event: 'interaction.submitted', phase: 'acknowledge', source: 'client', delayMs: 0, summary: 'Optimistically append the user message.', targets: ['CHAT-03', 'CHAT-05'] },
  { id: 'evt-02', event: 'assistant.ack', phase: 'acknowledge', source: 'rlm', delayMs: 350, summary: 'Confirm the interpreted outcome.', targets: ['CHAT-04', 'WORK-01'] },
  { id: 'evt-03', event: 'assistant.intent', phase: 'interpret', source: 'rlm', delayMs: 700, summary: 'Publish the concise plan and required evidence.', targets: ['WORK-02', 'WORK-03'] },
  { id: 'evt-04', event: 'tool.started', phase: 'search', source: 'rlm', delayMs: 850, summary: 'Select findProspect and expose the tool start.', targets: ['WORK-03', 'WORK-04'] },
  { id: 'evt-05', event: 'tool.progress', phase: 'search', source: 'tool', delayMs: 650, summary: 'Stream a partial prospect match.', targets: ['WORK-04', 'DATA-01'] },
  { id: 'evt-06', event: 'entity.discovered', phase: 'evidence', source: 'tool', delayMs: 900, summary: 'Resolve the prospect and relationship summary.', targets: ['DATA-01', 'DATA-06'] },
  { id: 'evt-07', event: 'tools.parallel.started', phase: 'evidence', source: 'rlm', delayMs: 650, summary: 'Load notes, outreach, and nurture concurrently.', targets: ['WORK-02', 'WORK-03'] },
  { id: 'evt-08', event: 'delegation.started', phase: 'delegate', source: 'rlm', delayMs: 850, summary: 'Give Scout a bounded freshness check.', targets: ['AGENT-01', 'AGENT-02'] },
  { id: 'evt-09', event: 'delegation.progress', phase: 'delegate', source: 'specialist', delayMs: 950, summary: 'Stream verified source progress.', targets: ['AGENT-02'] },
  { id: 'evt-10', event: 'delegation.completed', phase: 'synthesize', source: 'specialist', delayMs: 850, summary: 'Return current role evidence to Taicho.', targets: ['AGENT-03', 'AGENT-04'] },
  { id: 'evt-11', event: 'assistant.delta', phase: 'synthesize', source: 'rlm', delayMs: 650, summary: 'Begin the evidence-grounded answer.', targets: ['RESP-01'] },
  { id: 'evt-12', event: 'assistant.completed', phase: 'complete', source: 'rlm', delayMs: 1_000, summary: 'Attach sources and contextual next actions.', targets: ['WORK-05', 'DATA-06', 'RESP-02'] },
];

export interface ToolGroup {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  tone: string;
  tools: Array<{
    name: string;
    purpose: string;
    policy: 'automatic' | 'conditional' | 'confirmation';
  }>;
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'knowledge',
    title: 'Workspace knowledge',
    description: 'Fast, read-only access to the facts already in Taicho.',
    icon: Search,
    tone: 'text-sky-300',
    tools: [
      { name: 'searchKnowledge', purpose: 'Search prospects, projects, research, topics, drafts, and articles.', policy: 'automatic' },
      { name: 'findProspect / getProspect', purpose: 'Resolve a person by name and load the full relationship record.', policy: 'automatic' },
      { name: 'getRelationshipHistory', purpose: 'Retrieve notes, outreach, replies, meetings, and nurture activity.', policy: 'automatic' },
      { name: 'listProjects / getProject', purpose: 'Find relevant products, proof, entities, and related research.', policy: 'automatic' },
      { name: 'searchResearch / listTopics', purpose: 'Retrieve evidence, sources, topic coverage, and knowledge gaps.', policy: 'automatic' },
    ],
  },
  {
    id: 'web',
    title: 'Current web research',
    description: 'Used when freshness matters or the workspace has a gap.',
    icon: Globe2,
    tone: 'text-cyan-300',
    tools: [
      { name: 'webSearch', purpose: 'Discover current, relevant sources from a natural-language query.', policy: 'conditional' },
      { name: 'readPage', purpose: 'Extract and cite the useful content from a known URL.', policy: 'conditional' },
      { name: 'researchPerson', purpose: 'Verify role, company, public work, and recent context.', policy: 'conditional' },
      { name: 'researchCompany', purpose: 'Summarize positioning, changes, signals, and likely needs.', policy: 'conditional' },
    ],
  },
  {
    id: 'create',
    title: 'Content creation',
    description: 'Structured generation grounded in selected evidence.',
    icon: FilePenLine,
    tone: 'text-violet-300',
    tools: [
      { name: 'generateContentIdeas', purpose: 'Turn evidence and topic gaps into ranked content angles.', policy: 'conditional' },
      { name: 'refineContentIdea', purpose: 'Strengthen the promise, audience, evidence, and format.', policy: 'conditional' },
      { name: 'generateDraft', purpose: 'Create a draft in the captain’s voice for a chosen channel.', policy: 'conditional' },
      { name: 'draftOutreach', purpose: 'Create channel-aware outreach grounded in the prospect record.', policy: 'conditional' },
    ],
  },
  {
    id: 'actions',
    title: 'Workspace actions',
    description: 'Writes are previewed and require an explicit boundary before side effects.',
    icon: ShieldCheck,
    tone: 'text-amber-300',
    tools: [
      { name: 'createOrUpdateProspect', purpose: 'Create a record or apply proposed field changes.', policy: 'confirmation' },
      { name: 'saveNote / saveDraft', purpose: 'Persist generated work to the selected entity.', policy: 'confirmation' },
      { name: 'sendOutreach', purpose: 'Send an approved message through the chosen channel.', policy: 'confirmation' },
      { name: 'publishContent', purpose: 'Publish or schedule an approved draft.', policy: 'confirmation' },
      { name: 'enrollInNurture', purpose: 'Add a prospect to a named cadence with visible consequences.', policy: 'confirmation' },
    ],
  },
  {
    id: 'orchestration',
    title: 'Squad orchestration',
    description: 'Specialists add depth; they never replace the main conversation.',
    icon: Workflow,
    tone: 'text-emerald-300',
    tools: [
      { name: 'delegateToSquad', purpose: 'Assign a bounded task to Scout, Gatekeeper, Cartographer, Muse, Scribe, or Herald.', policy: 'conditional' },
      { name: 'runInParallel', purpose: 'Execute independent reads or specialist tasks concurrently.', policy: 'conditional' },
      { name: 'cancelWork', purpose: 'Abort the active model, tools, and specialist tasks quickly.', policy: 'automatic' },
    ],
  },
];

export interface SurfaceSpec {
  id: string;
  title: string;
  purpose: string;
  driver: string;
  settledDriver: string;
  activeState: string;
  settledState: string;
  enters: string;
  active: string;
  settles: string;
  icon: LucideIcon;
}

export const SURFACES: SurfaceSpec[] = [
  {
    id: 'WORK-01',
    title: 'Intent Acknowledgement',
    purpose: 'Confirms what Taicho understood before expensive work begins.',
    driver: 'assistant.ack',
    settledDriver: 'assistant.ack.completed',
    activeState: 'appearing',
    settledState: 'stable',
    enters: '0–250 ms',
    active: 'One sentence; updates only if scope changes.',
    settles: 'Becomes the opening line of the answer.',
    icon: MessageSquareText,
  },
  {
    id: 'WORK-02',
    title: 'Activity Rail',
    purpose: 'Shows meaningful progress across tools and specialists without exposing chain-of-thought.',
    driver: 'activity.started',
    settledDriver: 'activity.completed',
    activeState: 'running',
    settledState: 'complete',
    enters: '≤ 400 ms',
    active: 'One active row, completed rows compress.',
    settles: 'Collapses to a “3 sources · 2 tools” receipt.',
    icon: ListChecks,
  },
  {
    id: 'WORK-04',
    title: 'Tool Progress Card',
    purpose: 'Shows tool-specific progress and reveals partial matches as they arrive.',
    driver: 'tool.progress',
    settledDriver: 'tool.completed',
    activeState: 'partial',
    settledState: 'complete',
    enters: 'first result in place',
    active: 'Skeletons resolve individually; order stays stable.',
    settles: 'Keeps the strongest results, with “show all”.',
    icon: Radar,
  },
  {
    id: 'DATA-01',
    title: 'Prospect Result Card',
    purpose: 'Turns prospect tool output into an immediately recognizable relationship record.',
    driver: 'entity.discovered',
    settledDriver: 'entity.hydrated',
    activeState: 'skeleton',
    settledState: 'complete',
    enters: 'fade + 4 px rise',
    active: 'Fields fill progressively; no card reshuffle.',
    settles: 'Actions appear only after the entity is usable.',
    icon: UserRoundSearch,
  },
  {
    id: 'DATA-03',
    title: 'Article Result Card',
    purpose: 'Presents current evidence with source, freshness, excerpt, and citation link.',
    driver: 'entity.discovered',
    settledDriver: 'entity.hydrated',
    activeState: 'partial',
    settledState: 'complete',
    enters: 'first source in place',
    active: 'Individual sources resolve without reordering.',
    settles: 'Strongest evidence remains; duplicates compress.',
    icon: BookOpenText,
  },
  {
    id: 'AGENT-05',
    title: 'Delegation Runway',
    purpose: 'Animates dependent specialist work as a coherent linear handoff into Taicho’s synthesis.',
    driver: 'delegation.plan.created',
    settledDriver: 'synthesis.completed',
    activeState: 'routing',
    settledState: 'synthesized',
    enters: 'Taicho publishes the routed plan',
    active: 'Specialists enter in order, stream updates, and hand contribution packets forward.',
    settles: 'All contributions converge into one evidence-grounded answer.',
    icon: UsersRound,
  },
  {
    id: 'RESP-01',
    title: 'Answer Stream',
    purpose: 'Streams the useful conclusion while slow secondary evidence can continue below.',
    driver: 'assistant.delta',
    settledDriver: 'assistant.completed',
    activeState: 'streaming',
    settledState: 'complete',
    enters: 'as soon as answerable',
    active: 'Sentence-level streaming; sources attach to claims.',
    settles: 'Suggested next actions arrive after the answer.',
    icon: Sparkles,
  },
  {
    id: 'ACTION-01',
    title: 'Approval Gate',
    purpose: 'Creates a hard boundary before writes, sends, publishes, or enrollments.',
    driver: 'approval.required',
    settledDriver: 'approval.granted',
    activeState: 'required',
    settledState: 'approved',
    enters: 'after preview is complete',
    active: 'Shows exact change, destination, and consequence.',
    settles: 'Success receipt replaces buttons; undo if supported.',
    icon: ShieldCheck,
  },
  {
    id: 'ACTION-04',
    title: 'Recovery Card',
    purpose: 'Keeps partial results and offers a precise retry when one dependency fails.',
    driver: 'activity.failed',
    settledDriver: 'activity.recovered',
    activeState: 'recoverable',
    settledState: 'recovered',
    enters: 'in place of failed row',
    active: 'Names the failed source and what remains usable.',
    settles: 'Retry updates only the failed segment.',
    icon: GitBranch,
  },
];

export type ComponentCategory = 'Conversation' | 'Work' | 'Data' | 'Delegation' | 'Response' | 'Action';

export interface ComponentSpec {
  id: string;
  name: string;
  category: ComponentCategory;
  purpose: string;
  states: string[];
}

/**
 * Canonical vocabulary for chatbot review and implementation.
 * IDs and names are stable once approved; visual treatments may evolve.
 */
export const COMPONENT_CATALOG: ComponentSpec[] = [
  { id: 'CHAT-01', name: 'Conversation Shell', category: 'Conversation', purpose: 'Owns the thread viewport, layout, scrolling, and responsive geometry.', states: ['empty', 'active', 'loading history', 'offline'] },
  { id: 'CHAT-02', name: 'Conversation Header', category: 'Conversation', purpose: 'Shows Taicho identity, thread context, history, and conversation controls.', states: ['default', 'connected', 'degraded'] },
  { id: 'CHAT-03', name: 'User Message Bubble', category: 'Conversation', purpose: 'Displays the submitted request and any user attachments.', states: ['sent', 'editing', 'failed'] },
  { id: 'CHAT-04', name: 'Assistant Message Block', category: 'Conversation', purpose: 'Groups Taicho’s acknowledgement, work, answer, evidence, and actions.', states: ['starting', 'streaming', 'complete', 'error'] },
  { id: 'CHAT-05', name: 'Composer', category: 'Conversation', purpose: 'Accepts prompts and attachments while keeping send, stop, and retry predictable.', states: ['empty', 'ready', 'sending', 'running', 'disabled'] },
  { id: 'CHAT-06', name: 'Suggestion Prompt', category: 'Conversation', purpose: 'Offers a high-value starter or contextual follow-up without sending automatically.', states: ['starter', 'contextual', 'dismissed'] },
  { id: 'CHAT-07', name: 'Conversation History Drawer', category: 'Conversation', purpose: 'Lists, opens, renames, and deletes saved conversations.', states: ['closed', 'loading', 'loaded', 'empty', 'error'] },

  { id: 'WORK-01', name: 'Intent Acknowledgement', category: 'Work', purpose: 'Confirms the interpreted outcome before expensive work starts.', states: ['appearing', 'stable', 'scope updated'] },
  { id: 'WORK-02', name: 'Activity Rail', category: 'Work', purpose: 'Contains visible progress across tools and specialists without exposing private chain-of-thought.', states: ['running', 'paused', 'complete', 'partial failure'] },
  { id: 'WORK-03', name: 'Activity Step', category: 'Work', purpose: 'Names one meaningful unit of work with owner, status, and concise detail.', states: ['pending', 'active', 'complete', 'failed', 'cancelled'] },
  { id: 'WORK-04', name: 'Tool Progress Card', category: 'Work', purpose: 'Shows tool-specific progress and streams partial results into stable geometry.', states: ['queued', 'running', 'partial', 'complete', 'failed'] },
  { id: 'WORK-05', name: 'Work Receipt', category: 'Work', purpose: 'Compresses completed work into a durable count of tools, sources, and specialists.', states: ['collapsed', 'expanded'] },
  { id: 'WORK-06', name: 'Stop Control', category: 'Work', purpose: 'Cancels the active model, tools, and delegated work without discarding completed results.', states: ['available', 'stopping', 'stopped'] },
  { id: 'WORK-07', name: 'Inference Ticker', category: 'Work', purpose: 'Shows a dim mono summary of live inference in the exact place the answer will appear; the first tokens replace it in place. Bottom-anchored window — long thoughts keep the newest text visible and fade overflow out the top, never growing the block.', states: ['thinking', 'overflowing', 'compressed', 'hidden'] },

  { id: 'DATA-01', name: 'Prospect Result Card', category: 'Data', purpose: 'Shows identity, qualification, relationship history, and relevant prospect actions.', states: ['skeleton', 'partial', 'complete', 'stale'] },
  { id: 'DATA-02', name: 'Project Result Card', category: 'Data', purpose: 'Shows project summary, status, proof, entities, and related research.', states: ['skeleton', 'partial', 'complete', 'archived'] },
  { id: 'DATA-03', name: 'Article Result Card', category: 'Data', purpose: 'Shows title, source, date, reading time, excerpt, and citation link.', states: ['skeleton', 'partial', 'complete', 'unavailable'] },
  { id: 'DATA-04', name: 'Research Result List', category: 'Data', purpose: 'Ranks multiple evidence items while preserving provenance and freshness.', states: ['streaming', 'complete', 'filtered', 'empty'] },
  { id: 'DATA-06', name: 'Source Chip', category: 'Data', purpose: 'Attaches a compact, inspectable provenance marker to a claim or result.', states: ['workspace', 'web', 'specialist', 'unavailable'] },
  { id: 'DATA-07', name: 'Empty Result', category: 'Data', purpose: 'States what was searched, what was not found, and the best next recovery action.', states: ['no match', 'no access', 'not indexed'] },
  { id: 'DATA-08', name: 'X Post Preview', category: 'Data', purpose: 'Renders a drafted X post in timeline anatomy — author row, text, thread position, expected metrics.', states: ['streaming', 'complete', 'over limit', 'scheduled'] },
  { id: 'DATA-09', name: 'LinkedIn Post Preview', category: 'Data', purpose: 'Shows a drafted LinkedIn post with the see-more fold placed where readers will meet it.', states: ['streaming', 'complete', 'over fold', 'scheduled'] },
  { id: 'DATA-10', name: 'YouTube Video Card', category: 'Data', purpose: 'Previews title, thumbnail framing, duration, and channel metadata for a cut before scheduling.', states: ['skeleton', 'complete', 'missing thumbnail', 'scheduled'] },
  { id: 'DATA-11', name: 'Blog Article Preview', category: 'Data', purpose: 'Shows the article hero — category, title, dek, reading time — as the blog will render it.', states: ['skeleton', 'complete', 'draft', 'published'] },
  { id: 'DATA-12', name: 'YouTube Short', category: 'Data', purpose: 'Previews a vertical 9:16 Short — cover framing, overlay title, handle, and action rail in Shorts anatomy.', states: ['skeleton', 'complete', 'missing cover', 'scheduled'] },
  { id: 'DATA-13', name: 'Instagram Reel', category: 'Data', purpose: 'Previews a Reel — cover, caption, audio line, and action rail as Instagram renders it.', states: ['skeleton', 'complete', 'missing cover', 'scheduled'] },

  { id: 'AGENT-01', name: 'Delegation Card', category: 'Delegation', purpose: 'Shows why Taicho delegated, the specialist, task scope, and elapsed time.', states: ['assigned', 'running', 'complete', 'failed', 'cancelled'] },
  { id: 'AGENT-02', name: 'Specialist Status Row', category: 'Delegation', purpose: 'Represents one specialist inside parallel delegated work.', states: ['queued', 'running', 'complete', 'failed'] },
  { id: 'AGENT-03', name: 'Specialist Receipt', category: 'Delegation', purpose: 'Preserves the specialist contribution, evidence, and confidence after completion.', states: ['collapsed', 'expanded'] },
  { id: 'AGENT-04', name: 'Synthesis Handoff', category: 'Delegation', purpose: 'Shows when Taicho takes completed specialist work back into the final answer.', states: ['waiting', 'synthesizing', 'complete'] },
  { id: 'AGENT-05', name: 'Delegation Runway', category: 'Delegation', purpose: 'Composes a linear multi-specialist plan, live updates, handoffs, and final synthesis into one animated surface.', states: ['planned', 'routing', 'specialist active', 'handoff', 'synthesizing', 'complete', 'paused'] },
  { id: 'AGENT-06', name: 'Specialist Stream Drawer', category: 'Delegation', purpose: 'Shows the latest safe specialist output while collapsed and reveals the full streamed work record on demand.', states: ['collapsed', 'streaming', 'expanded', 'complete', 'paused'] },

  { id: 'RESP-01', name: 'Answer Stream', category: 'Response', purpose: 'Streams the conclusion sentence by sentence as soon as evidence is sufficient.', states: ['starting', 'streaming', 'complete', 'interrupted'] },
  { id: 'RESP-02', name: 'Suggested Action Row', category: 'Response', purpose: 'Offers contextual next steps only after the answer is usable.', states: ['hidden', 'available', 'selected'] },
  { id: 'RESP-03', name: 'Clarification Prompt', category: 'Response', purpose: 'Asks one focused question when ambiguity would materially change the work.', states: ['open', 'answered', 'dismissed'] },

  { id: 'ACTION-01', name: 'Approval Gate', category: 'Action', purpose: 'Blocks consequential execution until the user explicitly confirms.', states: ['required', 'approved', 'declined', 'expired'] },
  { id: 'ACTION-02', name: 'Action Preview', category: 'Action', purpose: 'Shows the exact mutation, destination, editable fields, and consequences.', states: ['draft', 'edited', 'valid', 'invalid'] },
  { id: 'ACTION-03', name: 'Action Receipt', category: 'Action', purpose: 'Confirms what executed, where it happened, and whether undo is available.', states: ['success', 'partial', 'failed', 'undone'] },
  { id: 'ACTION-04', name: 'Recovery Card', category: 'Action', purpose: 'Keeps partial work and offers a precise retry for the failed segment.', states: ['recoverable', 'retrying', 'recovered', 'terminal'] },
];

export const PERFORMANCE_BUDGETS = [
  { metric: 'Composer response', target: '< 100 ms', meaning: 'Message appears and input clears immediately.' },
  { metric: 'Visible acknowledgement', target: '< 250 ms', meaning: 'The interface confirms intent before model output.' },
  { metric: 'Stream connection', target: '< 400 ms', meaning: 'Activity UI can begin; billing and bookkeeping do not block first byte.' },
  { metric: 'First model signal', target: 'p50 < 800 ms · p95 < 1.5 s', meaning: 'Router model starts text or a tool call.' },
  { metric: 'Local knowledge result', target: 'p50 < 1.2 s · p95 < 2.5 s', meaning: 'Prospect, project, topic, or research data becomes usable.' },
  { metric: 'Web evidence', target: 'first source < 3 s', meaning: 'Results stream progressively; slower sources never hold the whole answer.' },
  { metric: 'Cancellation', target: '< 150 ms', meaning: 'Model, tool, and delegated work receive abort immediately.' },
  { metric: 'Blank-wait ceiling', target: '< 700 ms', meaning: 'Some honest, useful state is always visible while work continues.' },
];

export const SQUAD = [
  { name: 'Scout', task: 'Verify person and company context', icon: UserRoundSearch, color: 'text-sky-300' },
  { name: 'Gatekeeper', task: 'Assess fit against active personas', icon: ShieldCheck, color: 'text-amber-300' },
  { name: 'Cartographer', task: 'Connect topics, entities, and evidence', icon: BrainCircuit, color: 'text-cyan-300' },
  { name: 'Muse', task: 'Develop grounded content angles', icon: Sparkles, color: 'text-violet-300' },
  { name: 'Scribe', task: 'Produce the selected draft', icon: FilePenLine, color: 'text-emerald-300' },
  { name: 'Herald', task: 'Adapt for channel and timing', icon: Send, color: 'text-rose-300' },
];

export const EVENT_CONTRACT = [
  { event: 'assistant.ack', payload: 'intent, scope', renderer: 'Acknowledgement line' },
  { event: 'activity.started', payload: 'label, category, cancellable', renderer: 'Active rail row' },
  { event: 'tool.progress', payload: 'tool, stage, partial', renderer: 'Tool-specific live surface' },
  { event: 'entity.discovered', payload: 'entity type, summary, provenance', renderer: 'Prospect/article/topic/project card' },
  { event: 'delegation.started', payload: 'specialist, task, reason', renderer: 'Delegation lane' },
  { event: 'delegation.completed', payload: 'specialist, contribution, evidence', renderer: 'Specialist receipt' },
  { event: 'assistant.delta', payload: 'answer text delta', renderer: 'Streaming answer' },
  { event: 'approval.required', payload: 'action, preview, consequence', renderer: 'Approval card' },
  { event: 'activity.failed', payload: 'source, recoverability, retained data', renderer: 'Inline recovery state' },
  { event: 'assistant.completed', payload: 'sources, actions, usage', renderer: 'Completion receipt' },
];

export const DECISIONS = [
  { icon: Bot, title: 'One voice', text: 'Taicho owns the conversation and final answer.' },
  { icon: Radar, title: 'Visible work', text: 'Intent, actions, evidence, and uncertainty—not private chain-of-thought.' },
  { icon: UsersRound, title: 'Inline specialists', text: 'Delegation appears inside the same answer, never as a surprise new chat.' },
  { icon: CheckCircle2, title: 'Progressive results', text: 'Useful evidence renders as it arrives; the slowest task does not gate everything.' },
  { icon: ShieldCheck, title: 'Safe actions', text: 'Reads are automatic. Consequential writes require explicit confirmation.' },
  { icon: BookOpenText, title: 'Evidence first', text: 'Claims connect to workspace records, sources, or named specialist output.' },
];
