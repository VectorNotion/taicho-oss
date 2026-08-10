import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getSession } from '@content-automation/platform/data/graph';

const toInt = (value: number) => Math.floor(value);

// ============= Zod Schemas for Tool Outputs =============

const projectSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  status: z.string().nullish(),
  processed: z.boolean().nullish(),
});

const projectWithContextSchema = projectSchema.extend({
  tags: z.array(z.string()).nullish(),
  entities: z.array(z.object({
    type: z.string(),
    name: z.string(),
    relationship: z.string(),
  })),
  relatedResearch: z.array(z.object({
    id: z.string(),
    title: z.string(),
    content: z.string().nullish(),
    tags: z.array(z.string()).nullish(),
    priority: z.string().nullish(),
  })),
});

const prospectSchema = z.object({
  id: z.string(),
  name: z.string(),
  company: z.string().nullish(),
  title: z.string().nullish(),
  status: z.string().nullish(),
  hasResearch: z.boolean(),
});

const prospectWithResearchSchema = z.object({
  id: z.string(),
  name: z.string(),
  company: z.string().nullish(),
  title: z.string().nullish(),
  email: z.string().nullish(),
  linkedinUrl: z.string().nullish(),
  status: z.string().nullish(),
  research: z.object({
    industry: z.string().nullish(),
    companySummary: z.string().nullish(),
    talkingPoints: z.array(z.string()).nullish(),
    outreachAngle: z.string().nullish(),
  }).nullish(),
  companyInsights: z.array(z.object({
    category: z.string(),
    content: z.string(),
  })),
  outreachMessages: z.array(z.object({
    id: z.string(),
    medium: z.string(),
    subject: z.string().nullish(),
    content: z.string(),
    status: z.string().nullish(),
    createdAt: z.string().nullish(),
  })),
});

const researchItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string().nullish(),
  sourceUrl: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  priority: z.string().nullish(),
  createdAt: z.string().nullish(),
});

const topicSchema = z.object({
  id: z.string(),
  displayName: z.string().nullish(),
  name: z.string(),
  description: z.string().nullish(),
  researchCount: z.number(),
});

// ============= Tools =============

