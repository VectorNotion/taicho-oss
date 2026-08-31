import { getSession } from '@content-automation/platform/data/graph';
import type {
  ContentIdea,
  ContentDraft,
  CreateContentIdeaInput,
  UpdateContentIdeaInput,
  ContentIdeaFilters,
  CreateContentDraftInput,
  UpdateContentDraftInput,
  ContentDraftFilters,
} from '../domain/content';
import { recordContentReminderCalendarChange } from '../calendar-events';

function graphTimestamp(value: unknown): string {
  const serialized = String(value);
  if (
    /^\d{4}-\d{2}-\d{2}T/.test(serialized)
    && !/(?:Z|[+-]\d{2}:\d{2})(?:\[.*\])?$/.test(serialized)
  ) {
    return `${serialized}Z`;
  }
  return serialized;
}

// ============= CONTENT IDEAS CRUD =============

export async function createContentIdea(data: CreateContentIdeaInput): Promise<ContentIdea> {
  const session = await getSession();

  try {
    // Ideas are format-agnostic - no type or targetPlatform
    const result = await session.run(
      `
      CREATE (i:ContentIdea {
        id: randomUUID(),
        title: $title,
        description: $description,
        rationale: $rationale,
        priority: $priority,
        sourceClaimIdsJson: $sourceClaimIdsJson,
        sourceEvidenceIdsJson: $sourceEvidenceIdsJson,
        status: 'idea',
        createdAt: localdatetime(),
        updatedAt: localdatetime()
      })
      RETURN i
      `,
      {
        title: data.title,
        description: data.description,
        rationale: data.rationale,
        priority: data.priority ?? 'medium',
        sourceClaimIdsJson: JSON.stringify(data.sourceClaimIds ?? []),
        sourceEvidenceIdsJson: JSON.stringify(data.sourceEvidenceIds ?? []),
      }
    );

    const record = result.records[0];
    const idea = record.get('i').properties;
    const ideaId = idea.id;

    // Create topic relationships if provided
    if (data.sourceTopicIds && data.sourceTopicIds.length > 0) {
      await session.run(
        `
        MATCH (i:ContentIdea {id: $ideaId})
        UNWIND $topicIds as topicId
        MATCH (t:Topic {id: topicId})
        MERGE (i)-[:INSPIRED_BY]->(t)
        `,
        { ideaId, topicIds: data.sourceTopicIds }
      );
    }

    // Create research relationships if provided
    if (data.sourceResearchIds && data.sourceResearchIds.length > 0) {
      await session.run(
        `
        MATCH (i:ContentIdea {id: $ideaId})
        UNWIND $researchIds as researchId
        MATCH (r:ResearchItem {id: researchId})
        MERGE (i)-[:SOURCED_FROM]->(r)
        `,
        { ideaId, researchIds: data.sourceResearchIds }
      );
    }

    return mapIdeaFromNeo4j(idea);
  } finally {
    await session.close();
  }
}

/**
 * Idempotently promote one calculated insight into an idea. The insight is a
 * provenance snapshot; it does not make a gap durable or mark it covered.
 */
