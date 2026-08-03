import path from 'node:path'
import { buildDocsCorpus } from '../docs-export'
import {
  loadAssistantKnowledgeSecret,
  loadAssistantTenantConfig,
} from '../config'
import { signInternalRequest } from '../security'

const tenantId = process.env.ASSISTANT_KNOWLEDGE_TENANT_ID
  ?? process.env.ASSISTANT_SUPPORT_TENANT_ID
  ?? 'taicho'
const contentDirectory = path.resolve(
  process.env.ASSISTANT_DOCS_CONTENT_DIR ?? path.join(process.cwd(), '../../docs/content'),
)
const publicBaseUrl = process.env.ASSISTANT_DOCS_PUBLIC_URL ?? 'https://docs.taicho.ai'
const assistantBaseUrl = process.env.ASSISTANT_PUBLIC_URL ?? 'http://localhost:3000'
const ingestUrl = process.env.ASSISTANT_KNOWLEDGE_URL
  ?? new URL('/api/internal/assistants/knowledge', assistantBaseUrl).toString()

const documents = await buildDocsCorpus(contentDirectory, publicBaseUrl)
if (process.argv.includes('--dry-run')) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    dryRun: true,
    tenantId,
    contentDirectory,
    documentCount: documents.length,
  }, null, 2)}\n`)
  process.exit(0)
}

const body = JSON.stringify({
  version: '1',
  kind: 'docs',
  documents,
})
const config = loadAssistantTenantConfig(tenantId)
const signed = signInternalRequest(loadAssistantKnowledgeSecret(config), body)
const response = await fetch(ingestUrl, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-assistant-tenant': tenantId,
    'x-assistant-request-id': signed.requestId,
    'x-assistant-timestamp': signed.timestamp,
    'x-assistant-signature': signed.signature,
  },
  body,
  signal: AbortSignal.timeout(120_000),
})
if (!response.ok) {
  await response.body?.cancel()
  throw new Error(`Assistant documentation ingestion failed (${response.status}).`)
}
const result = await response.json()
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