export const searchKnowledgeTool = createTool({
  id: 'search-knowledge',
  description: 'Search across all knowledge types: projects, prospects, research items, and topics. Use this for broad searches across the entire knowledge base.',
  inputSchema: z.object({
    query: z.string().describe('Search term to find across all entity types'),
    limit: z.number().optional().default(5).describe('Maximum results per entity type'),
  }),
  outputSchema: z.object({
    query: z.string(),
    projects: z.array(projectSchema),
    prospects: z.array(prospectSchema),
    research: z.array(researchItemSchema),
    topics: z.array(topicSchema),
  }),
  execute: async (input, context) => {
    const { query, limit } = input;
    const writer = context?.writer;

    await writer?.custom({
      type: 'data-tool-progress',
      data: { tool: 'searchKnowledge', status: 'searching', message: `Searching for "${query}"...` },
    } as any);

    const session = await getSession();

    try {
      // Search projects
      const projectsResult = await session.run(
        `
        MATCH (p:Project)
        WHERE toLower(p.title) CONTAINS toLower($query)
           OR toLower(p.description) CONTAINS toLower($query)
        RETURN p.id as id, p.title as title, p.description as description,
               p.status as status, p.processed as processed
        ORDER BY p.createdAt DESC
        LIMIT $limit
        `,
        { query, limit: toInt(limit) }
      );
      const projects = projectsResult.records.map(r => ({
        id: r.get('id'),
        title: r.get('title'),
        description: r.get('description'),
        status: r.get('status'),
        processed: r.get('processed'),
      }));

      // Search prospects
      const prospectsResult = await session.run(
        `
        MATCH (l:Prospect)
        WHERE toLower(l.name) CONTAINS toLower($query)
           OR toLower(l.company) CONTAINS toLower($query)
        OPTIONAL MATCH (l)-[:HAS_RESEARCH]->(r:ProspectResearch)
        RETURN l.id as id, l.name as name, l.company as company,
               l.title as title, l.status as status,
               r IS NOT NULL as hasResearch
        ORDER BY l.createdAt DESC
        LIMIT $limit
        `,
        { query, limit: toInt(limit) }
      );
      const prospects = prospectsResult.records.map(r => ({
        id: r.get('id'),
        name: r.get('name'),
        company: r.get('company'),
        title: r.get('title'),
        status: r.get('status'),
        hasResearch: r.get('hasResearch'),
      }));

      // Search research items
      const researchResult = await session.run(
        `
        MATCH (r:ResearchItem)
        WHERE toLower(r.title) CONTAINS toLower($query)
           OR toLower(r.content) CONTAINS toLower($query)
        RETURN r.id as id, r.title as title, r.content as content,
               r.sourceUrl as sourceUrl, r.tags as tags, r.priority as priority,
               toString(r.createdAt) as createdAt
        ORDER BY r.createdAt DESC
        LIMIT $limit
        `,
        { query, limit: toInt(limit) }
      );
      const research = researchResult.records.map(r => ({
        id: r.get('id'),
        title: r.get('title'),
        content: r.get('content'),
        sourceUrl: r.get('sourceUrl'),
        tags: r.get('tags'),
        priority: r.get('priority'),
        createdAt: r.get('createdAt'),
      }));

      // Search topics
      const topicsResult = await session.run(
        `
        MATCH (t:Topic {status: 'active'})
        WHERE toLower(t.displayName) CONTAINS toLower($query)
           OR toLower(t.description) CONTAINS toLower($query)
        OPTIONAL MATCH (r:ResearchItem)-[:COVERS_TOPIC]->(t)
        RETURN t.id as id, t.displayName as displayName, t.name as name,
               t.description as description, count(r) as researchCount
        LIMIT $limit
        `,
        { query, limit: toInt(limit) }
      );
      const topics = topicsResult.records.map(r => ({
        id: r.get('id'),
        displayName: r.get('displayName'),
        name: r.get('name'),
        description: r.get('description'),
        researchCount: r.get('researchCount').toInt(),
      }));

      await writer?.custom({
        type: 'data-tool-progress',
        data: {
          tool: 'searchKnowledge',
          status: 'complete',
          message: `Found ${projects.length} projects, ${prospects.length} prospects, ${research.length} research items, ${topics.length} topics`,
        },
      } as any);

      return { query, projects, prospects, research, topics };
    } finally {
      await session.close();
    }
  },
});

