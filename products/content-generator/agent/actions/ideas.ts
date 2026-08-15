/**
 * generate_content_ideas action — Mastra port of the LangGraph node.
 *
 * Spec: docs/agents/langgraph-migration-spec.md §3.
 * Ported faithfully from graph/src/agent/nodes/generate_content_ideas.py:
 * "expert content strategist" system prompt (mission/identity/voice), temp 0.8,
 * batch schema of 3-5 format-agnostic ideas, then slice to `count` and persist.
 */
import { Agent } from '@mastra/core/agent';
import { registerObservedAgent } from '@content-automation/observability/ai';
import { observeWorkflowStep, traceable } from '@content-automation/observability';
import { routerModel } from '@content-automation/platform/agents/model';
import { z } from 'zod';
import { getSettings } from '@content-automation/platform/settings/repository';
import {
  queryContentGaps,
  queryHighPerformingContent,
  createContentIdea,
} from '../../data/content-repository';
import { getRecentResearchItems } from '../../data/research-repository';
import { getTopics } from '../../data/topic-repository';

// --------------------------------------------------------------------------
// Structured-output primitive (mirrors runProspectResearch's agent.generate path).
// The default constructs a Mastra Agent and calls generate() with
// structuredOutput + modelSettings. Tests inject a stub via deps.generate so no
// Agent is constructed and no model API is touched.
// --------------------------------------------------------------------------


export type StructuredGenerate = <S extends z.ZodType>(args: {
  agentId: string;
  agentName: string;
  instructions: string;
  prompt: string;
  schema: S;
  temperature: number;
}) => Promise<z.infer<S>>;

const defaultGenerate: StructuredGenerate = async ({
  agentId,
  agentName,
  instructions,
  prompt,
  schema,
  temperature,
}) => {
  const agent = registerObservedAgent(new Agent({
    id: agentId,
    name: agentName,
    instructions,
    model: routerModel(),
  }), 'taicho-content-agents');
  return traceable(
    async () => {
      const result = await agent.generate(prompt, {
        structuredOutput: { schema },
        modelSettings: { temperature },
      });
      return result.object as z.infer<typeof schema>;
    },
    {
      name: 'content.ideas.generate',
      kind: 'generation',
      processInputs: () => ({ agentId, agentName, instructions, prompt, temperature }),
    },
  )();
};

// --------------------------------------------------------------------------
// Schema (ported from ContentIdeasBatch / ContentIdeaOutput Pydantic models).
// --------------------------------------------------------------------------

const ideasBatchSchema = z.object({
  ideas: z
    .array(
      z.object({
        title: z.string().describe('Compelling title for the content idea'),
        description: z
          .string()
          .describe('1-2 sentence summary of what the content covers'),
        rationale: z
          .string()
          .describe('Why this content based on research and gaps'),
        priority: z
          .enum(['low', 'medium', 'high'])
          .describe('Priority based on research coverage and relevance'),
        source_topics: z
          .array(z.string())
          .describe('Topic names that inspired this idea'),
      }),
    )
    .describe('List of 3-5 content ideas'),
});

// --------------------------------------------------------------------------
// Prompts (ported verbatim from CONTENT_IDEAS_PROMPT).
// --------------------------------------------------------------------------

function ideasSystemPrompt(mission: string, identity: string, voice: string): string {
  return `You are an expert content strategist who creates compelling content ideas from research insights.

## Who You Are

**Mission:**
${mission}

**Identity:**
${identity}

**Voice:**
${voice}

## Task
Generate 3-5 content ideas based on the research insights and topic gaps provided.
Each idea should be actionable, specific, and grounded in the research.

## Guidelines
- Generate FORMAT-AGNOSTIC ideas (do NOT specify content type)
- Each idea can later become a video, blog post, tweet thread, or LinkedIn post
- Prioritize topics with more research coverage (higher priority)
- Consider content gaps - topics that need more content
- Make titles compelling and specific, not generic
- Rationale should reference specific research or gaps
- Source topics should match the topic names provided
`;
}

function ideasUserPrompt(
  researchInsights: string,
  topics: string,
  contentGaps: string,
  highPerformingPatterns: string,
): string {
  return `Generate content ideas based on this context:

## Recent Research Insights
${researchInsights}

## Active Topics
${topics}

## Content Gaps (Topics needing content)
${contentGaps}

## High-Performing Content Patterns
${highPerformingPatterns}

Generate 3-5 content ideas that would resonate with our audience and fill gaps in our content.`;
}

// --------------------------------------------------------------------------
// Orchestrator.
// --------------------------------------------------------------------------

