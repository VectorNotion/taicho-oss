import { z } from 'zod'
import { validatedTenantId } from './security'

const TenantConfigSchema = z.object({
  brandName: z.string().min(1).max(100),
  payloadTenantId: z.string().min(1).max(128).optional(),
  publicRequestSecretEnv: z.string().min(1),
  knowledgeIngestSecretEnv: z.string().min(1),
  payloadGatewayUrl: z.string().url().optional(),
  payloadGatewaySecretEnv: z.string().min(1).optional(),
  discordUrl: z.string().url().optional(),
}).strict()

export type AssistantTenantConfig = z.infer<typeof TenantConfigSchema> & { tenantId: string }

function configuredTenants(): Record<string, z.infer<typeof TenantConfigSchema>> {
  const raw = process.env.ASSISTANT_TENANTS_JSON
  if (!raw) {
    return {
      taicho: {
        brandName: 'Taicho',
        payloadTenantId: process.env.TAICHO_PAYLOAD_TENANT_ID,
        publicRequestSecretEnv: 'ASSISTANT_INTERNAL_SECRET',
        knowledgeIngestSecretEnv: 'ASSISTANT_KNOWLEDGE_SECRET',
        payloadGatewayUrl: process.env.PAYLOAD_ASSISTANT_GATEWAY_URL,
        payloadGatewaySecretEnv: 'PAYLOAD_ASSISTANT_SECRET',
        discordUrl: process.env.ASSISTANT_DISCORD_URL,
      },
      vectornotion: {
        brandName: 'VectorNotion',
        payloadTenantId: process.env.VECTORNOTION_PAYLOAD_TENANT_ID,
        publicRequestSecretEnv: 'ASSISTANT_INTERNAL_SECRET',
        knowledgeIngestSecretEnv: 'ASSISTANT_KNOWLEDGE_SECRET',
        payloadGatewayUrl: process.env.PAYLOAD_ASSISTANT_GATEWAY_URL,
        payloadGatewaySecretEnv: 'PAYLOAD_ASSISTANT_SECRET',
      },
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('ASSISTANT_TENANTS_JSON must contain valid JSON.')
  }
  return z.record(z.string(), TenantConfigSchema).parse(parsed)
}

export function loadAssistantTenantConfig(tenantId: string): AssistantTenantConfig {
  const safeTenantId = validatedTenantId(tenantId)
  const tenants = configuredTenants()
  const config = tenants[safeTenantId] ?? Object.values(tenants).find(
    (candidate) => candidate.payloadTenantId === safeTenantId,
  )
  if (!config) throw new Error('Unknown assistant tenant.')

  return { ...config, tenantId: safeTenantId }
}

function requiredSecret(environmentName: string | undefined): string {
  if (!environmentName) throw new Error('Assistant secret environment name is not configured.')
  const secret = process.env[environmentName]
  if (!secret || secret.length < 32) {
    throw new Error(`${environmentName} must contain at least 32 characters.`)
  }
  return secret
}

export function loadAssistantPublicRequestSecret(config: AssistantTenantConfig): string {
  return requiredSecret(config.publicRequestSecretEnv)
}

export function loadAssistantKnowledgeSecret(config: AssistantTenantConfig): string {
  return requiredSecret(config.knowledgeIngestSecretEnv)
}

export function loadPayloadGatewaySecret(config: AssistantTenantConfig): string | undefined {
  if (!config.payloadGatewayUrl) return undefined
  return requiredSecret(config.payloadGatewaySecretEnv)
}
