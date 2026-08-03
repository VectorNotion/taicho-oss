import { getSession } from '@content-automation/platform/data/graph';

// Project operations
export async function createProject(data: {
  title: string;
  description: string;
  tags: string[];
  demoUrl?: string;
  githubUrl?: string;
  liveUrl?: string;
  docsUrl?: string;
}) {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      CREATE (p:Project {
        id: randomUUID(),
        title: $title,
        description: $description,
        tags: $tags,
        demoUrl: $demoUrl,
        githubUrl: $githubUrl,
        liveUrl: $liveUrl,
        docsUrl: $docsUrl,
        createdAt: localdatetime(),
        updatedAt: localdatetime()
      })
      RETURN p
      `,
      {
        title: data.title,
        description: data.description,
        tags: data.tags,
        demoUrl: data.demoUrl || null,
        githubUrl: data.githubUrl || null,
        liveUrl: data.liveUrl || null,
        docsUrl: data.docsUrl || null,
      }
    );

    const record = result.records[0];
    const project = record.get('p').properties;

    return {
      id: project.id,
      title: project.title,
      description: project.description,
      tags: project.tags,
      demoUrl: project.demoUrl,
      githubUrl: project.githubUrl,
      liveUrl: project.liveUrl,
      docsUrl: project.docsUrl,
      createdAt: project.createdAt.toString(),
      updatedAt: project.updatedAt.toString(),
    };
  } finally {
    await session.close();
  }
}

export async function getProjects() {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (p:Project)
      OPTIONAL MATCH (p)-[r]->(e)
      WHERE e:Framework OR e:Database OR e:Cloud OR e:Language
         OR e:AIComponent OR e:Feature OR e:Integration OR e:BusinessValue
      WITH p, count(DISTINCT e) as entityCount
      RETURN p, entityCount
      ORDER BY p.createdAt DESC
      `
    );

    return result.records.map((record) => {
      const project = record.get('p').properties;
      const entityCount = record.get('entityCount').toInt();
      return {
        id: project.id,
        title: project.title,
        description: project.description,
        tags: project.tags,
        demoUrl: project.demoUrl,
        githubUrl: project.githubUrl,
        liveUrl: project.liveUrl,
        docsUrl: project.docsUrl,
        createdAt: project.createdAt.toString(),
        updatedAt: project.updatedAt.toString(),
        entityCount: entityCount,
        processed: project.processed || false,
      };
    });
  } finally {
    await session.close();
  }
}

export async function getProjectById(id: string) {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (p:Project {id: $id})
      RETURN p
      `,
      { id }
    );

    if (result.records.length === 0) {
      return null;
    }

    const project = result.records[0].get('p').properties;
    return {
      id: project.id,
      title: project.title,
      description: project.description,
      tags: project.tags,
      demoUrl: project.demoUrl,
      githubUrl: project.githubUrl,
      liveUrl: project.liveUrl,
      docsUrl: project.docsUrl,
      createdAt: project.createdAt.toString(),
      updatedAt: project.updatedAt.toString(),
    };
  } finally {
    await session.close();
  }
}

export async function updateProject(
  id: string,
  data: {
    title?: string;
    description?: string;
    tags?: string[];
    demoUrl?: string;
    githubUrl?: string;
    liveUrl?: string;
    docsUrl?: string;
  }
) {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (p:Project {id: $id})
      SET p.title = $title,
          p.description = $description,
          p.tags = $tags,
          p.demoUrl = $demoUrl,
          p.githubUrl = $githubUrl,
          p.liveUrl = $liveUrl,
          p.docsUrl = $docsUrl,
          p.updatedAt = localdatetime()
      RETURN p
      `,
      {
        id,
        title: data.title,
        description: data.description,
        tags: data.tags || [],
        demoUrl: data.demoUrl || null,
        githubUrl: data.githubUrl || null,
        liveUrl: data.liveUrl || null,
        docsUrl: data.docsUrl || null,
      }
    );

    if (result.records.length === 0) {
      return null;
    }

    const project = result.records[0].get('p').properties;
    return {
      id: project.id,
      title: project.title,
      description: project.description,
      tags: project.tags,
      demoUrl: project.demoUrl,
      githubUrl: project.githubUrl,
      liveUrl: project.liveUrl,
      docsUrl: project.docsUrl,
      createdAt: project.createdAt.toString(),
      updatedAt: project.updatedAt.toString(),
    };
  } finally {
    await session.close();
  }
}

