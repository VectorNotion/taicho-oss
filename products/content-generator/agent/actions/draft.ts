/**
 * generate_content_draft action — Mastra port of the LangGraph node.
 *
 * Spec: docs/agents/langgraph-migration-spec.md §4.
 * Ported faithfully from graph/src/agent/nodes/generate_content_draft.py:
 * Every registered content type injects mission/identity/voice into a
 * type-specific prompt and schema. Guards: throws NOT_REFINED unless the idea
 * is refined and INVALID_CONTENT_TYPE for an unknown content type.
 * createContentDraft creates a linked draft while the source idea remains
 * refined. Idea state and draft artifact state are intentionally independent.
 */
import { Agent } from '@mastra/core/agent';
import { registerObservedAgent } from '@content-automation/observability/ai';
import { routerModel } from '@content-automation/platform/agents/model';
import { emitProductEventFromContext } from '@content-automation/platform/events/emit';
import { z } from 'zod';
import { getSettings } from '@content-automation/platform/settings/repository';
import {
  getContentIdeaById,
  getContentDraftById,
  createContentDraft,
  queryRelatedPublishedContent,
} from '../../data/content-repository';
import { isContentType, type ContentDraft, type ContentIdea, type ContentType } from '../../domain/content';
import { formatGeneratedContent } from '../../domain/generated-content';
import type { ContentResonanceCandidate } from '../../domain/resonance-experiment';

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
  const result = await agent.generate(prompt, {
    structuredOutput: { schema },
    // Drafts are the longest generations; the provider default cap can
    // truncate mid-JSON and fail structured parsing.
    modelSettings: { temperature, maxOutputTokens: 32768 },
  });
  return result.object as z.infer<typeof schema>;
};

// --------------------------------------------------------------------------
// Schemas (ported from the four *Output Pydantic models).
// --------------------------------------------------------------------------

const videoScriptSchema = z.object({
  hook: z.string().describe('Opening hook (first 10 seconds)'),
  intro: z.string().describe('Introduction and context setting'),
  main_sections: z.array(z.string()).describe('Main content sections'),
  demo_notes: z.array(z.string()).describe('Notes for visual demonstrations'),
  conclusion: z.string().describe('Summary and key takeaways'),
  call_to_action: z.string().describe('End CTA'),
});

const blogPostSchema = z.object({
  title: z.string().describe('SEO-optimized title'),
  meta_description: z.string().describe('Meta description for SEO'),
  introduction: z.string().describe('Opening paragraph'),
  sections: z.array(z.string()).describe('Main content sections with headers'),
  code_examples: z.array(z.string()).describe('Code examples if applicable'),
  conclusion: z.string().describe('Concluding thoughts'),
});

const tweetThreadSchema = z.object({
  tweets: z.array(z.string()).describe('Individual tweets (each under 280 chars)'),
  thread_hook: z.string().describe('First tweet that hooks readers'),
});

const linkedInPostSchema = z.object({
  hook: z.string().describe('Opening line to stop the scroll'),
  body: z.string().describe('Main content (story, insight, value)'),
  call_to_action: z.string().describe('Engagement prompt'),
  hashtags: z.array(z.string()).describe('Relevant hashtags'),
});

const xPostSchema = z.object({
  post: z.string().max(280).describe('A complete standalone X post under 280 characters'),
});

const socialPostSchema = z.object({
  hook: z.string().describe('Opening line that earns attention'),
  body: z.string().describe('Channel-neutral social post body'),
  call_to_action: z.string().describe('Natural engagement prompt'),
  hashtags: z.array(z.string()).max(5).describe('Optional relevant hashtags'),
});

const adCampaignSchema = z.object({
  headline: z.string().max(60).describe('Campaign headline'),
  primary_text: z.string().max(500).describe('Primary ad copy'),
  description: z.string().max(150).describe('Supporting description'),
  call_to_action: z.string().max(40).describe('Button or action label'),
});

// --------------------------------------------------------------------------
// System prompts (ported verbatim from the four *_PROMPT templates).
// --------------------------------------------------------------------------

function whoYouAre(mission: string, identity: string, voice: string): string {
  return `## Who You Are

**Mission:**
${mission}

**Identity:**
${identity}

**Voice:**
${voice}`;
}