export async function findOrCreateContentIdeaFromInsight(
  data: CreateContentIdeaInput & { sourceInsight: NonNullable<CreateContentIdeaInput['sourceInsight']> }
): Promise<ContentIdea> {
  const session = await getSession();
  const source = data.sourceInsight;
  try {
    const result = await session.run(
      `MERGE (i:ContentIdea {
         sourceInsightProvider: $sourceInsightProvider,
         sourceInsightId: $sourceInsightId
       })
       ON CREATE SET
         i.id = randomUUID(),
         i.title = $title,
         i.description = $description,
         i.rationale = $rationale,
         i.priority = $priority,
         i.status = 'idea',
         i.sourceInsightTitle = $sourceInsightTitle,
         i.sourceInsightContextId = $sourceInsightContextId,
         i.sourceInsightContextLabel = $sourceInsightContextLabel,
         i.sourceInsightEvidenceJson = $sourceInsightEvidenceJson,
         i.sourceInsightGeneratedAt = $sourceInsightGeneratedAt,
         i.createdAt = localdatetime(),
         i.updatedAt = localdatetime()
       RETURN i`,
      {
        title: data.title,
        description: data.description,
        rationale: data.rationale,
        priority: data.priority ?? 'medium',
        sourceInsightProvider: source.provider,
        sourceInsightId: source.sourceId,
        sourceInsightTitle: source.title,
        sourceInsightContextId: source.contextId ?? null,
        sourceInsightContextLabel: source.contextLabel ?? null,
        sourceInsightEvidenceJson: JSON.stringify(source.evidence),
        sourceInsightGeneratedAt: source.generatedAt,
      }
    );
    return mapIdeaFromNeo4j(result.records[0].get('i').properties);
  } finally {
    await session.close();
  }
}

export async function getContentIdeas(filters?: ContentIdeaFilters): Promise<ContentIdea[]> {
  const session = await getSession();

  try {
    const whereClauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters?.status) {
      whereClauses.push('i.status = $status');
      params.status = filters.status;
    }

    // Ideas are format-agnostic - no type or targetPlatform filters

    if (filters?.priority) {
      whereClauses.push('i.priority = $priority');
      params.priority = filters.priority;
    }

    if (filters?.search) {
      whereClauses.push(
        '(toLower(i.title) CONTAINS toLower($search) OR toLower(i.description) CONTAINS toLower($search))'
      );
      params.search = filters.search;
    }

    const whereClause =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const result = await session.run(
      `
      MATCH (i:ContentIdea)
      ${whereClause}
      OPTIONAL MATCH (i)-[:INSPIRED_BY]->(t:Topic)
      OPTIONAL MATCH (i)-[:SOURCED_FROM]->(r:ResearchItem)
      RETURN i,
             collect(DISTINCT {id: t.id, name: t.displayName}) as topics,
             collect(DISTINCT {id: r.id, title: r.title}) as research
      ORDER BY i.createdAt DESC
      `,
      params
    );

    return result.records.map((record) => {
      const idea = record.get('i').properties;
      const topics = record.get('topics').filter((t: { id: string | null }) => t.id !== null);
      const research = record.get('research').filter((r: { id: string | null }) => r.id !== null);
      return mapIdeaFromNeo4j(idea, topics, research);
    });
  } finally {
    await session.close();
  }
}

export async function getContentIdeaById(id: string): Promise<ContentIdea | null> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (i:ContentIdea {id: $id})
      OPTIONAL MATCH (i)-[:INSPIRED_BY]->(t:Topic)
      OPTIONAL MATCH (i)-[:SOURCED_FROM]->(r:ResearchItem)
      RETURN i,
             collect(DISTINCT {id: t.id, name: t.displayName}) as topics,
             collect(DISTINCT {id: r.id, title: r.title}) as research
      `,
      { id }
    );

    if (result.records.length === 0) {
      return null;
    }

    const record = result.records[0];
    const idea = record.get('i').properties;
    const topics = record.get('topics').filter((t: { id: string | null }) => t.id !== null);
    const research = record.get('research').filter((r: { id: string | null }) => r.id !== null);

    return mapIdeaFromNeo4j(idea, topics, research);
  } finally {
    await session.close();
  }
}

export async function updateContentIdea(
  id: string,
  data: UpdateContentIdeaInput
): Promise<ContentIdea | null> {
  const session = await getSession();

  try {
    const setClauses: string[] = ['i.updatedAt = localdatetime()'];
    const params: Record<string, unknown> = { id };

    if (data.title !== undefined) {
      setClauses.push('i.title = $title');
      params.title = data.title;
    }
    // Ideas are format-agnostic - no type or targetPlatform updates
    if (data.description !== undefined) {
      setClauses.push('i.description = $description');
      params.description = data.description;
    }
    if (data.rationale !== undefined) {
      setClauses.push('i.rationale = $rationale');
      params.rationale = data.rationale;
    }
    if (data.priority !== undefined) {
      setClauses.push('i.priority = $priority');
      params.priority = data.priority;
    }
    if (data.status !== undefined) {
      setClauses.push('i.status = $status');
      params.status = data.status;
    }
    if (data.outline !== undefined) {
      setClauses.push('i.outline = $outline');
      params.outline = data.outline;
    }
    if (data.keyPoints !== undefined) {
      setClauses.push('i.keyPoints = $keyPoints');
      params.keyPoints = data.keyPoints;
    }
    if (data.suggestedCitations !== undefined) {
      setClauses.push('i.suggestedCitations = $suggestedCitations');
      params.suggestedCitations = data.suggestedCitations;
    }

    const result = await session.run(
      `
      MATCH (i:ContentIdea {id: $id})
      SET ${setClauses.join(', ')}
      RETURN i
      `,
      params
    );

    if (result.records.length === 0) {
      return null;
    }

    const idea = result.records[0].get('i').properties;
    return mapIdeaFromNeo4j(idea);
  } finally {
    await session.close();
  }
}

export async function deleteContentIdea(id: string): Promise<boolean> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (i:ContentIdea {id: $id})
      DETACH DELETE i
      RETURN count(i) as deleted
      `,
      { id }
    );

    const deleted = result.records[0]?.get('deleted')?.toNumber() ?? 0;
    return deleted > 0;
  } finally {
    await session.close();
  }
}

