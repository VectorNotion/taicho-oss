import { getSession } from '@content-automation/platform/data/graph';

function graphTimestamp(value: unknown): string {
  const serialized = String(value);
  if (
    /^\d{4}-\d{2}-\d{2}T/.test(serialized)
    && !/(?:Z|[+-]\d{2}:\d{2})(?:\[.*\])?$/.test(serialized)
  ) {
    // Legacy project rows used FalkorDB localdatetime(), whose timezone-free
    // value represents the database's UTC clock. Make that contract explicit
    // before the browser parses it.
    return `${serialized}Z`;
  }
  return serialized;
}

// Project operations
export async function createProject(data: {
  title: string;
  description: string;
  kind?: string;
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
        kind: $kind,
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
        kind: data.kind || 'project',
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
      kind: project.kind || 'project',
      tags: project.tags,
      demoUrl: project.demoUrl,
      githubUrl: project.githubUrl,
      liveUrl: project.liveUrl,
      docsUrl: project.docsUrl,
      createdAt: graphTimestamp(project.createdAt),
      updatedAt: graphTimestamp(project.updatedAt),
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
      OPTIONAL MATCH (p)-[r:KNOWLEDGE_HAS]->(e:CanonicalEntity {schemaVersion: 'knowledge.v1'})
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
        kind: project.kind || 'project',
        tags: project.tags,
        demoUrl: project.demoUrl,
        githubUrl: project.githubUrl,
        liveUrl: project.liveUrl,
        docsUrl: project.docsUrl,
        createdAt: graphTimestamp(project.createdAt),
        updatedAt: graphTimestamp(project.updatedAt),
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
      kind: project.kind || 'project',
      tags: project.tags,
      demoUrl: project.demoUrl,
      githubUrl: project.githubUrl,
      liveUrl: project.liveUrl,
      docsUrl: project.docsUrl,
      createdAt: graphTimestamp(project.createdAt),
      updatedAt: graphTimestamp(project.updatedAt),
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
    kind?: string;
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
          p.kind = $kind,
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
        kind: data.kind || 'project',
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
      kind: project.kind || 'project',
      tags: project.tags,
      demoUrl: project.demoUrl,
      githubUrl: project.githubUrl,
      liveUrl: project.liveUrl,
      docsUrl: project.docsUrl,
      createdAt: graphTimestamp(project.createdAt),
      updatedAt: graphTimestamp(project.updatedAt),
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

// ============= PROJECT KNOWLEDGE EXTRACTION =============

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
 * Removed compatibility shim. Callers must reconcile the complete registered
 * extraction profile so stale extraction-owned claims can be superseded.
 */
export async function storeProjectEntity(
  projectId: string,
  entity: { name: string; type: string }
): Promise<void> {
  void projectId;
  void entity;
  throw new Error('storeProjectEntity was removed; reconcile the complete content.project_extraction profile instead.');
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
 * The registered projection decides which entity roles are topic-bearing.
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
      MATCH (p:Project)-[r:KNOWLEDGE_HAS]->(e:CanonicalEntity {schemaVersion: 'knowledge.v1'})
      WITH r.typeKey as entity_type, r.name as name, e.id as id,
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
  entityId: string;
  claimId: string | null;
  relationship: string;
  name: string;
  type: string;
  statement: string | null;
  evidence: {
    id: string;
    excerpt: string;
    source: {
      id: string;
      kind: string;
      canonicalUri: string;
      title: string | null;
    } | null;
  } | null;
}

function parseKnowledgeJson<T>(value: unknown): T | null {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function getProjectEntities(projectId: string): Promise<ProjectEntity[]> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (p:Project {id: $projectId})-[r:KNOWLEDGE_HAS]->(e:CanonicalEntity {schemaVersion: 'knowledge.v1'})
      OPTIONAL MATCH (claim:Claim {id: r.claimId, schemaVersion: 'knowledge.v1'})-[:SUPPORTED_BY]->(evidence:Evidence {schemaVersion: 'knowledge.v1'})
      OPTIONAL MATCH (revision:SourceRevision {id: evidence.revisionId, schemaVersion: 'knowledge.v1'})
      OPTIONAL MATCH (source:KnowledgeSource {id: revision.sourceId, schemaVersion: 'knowledge.v1'})
      RETURN 'KNOWLEDGE_HAS' as relationship,
             e.id as entityId,
             r.claimId as claimId,
             r.name as name,
             r.typeKey as type,
             claim.json as claimJson,
             evidence.json as evidenceJson,
             source.json as sourceJson
      ORDER BY r.typeKey, r.name
      `,
      { projectId }
    );

    return result.records.map((record) => {
      const claim = parseKnowledgeJson<{ statement?: string }>(record.get('claimJson'));
      const evidence = parseKnowledgeJson<{ id: string; excerpt: string }>(record.get('evidenceJson'));
      const source = parseKnowledgeJson<{ id: string; kind: string; canonicalUri: string; title?: string }>(record.get('sourceJson'));
      return {
        entityId: record.get('entityId'),
        claimId: record.get('claimId') ?? null,
        relationship: record.get('relationship'),
        name: record.get('name'),
        type: record.get('type'),
        statement: claim?.statement ?? null,
        evidence: evidence ? {
          id: evidence.id,
          excerpt: evidence.excerpt,
          source: source ? {
            id: source.id,
            kind: source.kind,
            canonicalUri: source.canonicalUri,
            title: source.title ?? null,
          } : null,
        } : null,
      };
    });
  } finally {
    await session.close();
  }
}