function videoScriptSystemPrompt(mission: string, identity: string, voice: string): string {
  return `You are an expert video scriptwriter who creates engaging educational content.

${whoYouAre(mission, identity, voice)}

## Task
Write a complete video script based on the refined idea and outline.
The script should be ready for recording with clear structure.

## Guidelines
- Hook must grab attention in the first 10 seconds
- Use conversational, natural language
- Include pauses and transition notes
- Add demo notes for visual elements
- Keep energy and pacing engaging
- End with clear call to action
- Target length: 5-15 minutes of content
`;
}

function blogPostSystemPrompt(mission: string, identity: string, voice: string): string {
  return `You are an expert technical writer who creates clear, valuable blog posts.

${whoYouAre(mission, identity, voice)}

## Task
Write a complete blog post in MDX format based on the refined idea.
Include code examples where relevant.

## Guidelines
- Use clear, scannable headers (## and ###)
- Include practical code examples
- Add callouts for important points using <Callout>
- Keep paragraphs short and readable
- Include internal links to related content
- Add citations to research sources
- Target length: 1000-2000 words
- Use MDX components: <Callout type="info|warning|tip">

## MDX Format
\`\`\`mdx
## Section Title

Content here...

<Callout type="tip">
Important insight here
</Callout>

\`\`\`code
// Code example
\`\`\`
\`\`\`
`;
}

function tweetThreadSystemPrompt(mission: string, identity: string, voice: string): string {
  return `You are an expert at writing viral Twitter threads that educate and engage.

${whoYouAre(mission, identity, voice)}

## Task
Write a tweet thread (5-10 tweets) based on the content idea.
Each tweet must be under 280 characters.

## Guidelines
- First tweet must hook and make people want to read more
- Each tweet should be standalone but connected
- Use numbers: "1/" format
- Include practical insights, not fluff
- End with a call to engage (retweet, follow, comment)
- Use line breaks for readability
- Avoid hashtag spam (1-2 max in last tweet)
`;
}

function linkedInPostSystemPrompt(mission: string, identity: string, voice: string): string {
  return `You are an expert at writing LinkedIn posts that build thought leadership.

${whoYouAre(mission, identity, voice)}

## Task
Write a LinkedIn post (under 1300 characters) that shares valuable insight.

## Guidelines
- Start with a hook that stops the scroll
- Use line breaks for readability (LinkedIn loves whitespace)
- Share a story or personal insight
- Provide actionable value
- End with a question or CTA to drive engagement
- 3-5 relevant hashtags at the end
- Professional but personable tone
`;
}

function xPostSystemPrompt(mission: string, identity: string, voice: string): string {
  return `You are an expert at writing concise standalone posts for X.

${whoYouAre(mission, identity, voice)}

## Task
Write one complete X post under 280 characters.

## Guidelines
- Prospect with the most interesting claim
- Make every word earn its place
- Keep the post useful without requiring a thread
- Use at most one relevant hashtag
- Do not label or number the post
`;
}

function socialPostSystemPrompt(mission: string, identity: string, voice: string): string {
  return `You are an expert social copywriter who adapts ideas into engaging channel-neutral posts.

${whoYouAre(mission, identity, voice)}

## Task
Write a complete social post with a hook, useful body, and natural call to action.

## Guidelines
- Make the opening understandable without prior context
- Use short paragraphs and concrete language
- Preserve factual claims from the source material
- Avoid platform-specific mechanics
- Use no more than five relevant hashtags
`;
}

function adCampaignSystemPrompt(mission: string, identity: string, voice: string): string {
  return `You are an expert performance copywriter who creates clear, credible ad campaigns.

${whoYouAre(mission, identity, voice)}

## Task
Create a structured ad campaign with headline, primary text, supporting description, and CTA.

## Guidelines
- Prospect with a specific customer outcome
- Keep claims grounded in the supplied idea
- Make the headline and primary text work together without repetition
- Avoid hype, fabricated urgency, and unsupported superlatives
- Use one concrete call to action
`;
}

// --------------------------------------------------------------------------
// User prompts (ported verbatim).
// --------------------------------------------------------------------------

function videoScriptUserPrompt(f: {
  title: string;
  description: string;
  outline: string;
  keyPoints: string;
  hook: string;
  citations: string;
  innerLinks: string;
}): string {
  return `Write a video script for:

**Title:** ${f.title}
**Description:** ${f.description}

**Outline:**
${f.outline}

**Key Points:**
${f.keyPoints}

**Hook/Angle:**
${f.hook}

**Research Citations:**
${f.citations}

**Related Content for References:**
${f.innerLinks}

Create a complete, engaging video script.`;
}