// ============= CONTENT DRAFTS CRUD =============

export async function createContentDraft(data: CreateContentDraftInput): Promise<ContentDraft> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (idea:ContentIdea {id: $ideaId})
      CREATE (d:ContentDraft {
        id: randomUUID(),
        ideaId: $ideaId,
        title: $title,
        type: $type,
        content: $content,
        sourceClaimIdsJson: $sourceClaimIdsJson,
        sourceEvidenceIdsJson: $sourceEvidenceIdsJson,
        status: 'draft',
        createdAt: localdatetime(),
        updatedAt: localdatetime()
      })
      SET idea:ContentBase
      CREATE (d)-[:DRAFT_OF]->(idea)
      CREATE (idea)-[:HAS_POST]->(d)
      RETURN d
      `,
      {
        ideaId: data.ideaId,
        title: data.title,
        type: data.type,
        content: data.content,
        sourceClaimIdsJson: JSON.stringify(data.sourceClaimIds ?? []),
        sourceEvidenceIdsJson: JSON.stringify(data.sourceEvidenceIds ?? []),
      }
    );

    const record = result.records[0];
    const draft = record.get('d').properties;
    const draftId = draft.id;

    // Create citation relationships if provided
    if (data.citations && data.citations.length > 0) {
      await session.run(
        `
        MATCH (d:ContentDraft {id: $draftId})
        UNWIND $citationIds as citationId
        MATCH (r:ResearchItem {id: citationId})
        MERGE (d)-[:CITES]->(r)
        `,
        { draftId, citationIds: data.citations }
      );
    }

    // Create inner-link relationships if provided
    if (data.innerLinks && data.innerLinks.length > 0) {
      await session.run(
        `
        MATCH (d:ContentDraft {id: $draftId})
        UNWIND $linkIds as linkId
        MATCH (linked:ContentDraft {id: linkId})
        MERGE (d)-[:LINKS_TO]->(linked)
        `,
        { draftId, linkIds: data.innerLinks }
      );
    }

    return mapDraftFromNeo4j(draft);
  } finally {
    await session.close();
  }
}

/**
 * Repair the legacy state written by older draft creation code. Ideas and
 * drafts are separate artifacts: once an idea has been refined it stays
 * refined, while generated drafts own their own draft/ready/published state.
 */
export async function repairLegacyContentIdeaStatuses(): Promise<number> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (i:ContentIdea {status: 'draft'})
      WHERE (i)<-[:DRAFT_OF]-(:ContentDraft)
      SET i.status = 'refined', i.updatedAt = localdatetime()
      RETURN count(i) AS repaired
      `,
    );

    return result.records[0]?.get('repaired')?.toNumber?.() ?? 0;
  } finally {
    await session.close();
  }
}