export async function deleteProject(id: string) {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (p:Project {id: $id})
      DELETE p
      RETURN count(p) as deleted
      `,
      { id }
    );

    const deleted = result.records[0].get('deleted').toInt();
    return deleted > 0;
  } finally {
    await session.close();
  }
}

// ============= AGENT MIGRATION: PROJECT GRAPH (build_project_graph) =============

/**
 * Entity type → project relationship type. Source of truth for the typed
 * project→entity edges written by the build_project_graph action.
 */
const ENTITY_RELATIONSHIP_MAP: Record<string, string> = {
  Framework: 'USES_FRAMEWORK',
  Database: 'USES_DATABASE',
  Cloud: 'DEPLOYED_ON',
  Language: 'WRITTEN_IN',
  AIComponent: 'IMPLEMENTS',
  Feature: 'HAS_FEATURE',
  Integration: 'INTEGRATES_WITH',
  BusinessValue: 'ACHIEVES',
};

/**
 * Read a project's processing state for the build_project_graph guard.
 * Returns null if the project does not exist.
 */
export async function getProjectProcessingState(
  id: string
): Promise<{ processed: boolean; entityCount: number } | null> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (p:Project {id: $id})
      RETURN coalesce(p.processed, false) as processed,
             coalesce(p.entity_count, 0) as entityCount
      `,
      { id }
    );

    if (result.records.length === 0) {
      return null;
    }

    const record = result.records[0];
    return {
      processed: record.get('processed'),
      entityCount: record.get('entityCount').toNumber(),
    };
  } finally {
    await session.close();
  }
}

/**
 * Store an extracted entity with dedup and a typed project→entity relationship.
 *
 * Dedup is by (label, name): an existing entity of the same type/name is reused
 * (its last_mentioned bumped); otherwise a new `{type_lower}-<uuid>` node is
 * created. The typed edge (per ENTITY_RELATIONSHIP_MAP) is MERGE'd either way.
 */
export async function storeProjectEntity(
  projectId: string,
  entity: { name: string; type: string }
): Promise<void> {
  const relationship = ENTITY_RELATIONSHIP_MAP[entity.type];
  if (!relationship) {
    throw new Error(`Unknown project entity type: ${entity.type}`);
  }

  const session = await getSession();

  try {
    // Dedup check by label + name (label cannot be parameterized).
    const existing = await session.run(
      `MATCH (e:${entity.type} {name: $name}) RETURN e.id as id`,
      { name: entity.name }
    );

    let entityId: string;
    if (existing.records.length > 0) {
      entityId = existing.records[0].get('id');
      await session.run(
        `
        MATCH (e:${entity.type} {id: $entityId})
        SET e.last_mentioned = localdatetime()
        `,
        { entityId }
      );
    } else {
      const created = await session.run(
        `
        CREATE (e:${entity.type} {
          id: $typeLower + '-' + randomUUID(),
          name: $name,
          first_mentioned: localdatetime(),
          last_mentioned: localdatetime()
        })
        RETURN e.id as id
        `,
        { typeLower: entity.type.toLowerCase(), name: entity.name }
      );
      entityId = created.records[0].get('id');
    }

    // Typed relationship is the source of truth for project↔entity connections.
    await session.run(
      `
      MATCH (p:Project {id: $projectId})
      MATCH (e:${entity.type} {id: $entityId})
      MERGE (p)-[r:${relationship}]->(e)
      SET r.created_at = localdatetime()
      `,
      { projectId, entityId }
    );
  } finally {
    await session.close();
  }
}

/**
 * Mark a project processed after entity extraction.
 */
export async function markProjectProcessed(
  projectId: string,
  entityCount: number
): Promise<void> {
  const session = await getSession();

  try {
    await session.run(
      `
      MATCH (p:Project {id: $projectId})
      SET p.processed = true,
          p.processed_at = localdatetime(),
          p.entity_count = toInteger($entityCount)
      `,
      { projectId, entityCount }
    );
  } finally {
    await session.close();
  }
}

/**
 * Aggregate entities by how many projects reference them, for topic extraction.
 * Restricted to AIComponent / Feature / BusinessValue (the topic-bearing types).
 */
export async function getEntitiesByProjectCount(): Promise<
  Array<{
    entityType: string;
    name: string;
    id: string;
    projectNames: string[];
    projectCount: number;
  }>
> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (p:Project)-[r]->(e)
      WHERE labels(e)[0] IN ['AIComponent', 'Feature', 'BusinessValue']
      WITH labels(e)[0] as entity_type, e.name as name, e.id as id,
           collect(p.title) as project_names, count(p) as project_count
      RETURN entity_type, name, id, project_names, project_count
      ORDER BY project_count DESC
      `
    );

    return result.records.map((record) => ({
      entityType: record.get('entity_type'),
      name: record.get('name'),
      id: record.get('id'),
      projectNames: record.get('project_names'),
      projectCount: record.get('project_count').toNumber(),
    }));
  } finally {
    await session.close();
  }
}

export interface ProjectEntity {
  relationship: string;
  name: string;
  type: string;
}

export async function getProjectEntities(projectId: string): Promise<ProjectEntity[]> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (p:Project {id: $projectId})-[r]->(e)
      WHERE e:Framework OR e:Database OR e:Cloud OR e:Language
         OR e:AIComponent OR e:Feature OR e:Integration OR e:BusinessValue
      RETURN type(r) as relationship,
             e.name as name,
             labels(e)[0] as type
      ORDER BY type(r), e.name
      `,
      { projectId }
    );

    return result.records.map((record) => ({
      relationship: record.get('relationship'),
      name: record.get('name'),
      type: record.get('type'),
    }));
  } finally {
    await session.close();
  }
}
