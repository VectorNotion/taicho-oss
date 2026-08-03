# Product documentation screenshots

These images are generated from the real unified application with the
deterministic local owner account. Start the unified app with a canonical MCP
resource URL, then run:

```bash
SCREENSHOT_MCP_RESOURCE_URL=https://cloud.taicho.ai/api/mcp \
  node scripts/capture-mcp-doc-screenshots.mjs
```

The capture script hides workspace-authored agent identity fields, creates a
temporary OAuth client for the consent image, and removes that client after the
capture completes.