export interface IdeasDeps {
  getSettings: typeof getSettings;
  getRecentResearchItems: typeof getRecentResearchItems;
  getTopics: typeof getTopics;
  queryContentGaps: typeof queryContentGaps;
  queryHighPerformingContent: typeof queryHighPerformingContent;
  createContentIdea: typeof createContentIdea;
  generate: StructuredGenerate;
}

const defaultDeps: IdeasDeps = {
  getSettings,
  getRecentResearchItems,
  getTopics,
  queryContentGaps,
  queryHighPerformingContent,
  createContentIdea,
  generate: defaultGenerate,
};

async function runGenerateContentIdeasInternal(
  payload: { count?: number },
  options: { deps?: Partial<IdeasDeps> } = {},
): Promise<{ ideasCreated: number }> {
  const deps = { ...defaultDeps, ...options.deps };
  const count = payload.count ?? 5;

  const context = await observeWorkflowStep('content.ideas.load_context', {
    kind: 'data',
    input: { researchWindowDays: 14, includeDismissedTopics: false },
    processOutput: (output) => {
      const value = output as {
        researchItems: unknown[];
        topicsResponse: { topics: unknown[] };
        contentGaps: unknown[];
        highPerforming: unknown[];
      };
      return {
        researchItemCount: value.researchItems.length,
        topicCount: value.topicsResponse.topics.length,
        contentGapCount: value.contentGaps.length,
        highPerformingCount: value.highPerforming.length,
      };
    },
  }, async () => {
    const [{ mission, identity, voice }, researchItems, topicsResponse, contentGaps, highPerforming] =
      await Promise.all([
        deps.getSettings(),
      deps.getRecentResearchItems(14),
      deps.getTopics(false),
      deps.queryContentGaps(10),
      deps.queryHighPerformingContent(5),
      ]);
    return { mission, identity, voice, researchItems, topicsResponse, contentGaps, highPerforming };
  });
  const { mission, identity, voice, researchItems, topicsResponse, contentGaps, highPerforming } = context;

  const topics = topicsResponse.topics;

  const researchInsights = researchItems.length
    ? researchItems
        .slice(0, 10)
        .map(
          (item) =>
            `- **${item.title || 'Untitled'}**: ${(item.content || '').slice(0, 200)}...`,
        )
        .join('\n')
    : 'No recent research available.';

  const topicsText = topics.length
    ? topics
        .slice(0, 15)
        .map((t) => `- ${t.displayName || t.name || 'Unknown'}`)
        .join('\n')
    : 'No active topics.';

  const gapsText = contentGaps.length
    ? contentGaps
        .map(
          (gap) =>
            `- **${gap.topicName || 'Unknown'}** (priority: ${gap.suggestedPriority || 'medium'}, research items: ${gap.researchCount ?? 0})`,
        )
        .join('\n')
    : 'No obvious content gaps identified.';

  const patternsText = highPerforming.length
    ? highPerforming
        .map(
          (p) =>
            `- **${p.title || 'Untitled'}** (${p.type || 'unknown'}): ${p.insights || 'No insights'}`,
        )
        .join('\n')
    : 'No high-performing content to learn from yet.';

  const batch = await deps.generate({
    agentId: 'content-ideas-agent',
    agentName: 'Content Ideas Agent',
    instructions: ideasSystemPrompt(mission, identity, voice),
    prompt: ideasUserPrompt(researchInsights, topicsText, gapsText, patternsText),
    schema: ideasBatchSchema,
    temperature: 0.8,
  });

  // Build topic lookup (displayName||name lowercased -> id) to map idea topic
  // names back to graph ids, mirroring the Python topic_lookup.
  const topicLookup = new Map<string, string>();
  for (const t of topics) {
    const key = (t.displayName || t.name || '').toLowerCase();
    if (key) topicLookup.set(key, t.id);
  }

  const ideasCreated = await observeWorkflowStep('content.ideas.persist', {
    kind: 'persistence',
    input: { generatedCount: batch.ideas.length, requestedCount: count },
    processOutput: (output) => ({ ideasCreated: output }),
  }, async () => {
    let created = 0;
    for (const idea of batch.ideas.slice(0, count)) {
      const sourceTopicIds: string[] = [];
      for (const name of idea.source_topics) {
        const id = topicLookup.get(name.toLowerCase());
        if (id) sourceTopicIds.push(id);
      }

      await deps.createContentIdea({
        title: idea.title,
        description: idea.description,
        rationale: idea.rationale,
        priority: idea.priority,
        sourceTopicIds: sourceTopicIds.length > 0 ? sourceTopicIds : undefined,
      });
      created += 1;
    }
    return created;
  });

  return { ideasCreated };
}

export const runGenerateContentIdeas = traceable(runGenerateContentIdeasInternal, {
  name: 'content.ideas.generate_workflow',
  kind: 'workflow',
  processInputs: ([payload]) => payload,
});
