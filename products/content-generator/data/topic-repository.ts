import { getSession } from '@content-automation/platform/data/graph';
import type {
  Topic,
  CreateTopicInput,
  UpdateTopicInput,
  TopicsResponse,
} from '../domain/topic';

/**
 * Convert canonical name to lowercase hyphenated format.
 */
function normalizeTopicName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Get all topics with optional dismissed filter.
 */
export async function getTopics(
  includeDismissed: boolean = false
): Promise<TopicsResponse> {
  const session = await getSession();

  try {
    // Get all topics with mention counts
    const result = await session.run(
      `
      MATCH (t:Topic)
      ${includeDismissed ? '' : "WHERE t.status = 'active'"}
      OPTIONAL MATCH (r:ResearchItem)-[:COVERS_TOPIC]->(t)
      WITH t, count(r) as mentionCount
      RETURN t, mentionCount
      ORDER BY toString(t.createdAt) DESC
      `
    );

    const topics: Topic[] = result.records.map((record) => {
      const topic = record.get('t').properties;
      const mentionCount = record.get('mentionCount').toInt();
      return {
        id: topic.id,
        name: topic.name,
        displayName: topic.displayName,
        description: topic.description,
        status: topic.status,
        source: topic.source,
        createdAt: topic.createdAt.toString(),
        updatedAt: topic.updatedAt.toString(),
        dismissedAt: topic.dismissedAt ? topic.dismissedAt.toString() : null,
        mentionCount,
      };
    });

    // Get counts
    const countResult = await session.run(`
      MATCH (t:Topic)
      RETURN
        count(t) as total,
        sum(CASE WHEN t.status = 'active' THEN 1 ELSE 0 END) as activeCount,
        sum(CASE WHEN t.status = 'dismissed' THEN 1 ELSE 0 END) as dismissedCount
    `);

    const counts = countResult.records[0];
    return {
      topics,
      total: counts.get('total').toInt(),
      activeCount: counts.get('activeCount').toInt(),
      dismissedCount: counts.get('dismissedCount').toInt(),
    };
  } finally {
    await session.close();
  }
}

/**
 * Get a single topic by ID.
 */
