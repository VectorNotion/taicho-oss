/**
 * CMS MCP tools for Mastra.
 * Uses the official MCP client transport and initialization lifecycle.
 */
import { createTool } from '@mastra/core/tools';
import { structuredToolContent, withRemoteMcp } from '@content-automation/platform/integrations/mcp/client';
import { z } from 'zod';

const CMS_MCP_URL = process.env.CMS_MCP_URL || 'http://localhost:3001/api/mcp/mcp';
const CMS_MCP_API_KEY = process.env.CMS_MCP_API_KEY || '';

interface McpCallResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Call a CMS tool in a fully initialized MCP session. Tenant selection and the
 * business call share the same session, preventing cross-tenant state races.
 */
async function callMcpTool(tenantId: string, toolName: string, args: Record<string, unknown>): Promise<McpCallResult> {
  if (!CMS_MCP_API_KEY) {
    return { success: false, error: 'CMS_MCP_API_KEY not set' };
  }

  try {
    return await withRemoteMcp({
      url: CMS_MCP_URL,
      name: 'vector-notion-cms-client',
      headers: {
        'X-API-Key': CMS_MCP_API_KEY,
        Accept: 'application/json, text/event-stream',
      },
    }, async (client) => {
      const tools = await client.listTools();
      for (const required of ['cms_set_tenant', toolName]) {
        if (!tools.tools.some((tool) => tool.name === required)) {
          throw new Error(`CMS MCP server does not expose '${required}'.`);
        }
      }
      const selected = structuredToolContent(
        await client.callTool({ name: 'cms_set_tenant', arguments: { tenant_id: tenantId } }) as unknown as Parameters<typeof structuredToolContent>[0],
      );
      if (toolName === 'cms_set_tenant') return { success: selected.success !== false, ...selected };
      const called = structuredToolContent(
        await client.callTool({ name: toolName, arguments: args }) as unknown as Parameters<typeof structuredToolContent>[0],
      );
      return { success: called.success !== false, ...called };
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `MCP call failed: ${msg}` };
  }
}

/**
 * Set the active CMS tenant.
 */
export const cmsSetTenantTool = createTool({
  id: 'cms-set-tenant',
  description: 'Set the active CMS tenant before creating reports',
  inputSchema: z.object({
    tenantId: z.string().describe('The tenant ID to set as active'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    tenantId: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ tenantId }) => {
    const result = await callMcpTool(tenantId, 'cms_set_tenant', { tenant_id: tenantId });
    return {
      success: result.success,
      tenantId: result.success ? tenantId : undefined,
      error: result.error,
    };
  },
});

/**
 * Create a report page in the CMS.
 */
export const cmsCreateReportTool = createTool({
  id: 'cms-create-report',
  description: 'Create a personalized report page in the CMS. Returns the public URL.',
  inputSchema: z.object({
    title: z.string().describe('Internal admin title for the report'),
    slug: z.string().describe('URL slug (lowercase, hyphens only, e.g. "acme-corp-ai-assessment")'),
    reportTitle: z.string().describe('Main display title shown on the page'),
    hookText: z.string().describe('Description paragraph below the title'),
    recipientName: z.string().optional().describe('Personalized recipient name'),
    recipientCompany: z.string().optional().describe('Recipient company name'),
    reportBadge: z.string().optional().describe('Badge text (default: "AI Adoption Analysis")'),
    content: z.string().optional().describe('MDX content for the report body'),
    metaTitle: z.string().optional().describe('SEO meta title'),
    metaDescription: z.string().optional().describe('SEO meta description'),
    tenantId: z.string().describe('CMS tenant ID; selection is isolated to this call'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    id: z.string().optional(),
    slug: z.string().optional(),
    url: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    const result = await callMcpTool(input.tenantId, 'cms_create_report', {
      title: input.title,
      slug: input.slug,
      reportTitle: input.reportTitle,
      hookText: input.hookText,
      recipientName: input.recipientName,
      recipientCompany: input.recipientCompany,
      reportBadge: input.reportBadge,
      content: input.content,
      metaTitle: input.metaTitle,
      metaDescription: input.metaDescription,
    });

    return {
      success: result.success,
      id: result.id as string | undefined,
      slug: result.slug as string | undefined,
      url: result.url as string | undefined,
      error: result.error,
    };
  },
});

/**
 * Get a report from the CMS by ID or slug.
 */
export const cmsGetReportTool = createTool({
  id: 'cms-get-report',
  description: 'Check if a report exists by slug (useful for retry logic)',
  inputSchema: z.object({
    id: z.string().optional().describe('Report ID'),
    slug: z.string().optional().describe('Report slug'),
    tenantId: z.string().describe('CMS tenant ID; selection is isolated to this call'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    exists: z.boolean(),
    id: z.string().optional(),
    slug: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ id, slug, tenantId }) => {
    const result = await callMcpTool(tenantId, 'cms_get_report', { id, slug });
    return {
      success: result.success,
      exists: result.success && !!result.id,
      id: result.id as string | undefined,
      slug: result.slug as string | undefined,
      error: result.error,
    };
  },
});

// Export all CMS tools as an array for easy registration
export const cmsTools = {
  cmsSetTenantTool,
  cmsCreateReportTool,
  cmsGetReportTool,
};