export const listProjectsTool = createTool({
  id: 'list-projects',
  description: 'List projects with optional filtering by search query or status. Returns project summaries.',
  inputSchema: z.object({
    query: z.string().optional().describe('Search term for project name/description'),
    status: z.string().optional().describe('Filter by project status'),
    limit: z.number().optional().default(10).describe('Maximum results to return'),
  }),
  outputSchema: z.object({
    projects: z.array(projectSchema),
    total: z.number(),
  }),
  execute: async (input, context) => {
    const { query, status, limit } = input;
    const writer = context?.writer;

    await writer?.custom({
      type: 'data-tool-progress',
      data: { tool: 'listProjects', status: 'searching', message: 'Fetching projects...' },
    } as any);

    const session = await getSession();

    try {
      const conditions: string[] = [];
      const params: Record<string, any> = { limit: toInt(limit) };

      if (query) {
        conditions.push(
          '(toLower(p.title) CONTAINS toLower($query) OR toLower(p.description) CONTAINS toLower($query))'
        );
        params.query = query;
      }

      if (status) {
        conditions.push('p.status = $status');
        params.status = status;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const result = await session.run(
        `
        MATCH (p:Project)
        ${whereClause}
        RETURN p.id as id, p.title as title, p.description as description,
               p.status as status, p.processed as processed
        ORDER BY p.createdAt DESC
        LIMIT $limit
        `,
        params
      );

      const projects = result.records.map(r => ({
        id: r.get('id'),
        title: r.get('title'),
        description: r.get('description'),
        status: r.get('status'),
        processed: r.get('processed'),
      }));

      await writer?.custom({
        type: 'data-tool-progress',
        data: { tool: 'listProjects', status: 'complete', message: `Found ${projects.length} projects` },
      } as any);

      return { projects, total: projects.length };
    } finally {
      await session.close();
    }
  },
});

export const getProjectTool = createTool({
  id: 'get-project',
  description: 'Get detailed information about a specific project including its entities and related research.',
  inputSchema: z.object({
    projectId: z.string().describe('The ID of the project to retrieve'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    project: projectWithContextSchema.nullable(),
  }),
  execute: async (input, context) => {
    const { projectId } = input;
    const writer = context?.writer;

    await writer?.custom({
      type: 'data-tool-progress',
      data: { tool: 'getProject', status: 'searching', message: `Loading project ${projectId}...` },
    } as any);

    const session = await getSession();

    try {
      // Get project
      const projectResult = await session.run(
        `
        MATCH (p:Project {id: $id})
        RETURN p
        `,
        { id: projectId }
      );

      if (projectResult.records.length === 0) {
        await writer?.custom({
          type: 'data-tool-progress',
          data: { tool: 'getProject', status: 'complete', message: 'Project not found' },
        } as any);
        return { found: false, project: null };
      }

      const projectNode = projectResult.records[0].get('p').properties;

      // Get entities
      const entitiesResult = await session.run(
        `
        MATCH (p:Project {id: $id})-[r]->(e)
        WHERE NOT e:Project
        RETURN labels(e)[0] as type, e.name as name, type(r) as relationship
        `,
        { id: projectId }
      );
      const entities = entitiesResult.records.map(r => ({
        type: r.get('type'),
        name: r.get('name'),
        relationship: r.get('relationship'),
      }));

      // Get related research
      const researchResult = await session.run(
        `
        MATCH (r:ResearchItem)-[:RELATES_TO_PROJECT]->(p:Project {id: $id})
        RETURN r.id as id, r.title as title, r.content as content,
               r.tags as tags, r.priority as priority
        ORDER BY r.createdAt DESC
        LIMIT 5
        `,
        { id: projectId }
      );
      const relatedResearch = researchResult.records.map(r => ({
        id: r.get('id'),
        title: r.get('title'),
        content: r.get('content'),
        tags: r.get('tags'),
        priority: r.get('priority'),
      }));

      const project = {
        id: projectNode.id,
        title: projectNode.title,
        description: projectNode.description,
        status: projectNode.status,
        processed: projectNode.processed,
        tags: projectNode.tags,
        entities,
        relatedResearch,
      };

      await writer?.custom({
        type: 'data-tool-progress',
        data: { tool: 'getProject', status: 'complete', message: `Loaded project: ${project.title}` },
      } as any);

      return { found: true, project };
    } finally {
      await session.close();
    }
  },
});

export const listProspectsTool = createTool({
  id: 'list-prospects',
  description: 'List prospects with optional filtering by search query or status. Shows research status for each prospect.',
  inputSchema: z.object({
    query: z.string().optional().describe('Search term for prospect name/company'),
    status: z.string().optional().describe('Filter by prospect status (new, contacted, replied, qualified, lost)'),
    limit: z.number().optional().default(10).describe('Maximum results to return'),
  }),
  outputSchema: z.object({
    prospects: z.array(prospectSchema),
    total: z.number(),
  }),
  execute: async (input, context) => {
    const { query, status, limit } = input;
    const writer = context?.writer;

    await writer?.custom({
      type: 'data-tool-progress',
      data: { tool: 'listProspects', status: 'searching', message: 'Fetching prospects...' },
    } as any);

    const session = await getSession();

    try {
      const conditions: string[] = [];
      const params: Record<string, any> = { limit: toInt(limit) };

      if (query) {
        conditions.push(
          '(toLower(l.name) CONTAINS toLower($query) OR toLower(l.company) CONTAINS toLower($query))'
        );
        params.query = query;
      }

      if (status) {
        conditions.push('l.status = $status');
        params.status = status;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const result = await session.run(
        `
        MATCH (l:Prospect)
        ${whereClause}
        OPTIONAL MATCH (l)-[:HAS_RESEARCH]->(r:ProspectResearch)
        RETURN l.id as id, l.name as name, l.company as company,
               l.title as title, l.status as status,
               r IS NOT NULL as hasResearch
        ORDER BY l.createdAt DESC
        LIMIT $limit
        `,
        params
      );

      const prospects = result.records.map(r => ({
        id: r.get('id'),
        name: r.get('name'),
        company: r.get('company'),
        title: r.get('title'),
        status: r.get('status'),
        hasResearch: r.get('hasResearch'),
      }));

      await writer?.custom({
        type: 'data-tool-progress',
        data: { tool: 'listProspects', status: 'complete', message: `Found ${prospects.length} prospects` },
      } as any);

      return { prospects, total: prospects.length };
    } finally {
      await session.close();
    }
  },
});

export const getProspectTool = createTool({
  id: 'get-prospect',
  description: 'Get detailed information about a specific prospect including research data, company insights, and outreach history.',
  inputSchema: z.object({
    prospectId: z.string().describe('The ID of the prospect to retrieve'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    prospect: prospectWithResearchSchema.nullable(),
  }),
  execute: async (input, context) => {
    const { prospectId } = input;
    const writer = context?.writer;

    await writer?.custom({
      type: 'data-tool-progress',
      data: { tool: 'getProspect', status: 'searching', message: `Loading prospect ${prospectId}...` },
    } as any);

    const session = await getSession();

    try {
      // Get prospect
      const prospectResult = await session.run(
        `
        MATCH (l:Prospect {id: $id})
        RETURN l
        `,
        { id: prospectId }
      );

      if (prospectResult.records.length === 0) {
        await writer?.custom({
          type: 'data-tool-progress',
          data: { tool: 'getProspect', status: 'complete', message: 'Prospect not found' },
        } as any);
        return { found: false, prospect: null };
      }

      const prospectNode = prospectResult.records[0].get('l').properties;

      // Get research
      const researchResult = await session.run(
        `
        MATCH (l:Prospect {id: $id})-[:HAS_RESEARCH]->(r:ProspectResearch)
        RETURN r.industry as industry, r.companySummary as companySummary,
               r.talkingPoints as talkingPoints, r.outreachAngle as outreachAngle
        `,
        { id: prospectId }
      );
      const researchRecord = researchResult.records[0];
      const research = researchRecord
        ? {
            industry: researchRecord.get('industry'),
            companySummary: researchRecord.get('companySummary'),
            talkingPoints: researchRecord.get('talkingPoints'),
            outreachAngle: researchRecord.get('outreachAngle'),
          }
        : null;

      // Get company insights
      const insightsResult = await session.run(
        `
        MATCH (l:Prospect {id: $id})-[:HAS_RESEARCH]->(r:ProspectResearch)-[:HAS_INSIGHT]->(i:CompanyInsight)
        RETURN i.category as category, i.content as content
        `,
        { id: prospectId }
      );
      const companyInsights = insightsResult.records.map(r => ({
        category: r.get('category'),
        content: r.get('content'),
      }));

      // Get outreach messages
      const outreachResult = await session.run(
        `
        MATCH (l:Prospect {id: $id})-[:HAS_OUTREACH]->(m:OutreachMessage)
        RETURN m.id as id, m.medium as medium, m.subject as subject,
               m.content as content, m.status as status,
               toString(m.createdAt) as createdAt
        ORDER BY m.createdAt DESC
        `,
        { id: prospectId }
      );
      const outreachMessages = outreachResult.records.map(r => ({
        id: r.get('id'),
        medium: r.get('medium'),
        subject: r.get('subject'),
        content: r.get('content'),
        status: r.get('status'),
        createdAt: r.get('createdAt'),
      }));

      const prospect = {
        id: prospectNode.id,
        name: prospectNode.name,
        company: prospectNode.company,
        title: prospectNode.title,
        email: prospectNode.email,
        linkedinUrl: prospectNode.linkedinUrl,
        status: prospectNode.status,
        research,
        companyInsights,
        outreachMessages,
      };

      await writer?.custom({
        type: 'data-tool-progress',
        data: { tool: 'getProspect', status: 'complete', message: `Loaded prospect: ${prospect.name}` },
      } as any);

      return { found: true, prospect };
    } finally {
      await session.close();
    }
  },
});

export const getResearchTool = createTool({
  id: 'get-research',
  description: 'Get recent research items, optionally filtered by topic. Useful for finding relevant research insights.',
  inputSchema: z.object({
    topic: z.string().optional().describe('Filter by topic name (matches tags or content)'),
    days: z.number().optional().default(7).describe('Look back this many days'),
    limit: z.number().optional().default(20).describe('Maximum results to return'),
  }),
  outputSchema: z.object({
    items: z.array(researchItemSchema),
    total: z.number(),
    filterTopic: z.string().nullable(),
  }),
  execute: async (input, context) => {
    const { topic, days, limit } = input;
    const writer = context?.writer;

    await writer?.custom({
      type: 'data-tool-progress',
      data: { tool: 'getResearch', status: 'searching', message: `Fetching research${topic ? ` on "${topic}"` : ''}...` },
    } as any);

    const session = await getSession();

    try {
      let result;
      if (topic) {
        result = await session.run(
          `
          MATCH (i:ResearchItem)
          WHERE i.createdAt > localdatetime() - duration({days: $days})
            AND (any(tag IN i.tags WHERE toLower(tag) CONTAINS toLower($topic))
                 OR toLower(i.content) CONTAINS toLower($topic)
                 OR toLower(i.title) CONTAINS toLower($topic))
          RETURN i.id as id, i.title as title, i.content as content,
                 i.sourceUrl as sourceUrl, i.tags as tags,
                 i.priority as priority, toString(i.createdAt) as createdAt
          ORDER BY i.createdAt DESC
          LIMIT $limit
          `,
          { topic: topic.toLowerCase(), days: toInt(days), limit: toInt(limit) }
        );
      } else {
        result = await session.run(
          `
          MATCH (i:ResearchItem)
          WHERE i.createdAt > localdatetime() - duration({days: $days})
          RETURN i.id as id, i.title as title, i.content as content,
                 i.sourceUrl as sourceUrl, i.tags as tags,
                 i.priority as priority, toString(i.createdAt) as createdAt
          ORDER BY i.createdAt DESC
          LIMIT $limit
          `,
          { days: toInt(days), limit: toInt(limit) }
        );
      }

      const items = result.records.map(r => ({
        id: r.get('id'),
        title: r.get('title'),
        content: r.get('content'),
        sourceUrl: r.get('sourceUrl'),
        tags: r.get('tags'),
        priority: r.get('priority'),
        createdAt: r.get('createdAt'),
      }));

      await writer?.custom({
        type: 'data-tool-progress',
        data: { tool: 'getResearch', status: 'complete', message: `Found ${items.length} research items` },
      } as any);

      return { items, total: items.length, filterTopic: topic || null };
    } finally {
      await session.close();
    }
  },
});

export const listTopicsTool = createTool({
  id: 'list-topics',
  description: 'List active topics with their research item counts. Helps understand what topics have been researched.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    topics: z.array(topicSchema),
    total: z.number(),
  }),
  execute: async (_input, context) => {
    const writer = context?.writer;

    await writer?.custom({
      type: 'data-tool-progress',
      data: { tool: 'listTopics', status: 'searching', message: 'Loading topics...' },
    } as any);

    const session = await getSession();

    try {
      const result = await session.run(
        `
        MATCH (t:Topic {status: 'active'})
        OPTIONAL MATCH (r:ResearchItem)-[:COVERS_TOPIC]->(t)
        RETURN t.id as id, t.displayName as displayName, t.name as name,
               t.description as description, count(r) as researchCount
        ORDER BY researchCount DESC
        `
      );

      const topics = result.records.map(r => ({
        id: r.get('id'),
        displayName: r.get('displayName'),
        name: r.get('name'),
        description: r.get('description'),
        researchCount: r.get('researchCount').toInt(),
      }));

      await writer?.custom({
        type: 'data-tool-progress',
        data: { tool: 'listTopics', status: 'complete', message: `Found ${topics.length} topics` },
      } as any);

      return { topics, total: topics.length };
    } finally {
      await session.close();
    }
  },
});

// Export all tools as a single object for easy use in agent
export const knowledgeGraphTools = {
  searchKnowledgeTool,
  listProjectsTool,
  getProjectTool,
  listProspectsTool,
  getProspectTool,
  getResearchTool,
  listTopicsTool,
};