function blogPostUserPrompt(f: {
  title: string;
  description: string;
  outline: string;
  keyPoints: string;
  citations: string;
  innerLinks: string;
}): string {
  return `Write a blog post for:

**Title:** ${f.title}
**Description:** ${f.description}

**Outline:**
${f.outline}

**Key Points:**
${f.keyPoints}

**Research Citations:**
${f.citations}

**Related Content for Internal Links:**
${f.innerLinks}

Create a complete, well-structured blog post in MDX format.`;
}

function tweetThreadUserPrompt(f: {
  title: string;
  description: string;
  keyPoints: string;
  hook: string;
}): string {
  return `Write a tweet thread for:

**Title:** ${f.title}
**Description:** ${f.description}

**Key Points:**
${f.keyPoints}

**Hook/Angle:**
${f.hook}

Create a compelling 5-10 tweet thread.`;
}

function linkedInPostUserPrompt(f: {
  title: string;
  description: string;
  keyPoints: string;
  hook: string;
  cta: string;
}): string {
  return `Write a LinkedIn post for:

**Title:** ${f.title}
**Description:** ${f.description}

**Key Points:**
${f.keyPoints}

**Hook/Angle:**
${f.hook}

**Call to Action:**
${f.cta}

Create a compelling LinkedIn post under 1300 characters.`;
}

function compactContentUserPrompt(
  kind: 'X post' | 'social post' | 'ad campaign',
  f: {
    title: string;
    description: string;
    keyPoints: string;
    hook: string;
  },
): string {
  return `Write a ${kind} for:

**Title:** ${f.title}
**Description:** ${f.description}

**Key Points:**
${f.keyPoints}

**Hook/Angle:**
${f.hook}

Create a complete, publishable ${kind}.`;
}

// --------------------------------------------------------------------------
// Orchestrator.
// --------------------------------------------------------------------------

export interface DraftDeps {
  getSettings: typeof getSettings;
  getContentIdeaById: typeof getContentIdeaById;
  getContentDraftById: typeof getContentDraftById;
  queryRelatedPublishedContent: typeof queryRelatedPublishedContent;
  createContentDraft: typeof createContentDraft;
  generate: StructuredGenerate;
}

const defaultDeps: DraftDeps = {
  getSettings,
  getContentIdeaById,
  getContentDraftById,
  queryRelatedPublishedContent,
  createContentDraft,
  generate: defaultGenerate,
};

interface GenerationContext {
  idea: ContentIdea;
  mission: string;
  identity: string;
  voice: string;
  title: string;
  description: string;
  outlineText: string;
  keyPointsText: string;
  citationsText: string;
  innerLinksText: string;
  relatedContentIds: string[];
  hook: string;
}

interface VariationInput {
  index: number;
  sourceTitle: string;
  sourceContent: string;
}

function variationPrompt(input: VariationInput): string {
  return `

## Controlled variation

This is variation ${input.index} for an audience-resonance comparison.
Create a meaningfully different execution of the same idea while preserving
the original facts, offer, audience, voice, and content format. Change the
hook, framing, and structure enough for the comparison to learn something.
Return a complete standalone artifact. Do not mention this test or call the
output a variation.

**Original title:** ${input.sourceTitle}

**Original content:**
${input.sourceContent}`;
}

async function loadGenerationContext(idea: ContentIdea, deps: DraftDeps): Promise<GenerationContext> {
  const { mission, identity, voice } = await deps.getSettings();
  const outline = idea.outline ?? [];
  const keyPoints = idea.keyPoints ?? [];
  const suggestedCitations = idea.suggestedCitations ?? [];

  const sourceTopicIds = (idea.sourceTopics ?? []).map((topic) => topic.id).filter(Boolean);
  const relatedContent = await deps.queryRelatedPublishedContent(sourceTopicIds, 5);

  return {
    idea,
    mission,
    identity,
    voice,
    title: idea.title,
    description: idea.description,
    outlineText: outline.length ? outline.map((point) => `- ${point}`).join('\n') : 'No outline provided',
    keyPointsText: keyPoints.length ? keyPoints.map((point) => `- ${point}`).join('\n') : 'No key points',
    citationsText: suggestedCitations.length
      ? suggestedCitations.map((citation) => `- ${citation}`).join('\n')
      : 'No citations',
    innerLinksText: relatedContent.some((content) => content.publishedUrl)
      ? relatedContent
        .filter((content) => content.publishedUrl)
        .map((content) => `- [${content.title}](${content.publishedUrl})`)
        .join('\n')
      : 'No related content to link',
    relatedContentIds: relatedContent.map((content) => content.id).filter(Boolean),
    hook: idea.rationale ?? '',
  };
}

