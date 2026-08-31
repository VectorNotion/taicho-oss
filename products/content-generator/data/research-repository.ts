import { getSession } from '@content-automation/platform/data/graph';
import type {
  ResearchSource,
  CreateResearchSourceInput,
  UpdateResearchSourceInput,
  ResearchItem,
  ResearchItemPriority,
  CreateResearchItemInput,
  UpdateResearchItemInput,
  ResearchItemFilters,
} from '../domain/research';

// ============= RESEARCH SOURCES =============

export async function createResearchSource(
  data: CreateResearchSourceInput
): Promise<ResearchSource> {
  const session = await getSession();
  const now = new Date().toISOString();

  try {
    const result = await session.run(
      `
      CREATE (s:ResearchSource {
        id: randomUUID(),
        name: $name,
        type: $type,
        url: $url,
        enabled: $enabled,
        createdAt: $now,
        updatedAt: $now
      })
      RETURN s
      `,
      {
        name: data.name,
        type: data.type,
        url: data.url,
        enabled: data.enabled ?? true,
        now,
      }
    );

    const record = result.records[0];
    const source = record.get('s').properties;

    return {
      id: source.id,
      name: source.name,
      type: source.type,
      url: source.url,
      enabled: source.enabled,
      createdAt: source.createdAt.toString(),
      updatedAt: source.updatedAt.toString(),
    };
  } finally {
    await session.close();
  }
}

export async function getResearchSources(): Promise<ResearchSource[]> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (s:ResearchSource)
      RETURN s
      ORDER BY toString(s.createdAt) DESC
      `
    );

    return result.records.map((record) => {
      const source = record.get('s').properties;
      return {
        id: source.id,
        name: source.name,
        type: source.type,
        url: source.url,
        enabled: source.enabled,
        createdAt: source.createdAt.toString(),
        updatedAt: source.updatedAt.toString(),
      };
    });
  } finally {
    await session.close();
  }
}

export async function getResearchSourceById(
  id: string
): Promise<ResearchSource | null> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (s:ResearchSource {id: $id})
      RETURN s
      `,
      { id }
    );

    if (result.records.length === 0) {
      return null;
    }

    const source = result.records[0].get('s').properties;
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      url: source.url,
      enabled: source.enabled,
      createdAt: source.createdAt.toString(),
      updatedAt: source.updatedAt.toString(),
    };
  } finally {
    await session.close();
  }
}

export async function updateResearchSource(
  id: string,
  data: UpdateResearchSourceInput
): Promise<ResearchSource | null> {
  const session = await getSession();

  try {
    // Build SET clause dynamically based on provided fields
    const setClauses: string[] = ['s.updatedAt = $updatedAt'];
    const params: Record<string, unknown> = { id, updatedAt: new Date().toISOString() };

    if (data.name !== undefined) {
      setClauses.push('s.name = $name');
      params.name = data.name;
    }
    if (data.type !== undefined) {
      setClauses.push('s.type = $type');
      params.type = data.type;
    }
    if (data.url !== undefined) {
      setClauses.push('s.url = $url');
      params.url = data.url;
    }
    if (data.enabled !== undefined) {
      setClauses.push('s.enabled = $enabled');
      params.enabled = data.enabled;
    }

    const result = await session.run(
      `
      MATCH (s:ResearchSource {id: $id})
      SET ${setClauses.join(', ')}
      RETURN s
      `,
      params
    );

    if (result.records.length === 0) {
      return null;
    }

    const source = result.records[0].get('s').properties;
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      url: source.url,
      enabled: source.enabled,
      createdAt: source.createdAt.toString(),
      updatedAt: source.updatedAt.toString(),
    };
  } finally {
    await session.close();
  }
}

export async function deleteResearchSource(id: string): Promise<boolean> {
  const session = await getSession();

  try {
    // First delete any YIELDED relationships, then the source
    const result = await session.run(
      `
      MATCH (s:ResearchSource {id: $id})
      OPTIONAL MATCH (s)-[r:YIELDED]->()
      DELETE r, s
      RETURN count(s) as deleted
      `,
      { id }
    );

    const deleted = result.records[0].get('deleted').toInt();
    return deleted > 0;
  } finally {
    await session.close();
  }
}