export async function getContentDrafts(filters?: ContentDraftFilters): Promise<ContentDraft[]> {
  const session = await getSession();

  try {
    const whereClauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters?.status) {
      whereClauses.push('d.status = $status');
      params.status = filters.status;
    }

    if (filters?.type) {
      whereClauses.push('d.type = $type');
      params.type = filters.type;
    }

    if (filters?.ideaId) {
      whereClauses.push('d.ideaId = $ideaId');
      params.ideaId = filters.ideaId;
    }

    if (filters?.search) {
      whereClauses.push(
        '(toLower(d.title) CONTAINS toLower($search) OR toLower(d.content) CONTAINS toLower($search))'
      );
      params.search = filters.search;
    }

    const whereClause =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const result = await session.run(
      `
      MATCH (d:ContentDraft)
      ${whereClause}
      OPTIONAL MATCH (d)-[:CITES]->(r:ResearchItem)
      OPTIONAL MATCH (d)-[:LINKS_TO]->(linked:ContentDraft)
      RETURN d,
             collect(DISTINCT r.id) as citations,
             collect(DISTINCT linked.id) as innerLinks
      ORDER BY d.createdAt DESC
      `,
      params
    );

    return result.records.map((record) => {
      const draft = record.get('d').properties;
      const citations = record.get('citations').filter((c: string | null) => c !== null);
      const innerLinks = record.get('innerLinks').filter((l: string | null) => l !== null);
      return mapDraftFromNeo4j(draft, citations, innerLinks);
    });
  } finally {
    await session.close();
  }
}

export async function getScheduledContentDrafts(limit = 50): Promise<ContentDraft[]> {
  const session = await getSession();
  const safeLimit = Math.max(1, Math.min(10_000, Math.trunc(limit)));

  try {
    const result = await session.run(
      `
      MATCH (d:ContentDraft {status: 'ready'})
      WHERE d.scheduledFor IS NOT NULL
      RETURN d
      ORDER BY d.scheduledFor
      LIMIT ${safeLimit}
      `,
    );

    return result.records.map((record) =>
      mapDraftFromNeo4j(record.get('d').properties)
    );
  } finally {
    await session.close();
  }
}

export async function getContentDraftById(id: string): Promise<ContentDraft | null> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (d:ContentDraft {id: $id})
      OPTIONAL MATCH (d)-[:CITES]->(r:ResearchItem)
      OPTIONAL MATCH (d)-[:LINKS_TO]->(linked:ContentDraft)
      RETURN d,
             collect(DISTINCT r.id) as citations,
             collect(DISTINCT linked.id) as innerLinks
      `,
      { id }
    );

    if (result.records.length === 0) {
      return null;
    }

    const record = result.records[0];
    const draft = record.get('d').properties;
    const citations = record.get('citations').filter((c: string | null) => c !== null);
    const innerLinks = record.get('innerLinks').filter((l: string | null) => l !== null);

    return mapDraftFromNeo4j(draft, citations, innerLinks);
  } finally {
    await session.close();
  }
}

export async function getContentDraftByIdeaId(ideaId: string): Promise<ContentDraft | null> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (d:ContentDraft {ideaId: $ideaId})
      OPTIONAL MATCH (d)-[:CITES]->(r:ResearchItem)
      OPTIONAL MATCH (d)-[:LINKS_TO]->(linked:ContentDraft)
      RETURN d,
             collect(DISTINCT r.id) as citations,
             collect(DISTINCT linked.id) as innerLinks
      ORDER BY d.createdAt DESC
      LIMIT 1
      `,
      { ideaId }
    );

    if (result.records.length === 0) {
      return null;
    }

    const record = result.records[0];
    const draft = record.get('d').properties;
    const citations = record.get('citations').filter((c: string | null) => c !== null);
    const innerLinks = record.get('innerLinks').filter((l: string | null) => l !== null);

    return mapDraftFromNeo4j(draft, citations, innerLinks);
  } finally {
    await session.close();
  }
}