export async function getTopicById(id: string): Promise<Topic | null> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (t:Topic {id: $id})
      OPTIONAL MATCH (r:ResearchItem)-[:COVERS_TOPIC]->(t)
      WITH t, count(r) as mentionCount
      RETURN t, mentionCount
      `,
      { id }
    );

    if (result.records.length === 0) {
      return null;
    }

    const topic = result.records[0].get('t').properties;
    const mentionCount = result.records[0].get('mentionCount').toInt();

    return {
      id: topic.id,
      name: topic.name,
      displayName: topic.displayName,
      description: topic.description,
      status: topic.status,
      source: topic.source,
      createdAt: topic.createdAt.toString(),
      updatedAt: topic.updatedAt.toString(),
      dismissedAt: topic.dismissedAt ? topic.dismissedAt.toString() : null,
      mentionCount,
    };
  } finally {
    await session.close();
  }
}

/**
 * Check if a topic exists by canonical name (includes dismissed topics).
 */
export async function topicExistsByName(name: string): Promise<boolean> {
  const session = await getSession();
  const normalizedName = normalizeTopicName(name);

  try {
    const result = await session.run(
      `
      MATCH (t:Topic {name: $name})
      RETURN count(t) > 0 as exists
      `,
      { name: normalizedName }
    );

    return result.records[0]?.get('exists') ?? false;
  } finally {
    await session.close();
  }
}

/**
 * Create a new topic.
 * Returns null if topic with same name already exists (including dismissed).
 */
export async function createTopic(
  data: CreateTopicInput
): Promise<Topic | null> {
  const session = await getSession();
  const normalizedName = normalizeTopicName(data.name);
  const now = new Date().toISOString();
  const candidateId = `topic-${crypto.randomUUID()}`;

  try {
    const result = await session.run(
      `
      MERGE (t:Topic {name: $name})
      ON CREATE SET
        t.id = $candidateId,
        t.displayName = $displayName,
        t.description = $description,
        t.status = 'active',
        t.source = $source,
        t.createdAt = $now,
        t.updatedAt = $now,
        t.dismissedAt = null
      RETURN t, t.id = $candidateId AS created
      `,
      {
        candidateId,
        name: normalizedName,
        displayName: data.displayName,
        description: data.description,
        source: data.source || 'manual',
        now,
      }
    );

    if (!result.records[0].get('created')) return null;

    const topic = result.records[0].get('t').properties;

    return {
      id: topic.id,
      name: topic.name,
      displayName: topic.displayName,
      description: topic.description,
      status: topic.status,
      source: topic.source,
      createdAt: topic.createdAt.toString(),
      updatedAt: topic.updatedAt.toString(),
      dismissedAt: null,
      mentionCount: 0,
    };
  } finally {
    await session.close();
  }
}

/**
 * Update a topic's display name and/or description.
 */
export async function updateTopic(
  id: string,
  data: UpdateTopicInput
): Promise<Topic | null> {
  const session = await getSession();

  try {
    const setClauses: string[] = ['t.updatedAt = $now'];
    const params: Record<string, unknown> = { id, now: new Date().toISOString() };

    if (data.displayName !== undefined) {
      setClauses.push('t.displayName = $displayName');
      params.displayName = data.displayName;
    }
    if (data.description !== undefined) {
      setClauses.push('t.description = $description');
      params.description = data.description;
    }

    const result = await session.run(
      `
      MATCH (t:Topic {id: $id})
      SET ${setClauses.join(', ')}
      WITH t
      OPTIONAL MATCH (r:ResearchItem)-[:COVERS_TOPIC]->(t)
      WITH t, count(r) as mentionCount
      RETURN t, mentionCount
      `,
      params
    );

    if (result.records.length === 0) {
      return null;
    }

    const topic = result.records[0].get('t').properties;
    const mentionCount = result.records[0].get('mentionCount').toInt();

    return {
      id: topic.id,
      name: topic.name,
      displayName: topic.displayName,
      description: topic.description,
      status: topic.status,
      source: topic.source,
      createdAt: topic.createdAt.toString(),
      updatedAt: topic.updatedAt.toString(),
      dismissedAt: topic.dismissedAt ? topic.dismissedAt.toString() : null,
      mentionCount,
    };
  } finally {
    await session.close();
  }
}

/**
 * Soft delete a topic (set status to dismissed).
 */
export async function dismissTopic(id: string): Promise<Topic | null> {
  const session = await getSession();
  const now = new Date().toISOString();

  try {
    const result = await session.run(
      `
      MATCH (t:Topic {id: $id})
      SET t.status = 'dismissed',
          t.dismissedAt = $now,
          t.updatedAt = $now
      WITH t
      OPTIONAL MATCH (r:ResearchItem)-[:COVERS_TOPIC]->(t)
      WITH t, count(r) as mentionCount
      RETURN t, mentionCount
      `,
      { id, now }
    );

    if (result.records.length === 0) {
      return null;
    }

    const topic = result.records[0].get('t').properties;
    const mentionCount = result.records[0].get('mentionCount').toInt();

    return {
      id: topic.id,
      name: topic.name,
      displayName: topic.displayName,
      description: topic.description,
      status: topic.status,
      source: topic.source,
      createdAt: topic.createdAt.toString(),
      updatedAt: topic.updatedAt.toString(),
      dismissedAt: topic.dismissedAt ? topic.dismissedAt.toString() : null,
      mentionCount,
    };
  } finally {
    await session.close();
  }
}

/**
 * Restore a dismissed topic.
 */
export async function restoreTopic(id: string): Promise<Topic | null> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (t:Topic {id: $id})
      SET t.status = 'active',
          t.dismissedAt = null,
          t.updatedAt = $now
      WITH t
      OPTIONAL MATCH (r:ResearchItem)-[:COVERS_TOPIC]->(t)
      WITH t, count(r) as mentionCount
      RETURN t, mentionCount
      `,
      { id, now: new Date().toISOString() }
    );

    if (result.records.length === 0) {
      return null;
    }

    const topic = result.records[0].get('t').properties;
    const mentionCount = result.records[0].get('mentionCount').toInt();

    return {
      id: topic.id,
      name: topic.name,
      displayName: topic.displayName,
      description: topic.description,
      status: topic.status,
      source: topic.source,
      createdAt: topic.createdAt.toString(),
      updatedAt: topic.updatedAt.toString(),
      dismissedAt: null,
      mentionCount,
    };
  } finally {
    await session.close();
  }
}