export async function getEnabledResearchSources(): Promise<ResearchSource[]> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (s:ResearchSource {enabled: true})
      RETURN s
      ORDER BY toString(s.createdAt) DESC
      `
    );

    return result.records.map((record) => {
      const source = record.get('s').properties;
      return {
        id: source.id,
        name: source.name,
        type: source.type,
        url: source.url,
        enabled: source.enabled,
        createdAt: source.createdAt.toString(),
        updatedAt: source.updatedAt.toString(),
      };
    });
  } finally {
    await session.close();
  }
}

// ============= RESEARCH ITEMS =============

export async function createResearchItem(
  data: CreateResearchItemInput
): Promise<ResearchItem> {
  const session = await getSession();
  const now = new Date().toISOString();

  try {
    const result = await session.run(
      `
      CREATE (i:ResearchItem {
        id: randomUUID(),
        title: $title,
        content: $content,
        sourceUrl: $sourceUrl,
        sourceId: $sourceId,
        addedBy: $addedBy,
        addedAt: $now,
        tags: $tags,
        status: $status,
        priority: $priority,
        humanNote: $humanNote,
        createdAt: $now,
        updatedAt: $now
      })
      RETURN i
      `,
      {
        title: data.title,
        content: data.content,
        sourceUrl: data.sourceUrl,
        sourceId: data.sourceId || null,
        addedBy: data.addedBy || 'manual',
        tags: data.tags || [],
        status: data.status || 'unprocessed',
        priority: data.priority || 'medium',
        humanNote: data.humanNote || null,
        now,
      }
    );

    const record = result.records[0];
    const item = record.get('i').properties;

    // Create YIELDED relationship if sourceId provided
    if (data.sourceId) {
      await session.run(
        `
        MATCH (s:ResearchSource {id: $sourceId})
        MATCH (i:ResearchItem {id: $itemId})
        MERGE (s)-[:YIELDED]->(i)
        `,
        { sourceId: data.sourceId, itemId: item.id }
      );
    }

    return {
      id: item.id,
      title: item.title,
      content: item.content,
      sourceUrl: item.sourceUrl,
      sourceId: item.sourceId,
      addedBy: item.addedBy,
      addedAt: item.addedAt.toString(),
      tags: item.tags,
      status: item.status,
      priority: item.priority,
      humanNote: item.humanNote,
      createdAt: item.createdAt.toString(),
      updatedAt: item.updatedAt.toString(),
    };
  } finally {
    await session.close();
  }
}

export async function getResearchItems(
  filters?: ResearchItemFilters
): Promise<ResearchItem[]> {
  const session = await getSession();

  try {
    // Build WHERE clause based on filters
    const whereClauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters?.status) {
      whereClauses.push('i.status = $status');
      params.status = filters.status;
    }
    if (filters?.priority) {
      whereClauses.push('i.priority = $priority');
      params.priority = filters.priority;
    }
    if (filters?.sourceId) {
      whereClauses.push('i.sourceId = $sourceId');
      params.sourceId = filters.sourceId;
    }
    if (filters?.addedBy) {
      whereClauses.push('i.addedBy = $addedBy');
      params.addedBy = filters.addedBy;
    }

    const whereClause =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const result = await session.run(
      `
      MATCH (i:ResearchItem)
      ${whereClause}
      OPTIONAL MATCH (s:ResearchSource)-[:YIELDED]->(i)
      RETURN i, s.name as sourceName
      ORDER BY toString(i.createdAt) DESC
      `,
      params
    );

    return result.records.map((record) => {
      const item = record.get('i').properties;
      const sourceName = record.get('sourceName');
      return {
        id: item.id,
        title: item.title,
        content: item.content,
        sourceUrl: item.sourceUrl,
        sourceId: item.sourceId,
        sourceName: sourceName || undefined,
        addedBy: item.addedBy,
        addedAt: item.addedAt.toString(),
        tags: item.tags,
        status: item.status,
        priority: item.priority,
        humanNote: item.humanNote,
        createdAt: item.createdAt.toString(),
        updatedAt: item.updatedAt.toString(),
      };
    });
  } finally {
    await session.close();
  }
}

export async function getResearchItemById(
  id: string
): Promise<ResearchItem | null> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (i:ResearchItem {id: $id})
      OPTIONAL MATCH (s:ResearchSource)-[:YIELDED]->(i)
      RETURN i, s.name as sourceName
      `,
      { id }
    );

    if (result.records.length === 0) {
      return null;
    }

    const item = result.records[0].get('i').properties;
    const sourceName = result.records[0].get('sourceName');
    return {
      id: item.id,
      title: item.title,
      content: item.content,
      sourceUrl: item.sourceUrl,
      sourceId: item.sourceId,
      sourceName: sourceName || undefined,
      addedBy: item.addedBy,
      addedAt: item.addedAt.toString(),
      tags: item.tags,
      status: item.status,
      priority: item.priority,
      humanNote: item.humanNote,
      createdAt: item.createdAt.toString(),
      updatedAt: item.updatedAt.toString(),
    };
  } finally {
    await session.close();
  }
}

