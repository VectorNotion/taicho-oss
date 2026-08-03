import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  getProjectProof,
  listProjectProofs,
} from '@content-automation/content-generator/public/project-proof';

const projectSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  status: z.string().nullish(),
  processed: z.boolean().nullish(),
});

export const listProjectsTool = createTool({
  id: 'list-projects',
  description: 'List verified projects that may be referenced as proof in outreach.',
  inputSchema: z.object({
    query: z.string().optional(),
    limit: z.number().int().positive().max(50).optional().default(10),
  }),
  outputSchema: z.object({
    projects: z.array(projectSchema),
    total: z.number(),
  }),
  execute: async ({ query, limit }) => {
    const projects = await listProjectProofs(query, limit);
    return { projects, total: projects.length };
  },
});

export const getProjectTool = createTool({
  id: 'get-project',
  description: 'Get verified details for one project before referencing it in outreach.',
  inputSchema: z.object({ projectId: z.string() }),
  outputSchema: z.object({
    found: z.boolean(),
    project: projectSchema.extend({
      tags: z.array(z.string()),
      entities: z.array(z.object({
        type: z.string(),
        name: z.string(),
        relationship: z.string(),
      })),
    }).nullable(),
  }),
  execute: async ({ projectId }) => {
    const project = await getProjectProof(projectId);
    return { found: project !== null, project };
  },
});