async function generateContentArtifact(input: {
  type: ContentType;
  context: GenerationContext;
  generate: StructuredGenerate;
  variation?: VariationInput;
}): Promise<{ title: string; content: string }> {
  const { type, context, generate, variation } = input;
  const suffix = variation ? variationPrompt(variation) : '';
  const agentSuffix = variation ? `-variation-${variation.index}` : '';
  let output: Record<string, unknown>;

  if (type === 'video_script') {
    output = await generate({
      agentId: `video-script-agent${agentSuffix}`,
      agentName: 'Video Script Agent',
      instructions: videoScriptSystemPrompt(context.mission, context.identity, context.voice),
      prompt: videoScriptUserPrompt({
        title: context.title,
        description: context.description,
        outline: context.outlineText,
        keyPoints: context.keyPointsText,
        hook: context.hook,
        citations: context.citationsText,
        innerLinks: context.innerLinksText,
      }) + suffix,
      schema: videoScriptSchema,
      temperature: variation ? 0.85 : 0.7,
    });
  } else if (type === 'blog_post') {
    output = await generate({
      agentId: `blog-post-agent${agentSuffix}`,
      agentName: 'Blog Post Agent',
      instructions: blogPostSystemPrompt(context.mission, context.identity, context.voice),
      prompt: blogPostUserPrompt({
        title: context.title,
        description: context.description,
        outline: context.outlineText,
        keyPoints: context.keyPointsText,
        citations: context.citationsText,
        innerLinks: context.innerLinksText,
      }) + suffix,
      schema: blogPostSchema,
      temperature: variation ? 0.82 : 0.7,
    });
  } else if (type === 'tweet_thread') {
    output = await generate({
      agentId: `x-thread-agent${agentSuffix}`,
      agentName: 'X Thread Agent',
      instructions: tweetThreadSystemPrompt(context.mission, context.identity, context.voice),
      prompt: tweetThreadUserPrompt({
        title: context.title,
        description: context.description,
        keyPoints: context.keyPointsText,
        hook: context.hook,
      }) + suffix,
      schema: tweetThreadSchema,
      temperature: variation ? 0.9 : 0.8,
    });
  } else if (type === 'x_post') {
    output = await generate({
      agentId: `x-post-agent${agentSuffix}`,
      agentName: 'X Post Agent',
      instructions: xPostSystemPrompt(context.mission, context.identity, context.voice),
      prompt: compactContentUserPrompt('X post', {
        title: context.title,
        description: context.description,
        keyPoints: context.keyPointsText,
        hook: context.hook,
      }) + suffix,
      schema: xPostSchema,
      temperature: variation ? 0.9 : 0.8,
    });
  } else if (type === 'social_post') {
    output = await generate({
      agentId: `social-post-agent${agentSuffix}`,
      agentName: 'Social Post Agent',
      instructions: socialPostSystemPrompt(context.mission, context.identity, context.voice),
      prompt: compactContentUserPrompt('social post', {
        title: context.title,
        description: context.description,
        keyPoints: context.keyPointsText,
        hook: context.hook,
      }) + suffix,
      schema: socialPostSchema,
      temperature: variation ? 0.9 : 0.78,
    });
  } else if (type === 'ad_campaign') {
    output = await generate({
      agentId: `ad-campaign-agent${agentSuffix}`,
      agentName: 'Ad Campaign Agent',
      instructions: adCampaignSystemPrompt(context.mission, context.identity, context.voice),
      prompt: compactContentUserPrompt('ad campaign', {
        title: context.title,
        description: context.description,
        keyPoints: context.keyPointsText,
        hook: context.hook,
      }) + suffix,
      schema: adCampaignSchema,
      temperature: variation ? 0.88 : 0.72,
    });
  } else {
    output = await generate({
      agentId: `linkedin-post-agent${agentSuffix}`,
      agentName: 'LinkedIn Post Agent',
      instructions: linkedInPostSystemPrompt(context.mission, context.identity, context.voice),
      prompt: linkedInPostUserPrompt({
        title: context.title,
        description: context.description,
        keyPoints: context.keyPointsText,
        hook: context.hook,
        cta: 'What do you think?',
      }) + suffix,
      schema: linkedInPostSchema,
      temperature: variation ? 0.85 : 0.7,
    });
  }

  return {
    title: type === 'blog_post' && typeof output.title === 'string' ? output.title : context.title,
    content: formatGeneratedContent(type, output),
  };
}