export async function updateResearchItem(
  id: string,
  data: UpdateResearchItemInput
): Promise<ResearchItem | null> {
  const session = await getSession();

  try {
    // Build SET clause dynamically based on provided fields
    const setClauses: string[] = ['i.updatedAt = $updatedAt'];
    const params: Record<string, unknown> = { id, updatedAt: new Date().toISOString() };

    if (data.title !== undefined) {
      setClauses.push('i.title = $title');
      params.title = data.title;
    }
    if (data.content !== undefined) {
      setClauses.push('i.content = $content');
      params.content = data.content;
    }
    if (data.status !== undefined) {
      setClauses.push('i.status = $status');
      params.status = data.status;
    }
    if (data.priority !== undefined) {
      setClauses.push('i.priority = $priority');
      params.priority = data.priority;
    }
    if (data.humanNote !== undefined) {
      setClauses.push('i.humanNote = $humanNote');
      params.humanNote = data.humanNote;
    }
    if (data.tags !== undefined) {
      setClauses.push('i.tags = $tags');
      params.tags = data.tags;
    }

    const result = await session.run(
      `
      MATCH (i:ResearchItem {id: $id})
      SET ${setClauses.join(', ')}
      RETURN i
      `,
      params
    );

    if (result.records.length === 0) {
      return null;
    }

    const item = result.records[0].get('i').properties;
    return {
      id: item.id,
      title: item.title,
      content: item.content,
      sourceUrl: item.sourceUrl,
      sourceId: item.sourceId,
      addedBy: item.addedBy,
      addedAt: item.addedAt.toString(),
      tags: item.tags,
      status: item.status,
      priority: item.priority,
      humanNote: item.humanNote,
      createdAt: item.createdAt.toString(),
      updatedAt: item.updatedAt.toString(),
    };
  } finally {
    await session.close();
  }
}

export async function deleteResearchItem(id: string): Promise<boolean> {
  const session = await getSession();

  try {
    // Delete relationships and node
    const result = await session.run(
      `
      MATCH (i:ResearchItem {id: $id})
      OPTIONAL MATCH ()-[r]->(i)
      OPTIONAL MATCH (i)-[r2]->()
      DELETE r, r2, i
      RETURN count(i) as deleted
      `,
      { id }
    );

    const deleted = result.records[0].get('deleted').toInt();
    return deleted > 0;
  } finally {
    await session.close();
  }
}

// ============= AGENT MIGRATION: RESEARCH (do_research / extract_topics) =============

export interface CreateResearchItemFromAgentInput {
  title: string;
  content: string;
  sourceUrl: string;
  sourceId?: string | null;
  tags?: string[];
  priority?: ResearchItemPriority;
}

/**
 * Persist a research item produced by the researcher agent, deduping by URL.
 *
 * If an item with the same sourceUrl already exists, its id is returned with
 * `deduped: true` and nothing is written. Otherwise a new
 * `research-item-<uuid>` node (addedBy 'researcher_agent', status 'unprocessed')
 * is created and, when a sourceId is given, a `(:ResearchSource)-[:YIELDED]->`
 * edge is merged.
 */