export async function updateContentDraft(
  id: string,
  data: UpdateContentDraftInput
): Promise<ContentDraft | null> {
  const session = await getSession();

  try {
    const setClauses: string[] = ['d.updatedAt = localdatetime()'];
    const params: Record<string, unknown> = { id };

    if (data.title !== undefined) {
      setClauses.push('d.title = $title');
      params.title = data.title;
    }
    if (data.content !== undefined) {
      setClauses.push('d.content = $content');
      params.content = data.content;
    }
    if (data.status !== undefined) {
      setClauses.push('d.status = $status');
      params.status = data.status;
      // If marking as published, set publishedAt
      if (data.status === 'published' && !data.publishedAt) {
        setClauses.push('d.publishedAt = localdatetime()');
      }
    }
    if (data.scheduledFor !== undefined) {
      if (data.scheduledFor === null) {
        setClauses.push('d.scheduledFor = null');
      } else {
        setClauses.push('d.scheduledFor = $scheduledFor');
        params.scheduledFor = data.scheduledFor;
      }
    }
    if (data.publishedAt !== undefined) {
      setClauses.push('d.publishedAt = localdatetime($publishedAt)');
      params.publishedAt = data.publishedAt;
    }
    if (data.publishedUrl !== undefined) {
      setClauses.push('d.publishedUrl = $publishedUrl');
      params.publishedUrl = data.publishedUrl;
    }
    if (data.performanceLevel !== undefined) {
      setClauses.push('d.performanceLevel = $performanceLevel');
      params.performanceLevel = data.performanceLevel;
    }
    if (data.performanceInsights !== undefined) {
      setClauses.push('d.performanceInsights = $performanceInsights');
      params.performanceInsights = data.performanceInsights;
    }

    const result = await session.run(
      `
      MATCH (d:ContentDraft {id: $id})
      SET ${setClauses.join(', ')}
      RETURN d
      `,
      params
    );

    if (result.records.length === 0) {
      return null;
    }

    const draft = mapDraftFromNeo4j(result.records[0].get('d').properties);
    await recordContentReminderCalendarChange(draft);
    return draft;
  } finally {
    await session.close();
  }
}

/**
 * Apply one settled Resonance candidate without overwriting a Post changed
 * since the experiment began. The compare-and-set happens in FalkorDB, not in
 * a read-then-write window, and records the exact scoring job/candidate on the
 * Post for durable UI and audit traceability.
 */
export async function applyContentResonanceCandidate(
  id: string,
  input: {
    title: string;
    content: string;
    expectedUpdatedAt: string;
    resonanceJobId: string;
    candidateId: string;
  },
): Promise<ContentDraft | null> {
  const session = await getSession();

  try {
    const expectedGraphUpdatedAt = input.expectedUpdatedAt.replace(/Z$/, '');
    const expectedMilliseconds = Date.parse(input.expectedUpdatedAt);
    const nextUpdatedAt = new Date(Math.max(
      Date.now(),
      // FalkorDB serializes localdatetime at whole-second precision in this
      // graph, so advance by a full second to guarantee a new CAS token even
      // when apply follows the source write immediately.
      Number.isFinite(expectedMilliseconds) ? expectedMilliseconds + 1_000 : Date.now(),
    )).toISOString().replace(/Z$/, '');
    const result = await session.run(
      `
      MATCH (d:ContentDraft {id: $id})
      WHERE toString(d.updatedAt) = $expectedUpdatedAt
      SET d.title = $title,
          d.content = $content,
          d.resonanceAppliedJobId = $resonanceJobId,
          d.resonanceAppliedCandidateId = $candidateId,
          d.resonanceAppliedAt = localdatetime($nextUpdatedAt),
          d.updatedAt = localdatetime($nextUpdatedAt)
      RETURN d
      `,
      {
        id,
        title: input.title,
        content: input.content,
        resonanceJobId: input.resonanceJobId,
        candidateId: input.candidateId,
        expectedUpdatedAt: expectedGraphUpdatedAt,
        nextUpdatedAt,
      },
    );
    if (result.records.length === 0) return null;
    const draft = mapDraftFromNeo4j(result.records[0].get('d').properties);
    await recordContentReminderCalendarChange(draft);
    return draft;
  } finally {
    await session.close();
  }
}

