/**
 * Unit tests for the Mastra content actions (ideas / refine / draft).
 *
 * No network, no Neo4j: every repository call and the agent-generate primitive
 * are injected via the optional { deps } param. Run: node --import tsx --test.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runWithExecutionContext } from '@content-automation/observability';
import {
  drainProductEvents,
  setProductEventSinkForTests,
} from '@content-automation/platform/events/emit';
import type { ProductEventInsert } from '@content-automation/platform/events/repository';

import { localIdeasGenerate, runGenerateContentIdeas } from '../agent/actions/ideas';
import { runRefineContentIdea } from '../agent/actions/refine';
import { localDraftGenerate, runGenerateContentDraft, runGenerateContentVariation } from '../agent/actions/draft';
import { contentKnowledgeManifest } from '../knowledge-manifest';
import type { ContextBundle } from '@content-automation/knowledge';

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

test('local idea generation is deterministic and preserves available claim lineage', async () => {
  const schema = z.object({
    ideas: z.array(z.object({
      title: z.string(), description: z.string(), rationale: z.string(),
      priority: z.enum(['low', 'medium', 'high']), source_topics: z.array(z.string()),
      source_claim_ids: z.array(z.string()).optional(),
    })),
  });
  const generated = await localIdeasGenerate({
    agentId: 'content-ideas-agent', agentName: 'Content Ideas Agent', instructions: '',
    prompt: 'Evidence: [claim:claim-1] repeated [claim:claim-1] and [claim:claim-2]',
    schema, temperature: 0,
  });
  assert.equal(generated.ideas.length, 5);
  assert.deepEqual(generated.ideas[0]?.source_claim_ids, ['claim-1', 'claim-2']);
});

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

test('ideas: reject claim IDs outside the authorized knowledge bundle', async () => {
  const created: Array<Record<string, unknown>> = [];
  const artifacts: Array<Record<string, unknown>> = [];
  const context = {
    claims: [{ id: 'claim-1', statement: 'Verified fact', evidenceIds: ['evidence-1'] }],
  } as ContextBundle;
  await assert.rejects(runGenerateContentIdeas({}, { deps: {
    getSettings,
    getRecentResearchItems: async () => [],
    getTopics: topicsResponse([]),
    queryContentGaps: async () => [],
    queryHighPerformingContent: async () => [],
    getKnowledgeContext: async () => context,
    createContentIdea: async (data) => { created.push(data); return { id: 'idea-grounded', ...data } as never; },
    recordKnowledgeArtifact: async (data) => { artifacts.push(data); return null; },
    generate: (async () => ({ ideas: [{ title: 'Grounded idea', description: 'd', rationale: 'r', priority: 'high', source_topics: [], source_claim_ids: ['claim-1', 'invented'] }] })) as never,
  } }), /out-of-context claim: invented/);
  assert.equal(created.length, 0);
  assert.equal(artifacts.length, 0);
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
          outline: ['Section 1', 'Section 2', 'Section 3', 'Section 4', 'Section 5'],
          key_points: ['Key point A', 'Key point B', 'Key point C'],
          suggested_citations: ['Cite this'],
          inner_link_suggestions: ['Related post'],
          hook: 'A grabbing hook',
          call_to_action: 'Subscribe now',
        })) as never,
      },
    },
  );

  assert.deepEqual(result, { refined: true, mode: 'live' });
  assert.ok(updateArgs);
  const args = updateArgs as { id: string; data: Record<string, unknown> };
  assert.equal(args.id, 'idea-1');
  assert.deepEqual(args.data, {
    status: 'refined',
    outline: ['Section 1', 'Section 2', 'Section 3', 'Section 4', 'Section 5'],
    keyPoints: ['Key point A', 'Key point B', 'Key point C'],
    suggestedCitations: ['Cite this'],
  });
  // hook / call_to_action / inner_link_suggestions must NOT be persisted.
  assert.equal('hook' in args.data, false);
  assert.equal('call_to_action' in args.data, false);
  assert.equal('inner_link_suggestions' in args.data, false);
  assert.equal('keyPoints' in args.data, true);
  assert.equal('suggestedCitations' in args.data, true);
});

test('refine: refuses to persist an empty Content Base as refined', async () => {
  let updateCalled = false;

  await assert.rejects(
    runRefineContentIdea(
      { ideaId: 'idea-1' },
      {
        deps: {
          getSettings,
          getContentIdeaById: async () => baseIdea as never,
          queryRelatedPublishedContent: async () => [],
          getResearchItemsByTopicIds: async () => [],
          updateContentIdea: async () => {
            updateCalled = true;
            return null;
          },
          generate: (async () => ({
            outline: [],
            key_points: [],
            suggested_citations: [],
            inner_link_suggestions: [],
            hook: 'A hook',
            call_to_action: 'A call to action',
          })) as never,
        },
      },
    ),
    /Too small/,
  );

  assert.equal(updateCalled, false);
});

test('refine: cleans model markdown and footnote markers before persistence', async () => {
  let updateArgs: Record<string, unknown> | null = null;

  await runRefineContentIdea(
    { ideaId: 'idea-1' },
    {
      deps: {
        getSettings,
        getContentIdeaById: async () => baseIdea as never,
        queryRelatedPublishedContent: async () => [],
        getResearchItemsByTopicIds: async () => [],
        updateContentIdea: async (_id, data) => {
          updateArgs = data as Record<string, unknown>;
          return { ...baseIdea, ...data } as never;
        },
        generate: (async () => ({
          outline: [
            '# Opening frame',
            '**Hook:** Make the tension concrete.',
            '> A concise supporting example. [^1][^2]',
            '- Explain the trade-offs.',
            '5. End with a decision framework.',
          ],
          key_points: [
            '- **Trust needs visibility.**',
            '2. Approvals should be explicit.',
            '> Recovery paths make autonomy safer. [^3]',
          ],
          suggested_citations: ['- Source title [^4]', 'No related research available.'],
          inner_link_suggestions: ['* Related post'],
          hook: '**A clean hook.**',
          call_to_action: '> Choose the next action.',
        })) as never,
      },
    },
  );

  assert.ok(updateArgs);
  assert.deepEqual(updateArgs.outline, [
    'Opening frame',
    'Hook: Make the tension concrete.',
    'A concise supporting example.',
    'Explain the trade-offs.',
    'End with a decision framework.',
  ]);
  assert.deepEqual(updateArgs.keyPoints, [
    'Trust needs visibility.',
    'Approvals should be explicit.',
    'Recovery paths make autonomy safer.',
  ]);
  assert.deepEqual(updateArgs.suggestedCitations, ['Source title']);
});

test('refine: local mode builds a deterministic Content Base without calling a model', async () => {
  let updateArgs: { id: string; data: Record<string, unknown> } | null = null;
  let modelCalled = false;

  const result = await runRefineContentIdea(
    { ideaId: 'idea-1' },
    {
      mode: 'local',
      deps: {
        getSettings,
        getContentIdeaById: async () => ({ ...baseIdea, rationale: baseIdea.description }) as never,
        queryRelatedPublishedContent: async () => [
          { title: 'A related post', type: 'blog_post', publishedUrl: 'https://example.test/post' },
        ] as never,
        getResearchItemsByTopicIds: async () => [
          { title: 'Fresh research', content: 'Evidence', sourceUrl: 'https://example.test/research' },
        ] as never,
        updateContentIdea: async (id, data) => {
          updateArgs = { id, data: data as Record<string, unknown> };
          return { ...baseIdea, ...data } as never;
        },
        generate: (async () => {
          modelCalled = true;
          throw new Error('The local refinement fallback must not call a model.');
        }) as never,
      },
    },
  );

  assert.deepEqual(result, { refined: true, mode: 'local' });
  assert.equal(modelCalled, false);
  assert.ok(updateArgs);
  const args = updateArgs as { id: string; data: Record<string, unknown> };
  assert.equal(args.id, 'idea-1');
  assert.equal(args.data.status, 'refined');
  assert.ok((args.data.outline as string[]).some((line) => line.includes(baseIdea.title)));
  assert.equal(
    (args.data.outline as string[]).filter((line) => line.includes(baseIdea.description)).length,
    1,
  );
  assert.ok((args.data.keyPoints as string[]).includes(baseIdea.description));
  assert.deepEqual(args.data.suggestedCitations, ['Prior research', 'Fresh research']);
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

test('draft: forwards selected asset bytes as vision input to the writing model', async () => {
  const vision = [{ bytes: Buffer.from('<svg/>'), mimeType: 'image/svg+xml', description: 'A Base-owned diagram' }];
  let received: unknown;
  await runGenerateContentDraft(
    { ideaId: 'idea-1', contentType: 'x_post' },
    {
      vision,
      deps: {
        getSettings,
        getContentIdeaById: async () => refinedIdea as never,
        queryRelatedPublishedContent: async () => [],
        getKnowledgeContext: async () => ({ claims: [] }) as never,
        createContentDraft: async (data) => ({ id: 'draft-from-media', ...data }) as never,
        recordKnowledgeArtifact: async () => null,
        generate: (async (args: { vision?: unknown }) => { received = args.vision; return { post: 'Written from the actual diagram.' }; }) as never,
      },
    },
  );
  assert.equal(received, vision);
});

test('draft: rejects idea claims no longer authorized by the draft projection', async () => {
  let draftInput: Record<string, unknown> | null = null;
  let artifactInput: Record<string, unknown> | null = null;
  const context = { claims: [{ id: 'claim-1', statement: 'Verified fact', evidenceIds: ['evidence-1'] }] } as ContextBundle;
  await assert.rejects(runGenerateContentDraft(
    { ideaId: 'idea-1', contentType: 'x_post' },
    { deps: {
      getSettings,
      getContentIdeaById: async () => ({ ...refinedIdea, sourceClaimIds: ['claim-1', 'stale-claim'] }) as never,
      queryRelatedPublishedContent: async () => [],
      getKnowledgeContext: async () => context,
      createContentDraft: async (data) => { draftInput = data as Record<string, unknown>; return { id: 'draft-grounded', ...data } as never; },
      recordKnowledgeArtifact: async (data) => { artifactInput = data as Record<string, unknown>; return null; },
      generate: (async () => ({ post: 'Grounded post.' })) as never,
    } },
  ), /outside its authorized context: stale-claim/);
  assert.equal(draftInput, null);
  assert.equal(artifactInput, null);
});

test('draft knowledge projection accepts every grounded predicate available to idea generation', () => {
  const ideas = contentKnowledgeManifest.readProjections.find(({ key }) => key === 'content.idea_context');
  const drafts = contentKnowledgeManifest.readProjections.find(({ key }) => key === 'content.draft_context');
  assert.ok(ideas && drafts);
  for (const predicate of ideas.predicates) {
    assert.ok(drafts.predicates.includes(predicate), `draft context excludes idea predicate ${predicate}`);
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

test('local draft generation produces schema-valid long and short formats', async () => {
  const blog = await localDraftGenerate({
    agentId: 'blog-post-agent', agentName: 'Blog Post Agent', instructions: '', prompt: '',
    schema: z.object({
      title: z.string(), meta_description: z.string(), introduction: z.string(),
      sections: z.array(z.string()), code_examples: z.array(z.string()), conclusion: z.string(),
    }),
    temperature: 0,
  });
  const short = await localDraftGenerate({
    agentId: 'x-post-agent', agentName: 'X Post Agent', instructions: '', prompt: '',
    schema: z.object({ post: z.string().max(280) }), temperature: 0,
  });
  assert.match(blog.title, /Durable workflow recovery/);
  assert.ok(blog.sections.length >= 3);
  assert.ok(short.post.length <= 280);
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