export async function createResearchItemFromAgent(
  input: CreateResearchItemFromAgentInput
): Promise<{ id: string; deduped: boolean }> {
  const session = await getSession();

  try {
    // Dedup on sourceUrl — return the existing id untouched.
    const existing = await session.run(
      `MATCH (i:ResearchItem {sourceUrl: $url}) RETURN i.id as id`,
      { url: input.sourceUrl }
    );
    if (existing.records.length > 0) {
      return { id: existing.records[0].get('id'), deduped: true };
    }

    const sourceId = input.sourceId || null;
    const now = new Date().toISOString();
    const created = await session.run(
      `
      CREATE (i:ResearchItem {
        id: 'research-item-' + randomUUID(),
        title: $title,
        content: $content,
        sourceUrl: $sourceUrl,
        sourceId: $sourceId,
        addedBy: 'researcher_agent',
        addedAt: $now,
        tags: $tags,
        status: 'unprocessed',
        priority: $priority,
        humanNote: null,
        createdAt: $now,
        updatedAt: $now
      })
      RETURN i.id as id
      `,
      {
        title: input.title,
        content: input.content,
        sourceUrl: input.sourceUrl,
        sourceId,
        tags: input.tags || [],
        priority: input.priority || 'medium',
        now,
      }
    );

    const id = created.records[0].get('id');

    if (sourceId) {
      await session.run(
        `
        MATCH (s:ResearchSource {id: $sourceId})
        MATCH (i:ResearchItem {id: $itemId})
        MERGE (s)-[:YIELDED]->(i)
        `,
        { sourceId, itemId: id }
      );
    }

    return { id, deduped: false };
  } finally {
    await session.close();
  }
}

/**
 * Link a research item to active topics whose names match any of its tags
 * (bidirectional case-insensitive CONTAINS). No-op when there are no tags.
 */
export async function linkResearchToMatchingTopics(
  itemId: string,
  tags: string[]
): Promise<void> {
  if (!tags || tags.length === 0) {
    return;
  }

  const session = await getSession();

  try {
    await session.run(
      `
      MATCH (r:ResearchItem {id: $itemId})
      MATCH (t:Topic {status: 'active'})
      WHERE ANY(tag IN $tags WHERE
          toLower(tag) CONTAINS toLower(t.name)
          OR toLower(t.name) CONTAINS toLower(tag)
      )
      MERGE (r)-[:COVERS_TOPIC]->(t)
      `,
      { itemId, tags }
    );
  } finally {
    await session.close();
  }
}

/**
 * Get research items created in the last N days (for topic extraction / ideas).
 */
export async function getRecentResearchItems(
  days: number
): Promise<ResearchItem[]> {
  const session = await getSession();
  const cutoff = new Date(Date.now() - Math.max(0, days) * 86_400_000).toISOString();

  try {
    const result = await session.run(
      `
      MATCH (i:ResearchItem)
      WHERE toString(i.createdAt) > $cutoff
      RETURN i
      ORDER BY toString(i.createdAt) DESC
      `,
      { cutoff }
    );

    return result.records.map((record) => {
      const item = record.get('i').properties;
      return {
        id: item.id,
        title: item.title,
        content: item.content,
        sourceUrl: item.sourceUrl,
        sourceId: item.sourceId,
        addedBy: item.addedBy,
        addedAt: item.addedAt.toString(),
        tags: item.tags,
        status: item.status,
        priority: item.priority,
        humanNote: item.humanNote,
        createdAt: item.createdAt.toString(),
        updatedAt: item.updatedAt.toString(),
      };
    });
  } finally {
    await session.close();
  }
}

/**
 * Get distinct research items covering any of the given topics, for refinement
 * context. Returns a compact projection ordered by the graph's natural order.
 */
export async function getResearchItemsByTopicIds(
  topicIds: string[],
  limit: number = 10
): Promise<Array<{ id: string; title: string; content: string; sourceUrl: string }>> {
  if (!topicIds || topicIds.length === 0) {
    return [];
  }

  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (r:ResearchItem)-[:COVERS_TOPIC]->(t:Topic)
      WHERE t.id IN $topicIds
      RETURN DISTINCT r.id as id, r.title as title,
             r.content as content, r.sourceUrl as sourceUrl
      LIMIT ${Math.max(1, Math.trunc(limit))}
      `,
      { topicIds, limit }
    );

    return result.records.map((record) => ({
      id: record.get('id'),
      title: record.get('title'),
      content: record.get('content'),
      sourceUrl: record.get('sourceUrl'),
    }));
  } finally {
    await session.close();
  }
}

// Deduplication check
export async function researchItemExistsByUrl(
  sourceUrl: string
): Promise<boolean> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (i:ResearchItem {sourceUrl: $sourceUrl})
      RETURN count(i) > 0 as exists
      `,
      { sourceUrl }
    );

    return result.records[0]?.get('exists') ?? false;
  } finally {
    await session.close();
  }
}