export async function deleteContentDraft(id: string): Promise<boolean> {
  const existing = await getContentDraftById(id);
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (d:ContentDraft {id: $id})
      DETACH DELETE d
      RETURN count(d) as deleted
      `,
      { id }
    );

    const deleted = result.records[0]?.get('deleted')?.toNumber() ?? 0;
    if (deleted > 0 && existing) await recordContentReminderCalendarChange(existing, 'remove');
    return deleted > 0;
  } finally {
    await session.close();
  }
}

// ============= COUNTS =============

export async function getContentCounts(): Promise<{
  totalProjects: number;
  totalIdeas: number;
  totalDrafts: number;
  byIdeaStatus: Record<string, number>;
  byDraftStatus: Record<string, number>;
  byType: Record<string, number>;
}> {
  const session = await getSession();

  try {
    const projectResult = await session.run(`
      MATCH (p:Project)
      RETURN count(p) as count
    `);
    const totalProjects = projectResult.records[0]?.get('count').toNumber() ?? 0;

    // Get idea counts (ideas are format-agnostic, no type)
    const ideaResult = await session.run(`
      MATCH (i:ContentIdea)
      RETURN i.status as status, count(i) as count
    `);

    const byIdeaStatus: Record<string, number> = {};
    let totalIdeas = 0;

    for (const record of ideaResult.records) {
      const status = record.get('status');
      const count = record.get('count').toNumber();
      totalIdeas += count;
      byIdeaStatus[status] = (byIdeaStatus[status] || 0) + count;
    }

    // Get draft counts (drafts have type)
    const draftResult = await session.run(`
      MATCH (d:ContentDraft)
      RETURN d.status as status, d.type as type, count(d) as count
    `);

    const byDraftStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let totalDrafts = 0;

    for (const record of draftResult.records) {
      const status = record.get('status');
      const type = record.get('type');
      const count = record.get('count').toNumber();
      totalDrafts += count;
      byDraftStatus[status] = (byDraftStatus[status] || 0) + count;
      if (type) {
        byType[type] = (byType[type] || 0) + count;
      }
    }

    return { totalProjects, totalIdeas, totalDrafts, byIdeaStatus, byDraftStatus, byType };
  } finally {
    await session.close();
  }
}

// ============= HELPERS =============

function mapIdeaFromNeo4j(
  idea: Record<string, unknown>,
  topics?: Array<{ id: string; name: string }>,
  research?: Array<{ id: string; title: string }>
): ContentIdea {
  const sourceInsight = idea.sourceInsightProvider && idea.sourceInsightId
    ? {
        provider: String(idea.sourceInsightProvider),
        sourceId: String(idea.sourceInsightId),
        title: String(idea.sourceInsightTitle ?? idea.title),
        contextId: idea.sourceInsightContextId
          ? String(idea.sourceInsightContextId)
          : undefined,
        contextLabel: idea.sourceInsightContextLabel
          ? String(idea.sourceInsightContextLabel)
          : undefined,
        evidence: parseStringArray(idea.sourceInsightEvidenceJson),
        generatedAt: String(idea.sourceInsightGeneratedAt ?? idea.createdAt),
      }
    : undefined;
  // Ideas are format-agnostic - no type or targetPlatform
  return {
    id: idea.id as string,
    title: idea.title as string,
    description: idea.description as string,
    rationale: idea.rationale as string,
    priority: idea.priority as ContentIdea['priority'],
    status: idea.status as ContentIdea['status'],
    outline: idea.outline as string[] | undefined,
    keyPoints: idea.keyPoints as string[] | undefined,
    suggestedCitations: idea.suggestedCitations as string[] | undefined,
    sourceTopics: topics,
    sourceResearch: research,
    sourceInsight,
    sourceClaimIds: parseStringArray(idea.sourceClaimIdsJson),
    sourceEvidenceIds: parseStringArray(idea.sourceEvidenceIdsJson),
    createdAt: idea.createdAt ? graphTimestamp(idea.createdAt) : new Date().toISOString(),
    updatedAt: idea.updatedAt ? graphTimestamp(idea.updatedAt) : new Date().toISOString(),
  };
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function mapDraftFromNeo4j(
  draft: Record<string, unknown>,
  citations?: string[],
  innerLinks?: string[]
): ContentDraft {
  return {
    id: draft.id as string,
    ideaId: draft.ideaId as string,
    title: draft.title as string,
    type: draft.type as ContentDraft['type'],
    content: draft.content as string,
    status: draft.status as ContentDraft['status'],
    scheduledFor: draft.scheduledFor ? graphTimestamp(draft.scheduledFor) : undefined,
    publishedAt: draft.publishedAt ? graphTimestamp(draft.publishedAt) : undefined,
    publishedUrl: draft.publishedUrl as string | undefined,
    performanceLevel: draft.performanceLevel as ContentDraft['performanceLevel'],
    performanceInsights: draft.performanceInsights as string | undefined,
    resonanceAppliedJobId: draft.resonanceAppliedJobId as string | undefined,
    resonanceAppliedCandidateId: draft.resonanceAppliedCandidateId as string | undefined,
    resonanceAppliedAt: draft.resonanceAppliedAt ? graphTimestamp(draft.resonanceAppliedAt) : undefined,
    citations,
    sourceClaimIds: parseStringArray(draft.sourceClaimIdsJson),
    sourceEvidenceIds: parseStringArray(draft.sourceEvidenceIdsJson),
    innerLinks,
    createdAt: draft.createdAt ? graphTimestamp(draft.createdAt) : new Date().toISOString(),
    updatedAt: draft.updatedAt ? graphTimestamp(draft.updatedAt) : new Date().toISOString(),
  };
}

// ============= AGENT MIGRATION: GRAPH QUERIES (ideas / refine / draft) =============

/**
 * Identify content gaps: active topics that have research coverage but no ideas.
 * Suggested priority scales with research count (>=5 high, >=2 medium, else low).
 */
export async function queryContentGaps(
  limit: number = 10
): Promise<
  Array<{
    topicId: string;
    topicName: string;
    researchCount: number;
    suggestedPriority: string;
  }>
> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (t:Topic {status: 'active'})
      OPTIONAL MATCH (r:ResearchItem)-[:COVERS_TOPIC]->(t)
      OPTIONAL MATCH (i:ContentIdea)-[:INSPIRED_BY]->(t)
      WITH t, count(DISTINCT r) as research_count, count(DISTINCT i) as idea_count
      WHERE research_count > 0 AND idea_count = 0
      RETURN t.id as id,
             coalesce(t.displayName, t.name) as topicName,
             research_count,
             CASE
                 WHEN research_count >= 5 THEN 'high'
                 WHEN research_count >= 2 THEN 'medium'
                 ELSE 'low'
             END as suggested_priority
      ORDER BY research_count DESC
      LIMIT ${Math.max(1, Math.trunc(limit))}
      `,
      { limit }
    );

    return result.records.map((record) => ({
      topicId: record.get('id'),
      topicName: record.get('topicName'),
      researchCount: record.get('research_count').toNumber(),
      suggestedPriority: record.get('suggested_priority'),
    }));
  } finally {
    await session.close();
  }
}