/**
 * Get all topics including dismissed (for deduplication checks).
 */
export async function getAllTopicsForDedup(): Promise<
  Array<{ id: string; name: string; status: string }>
> {
  const session = await getSession();

  try {
    const result = await session.run(`
      MATCH (t:Topic)
      RETURN t.id as id, t.name as name, t.status as status
    `);

    return result.records.map((record) => ({
      id: record.get('id'),
      name: record.get('name'),
      status: record.get('status'),
    }));
  } finally {
    await session.close();
  }
}

// ============= AGENT MIGRATION: TOPIC LINKING (extract_topics) =============

/**
 * Link a topic to its source entities via DERIVED_FROM.
 *
 * Only AIComponent / Feature / BusinessValue entities are eligible; matching is
 * case-insensitive on entity name. No-op when there are no entity names.
 */
export async function linkTopicToEntities(
  topicId: string,
  entityNames: string[]
): Promise<void> {
  if (!entityNames || entityNames.length === 0) {
    return;
  }

  const session = await getSession();

  try {
    await session.run(
      `
      MATCH (t:Topic {id: $topicId})
      UNWIND $entityNames as entity_name
      MATCH (e)
      WHERE (e:AIComponent OR e:Feature OR e:BusinessValue)
        AND toLower(e.name) = toLower(entity_name)
      MERGE (t)-[:DERIVED_FROM]->(e)
      `,
      { topicId, entityNames }
    );
  } finally {
    await session.close();
  }
}

/**
 * Link a topic to research items that mention it via COVERS_TOPIC.
 *
 * The canonical (hyphenated) topic name is normalized to a lowercase,
 * space-separated term and matched against each item's tags, content, or title.
 */
export async function linkTopicToResearch(
  topicId: string,
  topicName: string
): Promise<void> {
  const session = await getSession();
  const term = topicName.toLowerCase().replace(/-/g, ' ');

  try {
    await session.run(
      `
      MATCH (t:Topic {id: $topicId})
      MATCH (r:ResearchItem)
      WHERE any(tag IN r.tags WHERE toLower(tag) CONTAINS $term)
         OR toLower(r.content) CONTAINS $term
         OR toLower(r.title) CONTAINS $term
      MERGE (r)-[:COVERS_TOPIC]->(t)
      `,
      { topicId, term }
    );
  } finally {
    await session.close();
  }
}

/**
 * Delete ALL topics from the database (complete reset).
 * Also removes all relationships connected to Topic nodes.
 */
export async function resetAllTopics(): Promise<{ deletedCount: number }> {
  const session = await getSession();

  try {
    // Count topics before deletion
    const countResult = await session.run(`
      MATCH (t:Topic)
      RETURN count(t) as total
    `);
    const deletedCount = countResult.records[0]?.get('total')?.toInt() ?? 0;

    // Delete all relationships connected to Topic nodes (both directions)
    // This includes COVERS_TOPIC (incoming) and DERIVED_FROM (outgoing)
    await session.run(`
      MATCH (t:Topic)
      DETACH DELETE t
    `);

    return { deletedCount };
  } finally {
    await session.close();
  }
}
