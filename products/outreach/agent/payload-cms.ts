import { structuredToolContent, withRemoteMcp } from "@content-automation/platform/integrations/mcp/client";

const CMS_MCP_URL = process.env.CMS_MCP_URL || "http://localhost:3001/api/mcp/mcp";
const CMS_MCP_API_KEY = process.env.CMS_MCP_API_KEY || "";

/** Delete a report through the negotiated MCP session; no REST side channel. */
export async function deleteReport(reportId: string, tenantId = process.env.CMS_TENANT_ID): Promise<boolean> {
  if (!CMS_MCP_API_KEY) throw new Error("CMS_MCP_API_KEY environment variable must be set");
  if (!tenantId) throw new Error("CMS_TENANT_ID is required to delete a report safely");

  return withRemoteMcp({
    url: CMS_MCP_URL,
    name: "vector-notion-cms-client",
    headers: {
      "X-API-Key": CMS_MCP_API_KEY,
      "X-CMS-Tenant-ID": tenantId,
      Accept: "application/json, text/event-stream",
    },
  }, async (client) => {
    const tools = await client.listTools();
    for (const required of ["cms_set_tenant", "cms_delete_report"]) {
      if (!tools.tools.some((tool) => tool.name === required)) throw new Error(`CMS MCP server does not expose '${required}'.`);
    }
    structuredToolContent(
      await client.callTool({ name: "cms_set_tenant", arguments: { tenant_id: tenantId } }) as unknown as Parameters<typeof structuredToolContent>[0],
    );
    const result = structuredToolContent(
      await client.callTool({ name: "cms_delete_report", arguments: { id: reportId } }) as unknown as Parameters<typeof structuredToolContent>[0],
    );
    return result.deleted !== false;
  });
}
