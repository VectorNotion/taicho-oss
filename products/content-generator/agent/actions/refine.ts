/**
 * refine_content_idea action — Mastra port of the LangGraph node.
 *
 * Spec: docs/agents/langgraph-migration-spec.md §5.
 * Ported faithfully from graph/src/agent/nodes/refine_content_idea.py:
 * "refine into a detailed actionable outline" system prompt
 * (mission/identity/voice), temp 0.7. Guard: throws ALREADY_REFINED when the
 * idea is already refined (the Python node's 400). Persists only
 * status/outline/keyPoints/suggestedCitations — hook / call_to_action /
 * inner_link_suggestions are intentionally NOT persisted (matches Python).
 */
import { Agent } from '@mastra/core/agent';
import { registerObservedAgent } from '@content-automation/observability/ai';
import { observeWorkflowStep, traceable } from '@content-automation/observability';
import { routerModel } from '@content-automation/platform/agents/model';
import { z } from 'zod';
import { getSettings } from '@content-automation/platform/settings/repository';
import {
  getContentIdeaById,
  updateContentIdea,
  queryRelatedPublishedContent,
} from '../../data/content-repository';
import { getResearchItemsByTopicIds } from '../../data/research-repository';

// --------------------------------------------------------------------------
// Structured-output primitive (see ideas.ts for rationale).
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
      name: 'content.idea.refine',
      kind: 'generation',
      processInputs: () => ({ agentId, agentName, instructions, prompt, temperature }),
    },
  )();
};

// --------------------------------------------------------------------------
// Schema (ported from RefinedIdeaOutput Pydantic model).
// --------------------------------------------------------------------------

const refinedIdeaSchema = z.object({
  outline: z
    .array(z.string())
    .describe('Detailed outline with 5-10 main points/sections'),
  key_points: z
    .array(z.string())
    .describe('3-5 key takeaways the audience should learn'),
  suggested_citations: z
    .array(z.string())
    .describe('Research items to cite (by title)'),
  inner_link_suggestions: z
    .array(z.string())
    .describe('Titles of related content to link to'),
  hook: z.string().describe('Compelling opening hook or angle for the content'),
  call_to_action: z
    .string()
    .describe('What action should the audience take after consuming this'),
});

// --------------------------------------------------------------------------
// Prompts (ported verbatim from REFINE_IDEA_PROMPT).
// --------------------------------------------------------------------------

function refineSystemPrompt(mission: string, identity: string, voice: string): string {
  return `You are an expert content strategist who refines content ideas into actionable outlines.

## Who You Are

**Mission:**
${mission}

**Identity:**
${identity}

**Voice:**
${voice}

## Task
Take the content idea and refine it into a detailed, actionable outline.
Use the research context and related content to enrich the idea.

## Guidelines
- Create a logical flow from introduction to conclusion
- Each outline point should be specific, not generic
- Key points should be memorable takeaways
- Suggest citations from the research provided
- Suggest inner-links to related content for cross-referencing
- The hook should grab attention immediately
- Call to action should align with the content type

## Content Type Considerations
- video_script: Hook in first 10 seconds, clear visual demonstrations
- blog_post: Scannable sections, code examples where relevant
- tweet_thread: Each tweet standalone but connected, numbered
- linkedin_post: Professional insight, personal angle, clear value
`;
}

function refineUserPrompt(fields: {
  title: string;
  contentType: string;
  description: string;
  targetPlatform: string;
  rationale: string;
  researchContext: string;
  relatedContent: string;
  sourceTopics: string;
}): string {
  return `Refine this content idea:

## Original Idea
**Title:** ${fields.title}
**Type:** ${fields.contentType}
**Description:** ${fields.description}
**Target Platform:** ${fields.targetPlatform}
**Rationale:** ${fields.rationale}

## Related Research (for citations)
${fields.researchContext}

## Related Published Content (for inner-linking)
${fields.relatedContent}

## Source Topics
${fields.sourceTopics}

Create a refined outline with key points, citations, and inner-linking opportunities.`;
}

// --------------------------------------------------------------------------
// Orchestrator.
// --------------------------------------------------------------------------

export interface RefineDeps {
  getSettings: typeof getSettings;
  getContentIdeaById: typeof getContentIdeaById;
  queryRelatedPublishedContent: typeof queryRelatedPublishedContent;
  getResearchItemsByTopicIds: typeof getResearchItemsByTopicIds;
  updateContentIdea: typeof updateContentIdea;
  generate: StructuredGenerate;
}

const defaultDeps: RefineDeps = {
  getSettings,
  getContentIdeaById,
  queryRelatedPublishedContent,
  getResearchItemsByTopicIds,
  updateContentIdea,
  generate: defaultGenerate,
};

