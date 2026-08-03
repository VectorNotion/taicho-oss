/**
 * Topic-extraction agent (extract_topics §6).
 *
 * Ported from the deleted LangGraph `extract_topics` node's extraction chain
 * (`graph/src/agent/nodes/extract_topics.py`). The Python prompt did NOT inject
 * mission/identity/voice — it works purely from the formatted project entities
 * and the list of existing topic names. Ported faithfully (no settings).
 *
 * The formatted entities and existing-topic-name list are dynamic per call, so
 * they are injected into the system instructions and the agent is instantiated
 * per call (model resolved at call time from MODEL_NAME).
 */
import { Agent } from '@mastra/core/agent';
import { registerObservedAgent } from '@content-automation/observability/ai';
import { routerModel } from '@content-automation/platform/agents/model';
import { z } from 'zod';

/** Structured extraction schema — mirrors the Python `ExtractedTopics`. */
export const extractedTopicSchema = z.object({
  name: z
    .string()
    .describe(
      "Lowercase, hyphenated canonical name (e.g., 'multi-agent-systems')"
    ),
  display_name: z
    .string()
    .describe("Human-friendly capitalized name (e.g., 'Multi-Agent Systems')"),
  description: z
    .string()
    .describe('1-2 sentences explaining what this topic covers'),
  source_entities: z
    .array(z.string())
    .describe('List of entity names this topic is based on'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('0.0-1.0 score for how strongly this emerged as a topic'),
});

export const extractedTopicsSchema = z.object({
  topics: z
    .array(extractedTopicSchema)
    .describe('List of extracted topics (5-15 distinct topics)'),
});

export type ExtractedTopics = z.infer<typeof extractedTopicsSchema>;

/**
 * Build the topic-extraction system prompt with the formatted entities and the
 * existing topic names injected. Ported verbatim from the Python
 * `EXTRACTION_PROMPT` system message.
 */
export function buildTopicExtractionInstructions(
  entitiesFormatted: string,
  existingTopicNames: string
): string {
  return `You are analyzing project entities to identify content topics.

These entities were extracted from projects in our knowledge graph. Entities are ordered by
how many projects use them (project_count). Higher count = more universally relevant topic.

Entity Types:
- AIComponent: AI/ML patterns and architectures (STRONG topic candidates)
- Feature: Specific capabilities (STRONG topic candidates)
- BusinessValue: Business outcomes and benefits (can inform topic angles)

Entities (ordered by project usage, with weighted scores):
${entitiesFormatted}

Existing Topics (DO NOT recreate these - they already exist):
${existingTopicNames}

Generate 5-15 content topics based on these entities:
1. AIComponent and Feature entities are your primary topic sources
2. BusinessValue entities can inform the angle or benefit of a topic
3. You can COMBINE related entities into a single topic (e.g., "Real-time processing" + "Audio transcription" → "real-time-transcription")
4. Topic should be specific enough for focused content but general enough for multiple pieces
5. Include source_entities to track which entities informed each topic

Return an empty list if no meaningful new topics can be extracted.`;
}

/** Instantiate the topic-extraction agent for a given entity/topic context. */
export function createTopicsAgent(
  entitiesFormatted: string,
  existingTopicNames: string
): Agent {
  return registerObservedAgent(new Agent({
    id: 'topic-extraction-agent',
    name: 'Topic Extraction Agent',
    instructions: buildTopicExtractionInstructions(
      entitiesFormatted,
      existingTopicNames
    ),
    model: routerModel(),
  }), 'taicho-content-agents');
}
