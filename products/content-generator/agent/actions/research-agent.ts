/**
 * Research-extraction agent (do_research §1).
 *
 * Ported from the deleted LangGraph `do_research` node's extraction chain
 * (`graph/src/agent/nodes/do_research.py`). The extraction prompt injects the
 * business `mission` and `identity` (loaded from Settings). Voice is
 * intentionally NOT injected — the Python prompt only used mission + identity.
 *
 * The agent is instantiated locally (no runtime.ts registration) so the model
 * target is resolved from the release-owned language runtime.
 */
import { Agent } from '@mastra/core/agent';
import { registerObservedAgent } from '@content-automation/observability/ai';
import { routerModel } from '@content-automation/platform/agents/model';
import { z } from 'zod';

/** Structured extraction schema — mirrors the Python `ExtractedResearchItems`. */
export const extractedResearchItemSchema = z.object({
  title: z.string().describe('Concise title summarizing the finding'),
  content: z.string().describe('2-3 sentence summary of the insight'),
  tags: z
    .array(z.string())
    .describe('3-5 relevant topic tags (lowercase, hyphenated)'),
  priority: z
    .enum(['low', 'medium', 'high'])
    .describe('Priority based on relevance and timeliness'),
});

export const extractedResearchItemsSchema = z.object({
  items: z
    .array(extractedResearchItemSchema)
    .describe('List of extracted research findings (max 5 per source)'),
});

export type ExtractedResearchItems = z.infer<typeof extractedResearchItemsSchema>;

/**
 * Build the extraction system prompt with mission/identity injected.
 * Ported verbatim from the Python `EXTRACTION_PROMPT` system message.
 */
export function buildResearchExtractionInstructions(
  mission: string,
  identity: string
): string {
  return `Extract valuable research insights from the provided search results.

## Context About Our Business

**Mission:**
${mission}

**Identity:**
${identity}

## Focus Areas (prioritize insights relevant to our mission)

- Emerging trends and technologies in our domain
- Best practices and patterns we can apply or teach
- Tools, frameworks, and methodologies relevant to our work
- Industry insights and case studies that support our expertise
- Content ideas and angles that align with our mission

## For Each Finding

- Create a concise, descriptive title
- Write a 2-3 sentence summary capturing the key insight
- Add 3-5 relevant tags (lowercase, hyphenated, e.g., "multi-agent", "graph-rag")
- Assess priority: high (trending/timely + relevant to mission), medium (valuable), low (nice-to-know)

Extract up to 5 most valuable findings. Return an empty list if content is not relevant or useful.`;
}

/** Instantiate the research-extraction agent for a given mission/identity. */
export function createResearchAgent(mission: string, identity: string): Agent {
  return registerObservedAgent(new Agent({
    id: 'research-extraction-agent',
    name: 'Research Extraction Agent',
    instructions: buildResearchExtractionInstructions(mission, identity),
    model: routerModel(),
  }), 'taicho-content-agents');
}