async function runRefineContentIdeaInternal(
  payload: { ideaId: string },
  options: { deps?: Partial<RefineDeps> } = {},
): Promise<{ refined: true }> {
  const deps = { ...defaultDeps, ...options.deps };
  const { ideaId } = payload;

  const idea = await observeWorkflowStep('content.idea.load', {
    kind: 'data',
    input: { ideaId },
    processOutput: (output) => {
      const value = output as Awaited<ReturnType<typeof getContentIdeaById>>;
      return value ? { found: true, status: value.status, sourceTopicCount: value.sourceTopics?.length ?? 0 } : { found: false };
    },
  }, () => deps.getContentIdeaById(ideaId));
  if (!idea) {
    throw new Error('IDEA_NOT_FOUND');
  }
  if (idea.status === 'refined') {
    // Python node returns a 400 when the idea is already refined.
    throw new Error('ALREADY_REFINED');
  }

  const sourceTopics = idea.sourceTopics ?? [];
  const sourceTopicIds = sourceTopics.map((t) => t.id).filter(Boolean);
  const sourceResearch = idea.sourceResearch ?? [];

  const { mission, identity, voice, relatedContent, researchItems } = await observeWorkflowStep(
    'content.idea.load_refinement_context',
    {
      kind: 'data',
      input: { ideaId, sourceTopicIds },
      processOutput: (output) => {
        const value = output as { relatedContent: unknown[]; researchItems: unknown[] };
        return { relatedContentCount: value.relatedContent.length, researchItemCount: value.researchItems.length };
      },
    },
    async () => {
      const [{ mission, identity, voice }, relatedContent, researchItems] = await Promise.all([
        deps.getSettings(),
        deps.queryRelatedPublishedContent(sourceTopicIds, 5),
        sourceTopicIds.length
          ? deps.getResearchItemsByTopicIds(sourceTopicIds, 10)
          : Promise.resolve([] as Awaited<ReturnType<typeof getResearchItemsByTopicIds>>),
      ]);
      return { mission, identity, voice, relatedContent, researchItems };
    },
  );

  // Combine idea's own source research (title only) with topic-derived research
  // items (title/content/url), matching the Python (source_research + research_items).
  const combinedResearch = [
    ...sourceResearch.map((r) => ({ title: r.title, content: '', sourceUrl: 'N/A' })),
    ...researchItems.map((r) => ({
      title: r.title,
      content: r.content,
      sourceUrl: r.sourceUrl,
    })),
  ];

  const researchContext =
    sourceResearch.length || researchItems.length
      ? combinedResearch
          .slice(0, 10)
          .map(
            (r) =>
              `- **${r.title || 'Untitled'}**: ${(r.content || '').slice(0, 200)}... (URL: ${r.sourceUrl || 'N/A'})`,
          )
          .join('\n')
      : 'No related research available.';

  const relatedContentText = relatedContent.length
    ? relatedContent
        .map(
          (c) =>
            `- **${c.title || 'Untitled'}** (${c.type || 'unknown'}): ${c.publishedUrl || 'No URL'}`,
        )
        .join('\n')
    : 'No related published content yet.';

  const sourceTopicsText = sourceTopics.length
    ? sourceTopics.map((t) => t.name || 'Unknown').join(', ')
    : 'No specific topics';

  // Ideas are format-agnostic in the TS model — type/targetPlatform are absent,
  // so these always resolve to the Python defaults.
  const contentType = (idea as { type?: string }).type ?? 'blog_post';
  const targetPlatform = (idea as { targetPlatform?: string }).targetPlatform ?? 'blog';

  const refined = await deps.generate({
    agentId: 'refine-idea-agent',
    agentName: 'Refine Content Idea Agent',
    instructions: refineSystemPrompt(mission, identity, voice),
    prompt: refineUserPrompt({
      title: idea.title,
      contentType,
      description: idea.description,
      targetPlatform,
      rationale: idea.rationale,
      researchContext,
      relatedContent: relatedContentText,
      sourceTopics: sourceTopicsText,
    }),
    schema: refinedIdeaSchema,
    temperature: 0.7,
  });

  await observeWorkflowStep('content.idea.persist_refinement', {
    kind: 'persistence',
    input: { ideaId, outlinePoints: refined.outline.length, keyPoints: refined.key_points.length },
    processOutput: () => ({ refined: true }),
  }, () => deps.updateContentIdea(ideaId, {
      status: 'refined',
      outline: refined.outline,
      keyPoints: refined.key_points,
      suggestedCitations: refined.suggested_citations,
    }));

  return { refined: true };
}

export const runRefineContentIdea = traceable(runRefineContentIdeaInternal, {
  name: 'content.idea.refine_workflow',
  kind: 'workflow',
  processInputs: ([payload]) => payload,
});