export async function runGenerateContentDraft(
  payload: { ideaId: string; contentType: string },
  options: { deps?: Partial<DraftDeps> } = {},
): Promise<{ draftId: string }> {
  const deps = { ...defaultDeps, ...options.deps };
  const { ideaId, contentType } = payload;

  if (!isContentType(contentType)) {
    throw new Error('INVALID_CONTENT_TYPE');
  }

  const idea = await deps.getContentIdeaById(ideaId);
  if (!idea) {
    throw new Error('IDEA_NOT_FOUND');
  }
  if (idea.status !== 'refined') {
    throw new Error('NOT_REFINED');
  }

  const context = await loadGenerationContext(idea, deps);
  const artifact = await generateContentArtifact({
    type: contentType,
    context,
    generate: deps.generate,
  });

  const draft = await deps.createContentDraft({
    ideaId,
    title: artifact.title,
    type: contentType,
    content: artifact.content,
    citations: [],
    innerLinks: context.relatedContentIds,
  });

  // Deliberately NOT emitted from runGenerateContentVariation: resonance
  // variation candidates are not persisted drafts.
  emitProductEventFromContext({
    name: 'draft.ready',
    refs: { draftId: draft.id },
    payload: { ideaId, contentType },
  });

  return { draftId: draft.id };
}

export async function runGenerateContentVariation(
  payload: { sourceDraftId: string; variationIndex: number },
  options: { deps?: Partial<DraftDeps> } = {},
): Promise<ContentResonanceCandidate> {
  const deps = { ...defaultDeps, ...options.deps };
  const source = await deps.getContentDraftById(payload.sourceDraftId) as ContentDraft | null;
  if (!source) throw new Error('DRAFT_NOT_FOUND');
  if (!Number.isInteger(payload.variationIndex) || payload.variationIndex < 1 || payload.variationIndex > 20) {
    throw new Error('INVALID_VARIATION_INDEX');
  }

  const idea = await deps.getContentIdeaById(source.ideaId);
  if (!idea) throw new Error('IDEA_NOT_FOUND');
  if (idea.status !== 'refined') throw new Error('NOT_REFINED');

  const context = await loadGenerationContext(idea, deps);
  const artifact = await generateContentArtifact({
    type: source.type,
    context,
    generate: deps.generate,
    variation: {
      index: payload.variationIndex,
      sourceTitle: source.title,
      sourceContent: source.content,
    },
  });

  return {
    id: `variation-${payload.variationIndex}`,
    label: `Variation ${payload.variationIndex}`,
    title: artifact.title,
    content: artifact.content,
    contentType: source.type,
    original: false,
  };
}

export async function runGenerateContentVariations(
  payload: { sourceDraftId: string; variationCount: number },
  options: {
    deps?: Partial<DraftDeps>;
    onVariationStart?: (index: number) => void;
    onVariationComplete?: (candidate: ContentResonanceCandidate, index: number) => void;
  } = {},
): Promise<{ candidates: ContentResonanceCandidate[] }> {
  if (!Number.isInteger(payload.variationCount) || payload.variationCount < 1 || payload.variationCount > 20) {
    throw new Error('INVALID_VARIATION_COUNT');
  }

  const candidates: ContentResonanceCandidate[] = [];
  for (let index = 1; index <= payload.variationCount; index += 1) {
    options.onVariationStart?.(index);
    const candidate = await runGenerateContentVariation(
      { sourceDraftId: payload.sourceDraftId, variationIndex: index },
      { deps: options.deps },
    );
    candidates.push(candidate);
    options.onVariationComplete?.(candidate, index);
  }
  return { candidates };
}
