/**
 * Unit tests for the Mastra content actions (ideas / refine / draft).
 *
 * No network, no Neo4j: every repository call and the agent-generate primitive
 * are injected via the optional { deps } param. Run: node --import tsx --test.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { runWithExecutionContext } from '@content-automation/observability';
import {
  drainProductEvents,
  setProductEventSinkForTests,
} from '@content-automation/platform/events/emit';
import type { ProductEventInsert } from '@content-automation/platform/events/repository';

import { runGenerateContentIdeas } from '../agent/actions/ideas';
import { runRefineContentIdea } from '../agent/actions/refine';
import { runGenerateContentDraft, runGenerateContentVariation } from '../agent/actions/draft';

const SETTINGS = {
  id: 'global',
  mission: 'MISSION',
  identity: 'IDENTITY',
  voice: 'VOICE',
  updatedAt: '2026-07-20T00:00:00.000Z',
};

const getSettings = async () => SETTINGS;

function topicsResponse(topics: Array<Record<string, unknown>>) {
  return async () => ({
    topics: topics as never,
    total: topics.length,
    activeCount: topics.length,
    dismissedCount: 0,
  });
}

// ===========================================================================
// generate_content_ideas
// ===========================================================================

test('ideas: maps source_topics names -> ids and slices to count', async () => {
  const created: Array<Record<string, unknown>> = [];

  const result = await runGenerateContentIdeas(
    { count: 2 },
    {
      deps: {
        getSettings,
        getRecentResearchItems: async () => [],
        getTopics: topicsResponse([
          { id: 't1', name: 'ai-agents', displayName: 'AI Agents' },
          { id: 't2', name: 'rag', displayName: 'RAG' },
        ]),
        queryContentGaps: async () => [],
        queryHighPerformingContent: async () => [],
        createContentIdea: async (data) => {
          created.push(data);
          return { id: `idea-${created.length}`, ...data } as never;
        },
        // Return 3 ideas; count=2 should slice to the first two.
        generate: (async () => ({
          ideas: [
            {
              title: 'Idea A',
              description: 'desc',
              rationale: 'why',
              priority: 'high',
              // "AI Agents" matches t1 (case-insensitive); "Unknown" is dropped.
              source_topics: ['AI Agents', 'Unknown Topic'],
            },
            {
              title: 'Idea B',
              description: 'desc',
              rationale: 'why',
              priority: 'medium',
              source_topics: ['rag'],
            },
            {
              title: 'Idea C (should be sliced off)',
              description: 'desc',
              rationale: 'why',
              priority: 'low',
              source_topics: [],
            },
          ],
        })) as never,
      },
    },
  );

  assert.equal(result.ideasCreated, 2);
  assert.equal(created.length, 2);
  assert.deepEqual(created[0].sourceTopicIds, ['t1']);
  assert.deepEqual(created[1].sourceTopicIds, ['t2']);
  assert.equal(created[0].priority, 'high');
});

test('ideas: no topic matches -> sourceTopicIds undefined', async () => {
  const created: Array<Record<string, unknown>> = [];

  await runGenerateContentIdeas(
    {},
    {
      deps: {
        getSettings,
        getRecentResearchItems: async () => [],
        getTopics: topicsResponse([]),
        queryContentGaps: async () => [],
        queryHighPerformingContent: async () => [],
        createContentIdea: async (data) => {
          created.push(data);
          return { id: 'idea-x', ...data } as never;
        },
        generate: (async () => ({
          ideas: [
            {
              title: 'Idea',
              description: 'd',
              rationale: 'r',
              priority: 'low',
              source_topics: ['whatever'],
            },
          ],
        })) as never,
      },
    },
  );

  assert.equal(created.length, 1);
  assert.equal(created[0].sourceTopicIds, undefined);
});

// ===========================================================================
// refine_content_idea
// ===========================================================================

const baseIdea = {
  id: 'idea-1',
  title: 'My Idea',
  description: 'A description',
  rationale: 'The rationale',
  priority: 'medium' as const,
  status: 'idea' as const,
  sourceTopics: [{ id: 't1', name: 'AI Agents' }],
  sourceResearch: [{ id: 'r1', title: 'Prior research' }],
  createdAt: '',
  updatedAt: '',
};

test('refine: throws ALREADY_REFINED when idea is already refined', async () => {
  await assert.rejects(
    runRefineContentIdea(
      { ideaId: 'idea-1' },
      {
        deps: {
          getSettings,
          getContentIdeaById: async () => ({ ...baseIdea, status: 'refined' }) as never,
          queryRelatedPublishedContent: async () => [],
          getResearchItemsByTopicIds: async () => [],
          updateContentIdea: async () => null,
          generate: (async () => ({})) as never,
        },
      },
    ),
    /ALREADY_REFINED/,
  );
});

test('refine: throws IDEA_NOT_FOUND when idea missing', async () => {
  await assert.rejects(
    runRefineContentIdea(
      { ideaId: 'nope' },
      {
        deps: {
          getSettings,
          getContentIdeaById: async () => null,
          queryRelatedPublishedContent: async () => [],
          getResearchItemsByTopicIds: async () => [],
          updateContentIdea: async () => null,
          generate: (async () => ({})) as never,
        },
      },
    ),
    /IDEA_NOT_FOUND/,
  );
});

test('refine: persists status/outline/keyPoints/suggestedCitations, drops hook/cta/inner_links', async () => {
  let updateArgs: { id: string; data: Record<string, unknown> } | null = null;

  const result = await runRefineContentIdea(
    { ideaId: 'idea-1' },
    {
      deps: {
        getSettings,
        getContentIdeaById: async () => baseIdea as never,
        queryRelatedPublishedContent: async () => [],
        getResearchItemsByTopicIds: async () => [],
        updateContentIdea: async (id, data) => {
          updateArgs = { id, data: data as Record<string, unknown> };
          return { ...baseIdea, ...data } as never;
        },
        generate: (async () => ({
          outline: ['Section 1', 'Section 2'],
          key_points: ['Key point A'],
          suggested_citations: ['Cite this'],
          inner_link_suggestions: ['Related post'],
          hook: 'A grabbing hook',
          call_to_action: 'Subscribe now',
        })) as never,
      },
    },
  );

  assert.deepEqual(result, { refined: true });
  assert.ok(updateArgs);
  const args = updateArgs as { id: string; data: Record<string, unknown> };
  assert.equal(args.id, 'idea-1');
  assert.deepEqual(args.data, {
    status: 'refined',
    outline: ['Section 1', 'Section 2'],
    keyPoints: ['Key point A'],
    suggestedCitations: ['Cite this'],
  });
  // hook / call_to_action / inner_link_suggestions must NOT be persisted.
  assert.equal('hook' in args.data, false);
  assert.equal('call_to_action' in args.data, false);
  assert.equal('inner_link_suggestions' in args.data, false);
  assert.equal('keyPoints' in args.data, true);
  assert.equal('suggestedCitations' in args.data, true);
});

// ===========================================================================
// generate_content_draft
// ===========================================================================

const refinedIdea = {
  ...baseIdea,
  status: 'refined' as const,
  outline: ['Intro', 'Body'],
  keyPoints: ['kp1'],
  suggestedCitations: ['c1'],
};

test('draft: throws INVALID_CONTENT_TYPE for an unknown type (no repo access)', async () => {
  await assert.rejects(
    runGenerateContentDraft(
      { ideaId: 'idea-1', contentType: 'podcast' },
      { deps: {} },
    ),
    /INVALID_CONTENT_TYPE/,
  );
});

test('draft: throws NOT_REFINED when idea is not refined', async () => {
  await assert.rejects(
    runGenerateContentDraft(
      { ideaId: 'idea-1', contentType: 'blog_post' },
      {
        deps: {
          getSettings,
          getContentIdeaById: async () => ({ ...refinedIdea, status: 'idea' }) as never,
          queryRelatedPublishedContent: async () => [],
          createContentDraft: async () => ({ id: 'd' }) as never,
          generate: (async () => ({})) as never,
        },
      },
    ),
    /NOT_REFINED/,
  );
});

test('draft: throws IDEA_NOT_FOUND when idea missing', async () => {
  await assert.rejects(
    runGenerateContentDraft(
      { ideaId: 'nope', contentType: 'blog_post' },
      {
        deps: {
          getSettings,
          getContentIdeaById: async () => null,
          queryRelatedPublishedContent: async () => [],
          createContentDraft: async () => ({ id: 'd' }) as never,
          generate: (async () => ({})) as never,
        },
      },
    ),
    /IDEA_NOT_FOUND/,
  );
});

test('draft: assembles content from the generated parts per content type', async () => {
  const cases: Array<{
    contentType: string;
    generated: Record<string, unknown>;
    expected: string;
  }> = [
    {
      contentType: 'video_script',
      generated: {
        hook: 'HOOK',
        intro: 'INTRO',
        main_sections: ['S1', 'S2'],
        demo_notes: [],
        conclusion: 'END',
        call_to_action: 'CTA',
      },
      expected: 'HOOK\n\nINTRO\n\nS1\n\nS2\n\nEND\n\nCTA',
    },
    {
      contentType: 'blog_post',
      generated: {
        title: 'T',
        meta_description: 'm',
        introduction: 'INTRO',
        sections: ['S1', 'S2'],
        code_examples: [],
        conclusion: 'END',
      },
      expected: '# T\n\nINTRO\n\nS1\n\nS2\n\nEND',
    },
    {
      contentType: 'tweet_thread',
      generated: { tweets: ['a', 'b'], thread_hook: 'a' },
      expected: '1/2 a\n\n2/2 b',
    },
    {
      contentType: 'x_post',
      generated: { post: 'One focused post.' },
      expected: 'One focused post.',
    },
    {
      contentType: 'linkedin_post',
      generated: { hook: 'H', body: 'B', call_to_action: 'C', hashtags: ['#x', '#y'] },
      expected: 'H\n\nB\n\nC\n\n#x #y',
    },
    {
      contentType: 'social_post',
      generated: { hook: 'H', body: 'B', call_to_action: 'C', hashtags: ['#x'] },
      expected: 'H\n\nB\n\nC\n\n#x',
    },
    {
      contentType: 'ad_campaign',
      generated: {
        headline: 'A better headline',
        primary_text: 'Primary copy',
        description: 'Supporting copy',
        call_to_action: 'Learn more',
      },
      expected: 'Headline: A better headline\n\nPrimary text:\nPrimary copy\n\nDescription: Supporting copy\n\nCTA: Learn more',
    },
  ];

  for (const c of cases) {
    let draftInput: Record<string, unknown> | null = null;

    const result = await runGenerateContentDraft(
      { ideaId: 'idea-1', contentType: c.contentType },
      {
        deps: {
          getSettings,
          getContentIdeaById: async () => refinedIdea as never,
          queryRelatedPublishedContent: async () => [
            { id: 'pub1', title: 'Pub', type: 'blog_post', publishedUrl: 'https://x/1' },
          ],
          createContentDraft: async (data) => {
            draftInput = data as Record<string, unknown>;
            return { id: `draft-${c.contentType}`, ...data } as never;
          },
          generate: (async () => c.generated) as never,
        },
      },
    );

    assert.equal(result.draftId, `draft-${c.contentType}`);
    assert.ok(draftInput);
    const di = draftInput as Record<string, unknown>;
    assert.equal(di.content, c.expected, `content for ${c.contentType}`);
    assert.equal(di.type, c.contentType);
    // citations always [] ; innerLinks are related-content ids.
    assert.deepEqual(di.citations, []);
    assert.deepEqual(di.innerLinks, ['pub1']);
  }
});

test('draft variation reuses the source content type pipeline without creating a normal draft', async () => {
  let generatedPrompt = '';
  let createCalls = 0;
  const candidate = await runGenerateContentVariation(
    { sourceDraftId: 'source-1', variationIndex: 2 },
    {
      deps: {
        getSettings,
        getContentDraftById: async () => ({
          id: 'source-1',
          ideaId: 'idea-1',
          title: 'Source title',
          type: 'x_post',
          content: 'Original post',
          status: 'draft',
          createdAt: '2026-07-20',
          updatedAt: '2026-07-20',
        }),
        getContentIdeaById: async () => refinedIdea as never,
        queryRelatedPublishedContent: async () => [],
        createContentDraft: async () => {
          createCalls += 1;
          return { id: 'unexpected' } as never;
        },
        generate: (async (args: { prompt: string }) => {
          generatedPrompt = args.prompt;
          return { post: 'A genuinely different post' };
        }) as never,
      },
    },
  );

  assert.equal(createCalls, 0);
  assert.equal(candidate.id, 'variation-2');
  assert.equal(candidate.contentType, 'x_post');
  assert.equal(candidate.content, 'A genuinely different post');
  assert.match(generatedPrompt, /variation 2/i);
  assert.match(generatedPrompt, /Original post/);
});

test('draft: emits draft.ready with draftId, ideaId, contentType after creating the draft', async () => {
  const recorded: ProductEventInsert[] = [];
  setProductEventSinkForTests(async (event) => {
    recorded.push(event);
    return { id: randomUUID() };
  });
  try {
    const result = await runWithExecutionContext(
      { organizationId: 'org-draft-events', actorId: 'test', actorType: 'service' },
      () => runGenerateContentDraft({ ideaId: 'idea-1', contentType: 'linkedin_post' }, {
        deps: {
          getSettings: (async () => ({ mission: 'm', identity: 'i', voice: 'v' })) as never,
          getContentIdeaById: (async () => ({
            id: 'idea-1', title: 'T', description: 'D', status: 'refined', sourceTopics: [],
          })) as never,
          queryRelatedPublishedContent: (async () => []) as never,
          createContentDraft: (async () => ({ id: 'draft-77' })) as never,
          generate: (async () => ({
            hook: 'h', body: 'b', call_to_action: 'c', hashtags: [],
          })) as never,
        },
      }),
    );
    await drainProductEvents();
    assert.equal(result.draftId, 'draft-77');
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].name, 'draft.ready');
    assert.equal(recorded[0].organizationId, 'org-draft-events');
    assert.deepEqual(recorded[0].payload, {
      ideaId: 'idea-1', contentType: 'linkedin_post', draftId: 'draft-77',
    });
  } finally {
    setProductEventSinkForTests(null);
  }
});