/**
 * Retrieve high-performing published content (performanceLevel = 'high') along
 * with the topics that inspired it, for reuse as patterns during idea generation.
 */
export async function queryHighPerformingContent(
  limit: number = 5
): Promise<
  Array<{
    id: string;
    title: string;
    type: string;
    performanceLevel: string;
    insights: string;
    topics: string[];
  }>
> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (d:ContentDraft)
      WHERE d.performanceLevel = 'high'
      OPTIONAL MATCH (d)-[:DRAFT_OF]->(i:ContentIdea)-[:INSPIRED_BY]->(t:Topic)
      WITH d, collect(DISTINCT t.displayName) as topics
      RETURN d.id as id, d.title as title, d.type as type,
             d.performanceLevel as performanceLevel,
             d.performanceInsights as insights, topics
      ORDER BY d.publishedAt DESC
      LIMIT ${Math.max(1, Math.trunc(limit))}
      `,
      { limit }
    );

    return result.records.map((record) => ({
      id: record.get('id'),
      title: record.get('title'),
      type: record.get('type'),
      performanceLevel: record.get('performanceLevel'),
      insights: record.get('insights'),
      topics: record.get('topics').filter((t: string | null) => t !== null),
    }));
  } finally {
    await session.close();
  }
}

/**
 * Find published content sharing any of the given topics, for inner-linking.
 * Ordered by number of shared topics. Empty input short-circuits to [].
 */
export async function queryRelatedPublishedContent(
  topicIds: string[],
  limit: number = 5
): Promise<Array<{ id: string; title: string; type: string; publishedUrl: string }>> {
  if (!topicIds || topicIds.length === 0) {
    return [];
  }

  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (t:Topic)
      WHERE t.id IN $topicIds
      MATCH (i:ContentIdea)-[:INSPIRED_BY]->(t)
      MATCH (d:ContentDraft)-[:DRAFT_OF]->(i)
      WHERE d.status = 'published' AND d.publishedUrl IS NOT NULL
      WITH d, collect(DISTINCT t.displayName) as shared_topics
      RETURN d.id as id, d.title as title, d.type as type,
             d.publishedUrl as publishedUrl, shared_topics
      ORDER BY size(shared_topics) DESC
      LIMIT ${Math.max(1, Math.trunc(limit))}
      `,
      { topicIds, limit }
    );

    return result.records.map((record) => ({
      id: record.get('id'),
      title: record.get('title'),
      type: record.get('type'),
      publishedUrl: record.get('publishedUrl'),
    }));
  } finally {
    await session.close();
  }
}

