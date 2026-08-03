import assert from 'node:assert/strict'
import test from 'node:test'
import { loadAssistantTenantConfig } from '../config'

test('tenant configuration resolves the canonical Payload tenant document ID', (t) => {
  const previous = process.env.ASSISTANT_TENANTS_JSON
  process.env.ASSISTANT_TENANTS_JSON = JSON.stringify({
    vectornotion: {
      brandName: 'VectorNotion',
      payloadTenantId: 'payload-tenant-id',
      publicRequestSecretEnv: 'VECTORNOTION_ASSISTANT_SECRET',
      knowledgeIngestSecretEnv: 'VECTORNOTION_KNOWLEDGE_SECRET',
    },
  })
  t.after(() => {
    if (previous === undefined) delete process.env.ASSISTANT_TENANTS_JSON
    else process.env.ASSISTANT_TENANTS_JSON = previous
  })

  const config = loadAssistantTenantConfig('payload-tenant-id')
  assert.equal(config.tenantId, 'payload-tenant-id')
  assert.equal(config.payloadTenantId, 'payload-tenant-id')
  assert.equal(config.brandName, 'VectorNotion')
})