// ============= CONTENT MATCHING FOR OUTREACH =============

/**
 * Find published content that matches given keywords/topics.
 * Used for traditional outreach to link existing content instead of creating reports.
 *
 * @param keywords - Search terms (industry, topics, etc.)
 * @param limit - Max results to return
 * @returns Published ContentDrafts sorted by performance (high first)
 */
export async function findMatchingContent(
  keywords: string[],
  limit: number = 5
): Promise<ContentDraft[]> {
  const session = await getSession();

  try {
    // Search published drafts by title/content matching keywords
    // Order by performanceLevel (high > medium > low > null)
    const result = await session.run(
      `
      MATCH (d:ContentDraft)
      WHERE d.status = 'published'
        AND d.publishedUrl IS NOT NULL
        AND any(keyword IN $keywords WHERE
          toLower(d.title) CONTAINS toLower(keyword) OR
          toLower(d.content) CONTAINS toLower(keyword)
        )
      RETURN d
      ORDER BY
        CASE d.performanceLevel
          WHEN 'high' THEN 0
          WHEN 'medium' THEN 1
          WHEN 'low' THEN 2
          ELSE 3
        END,
        d.publishedAt DESC
      LIMIT $limit
      `,
      { keywords, limit }
    );

    return result.records.map((record) => {
      const draft = record.get('d').properties;
      return mapDraftFromNeo4j(draft);
    });
  } finally {
    await session.close();
  }
}
