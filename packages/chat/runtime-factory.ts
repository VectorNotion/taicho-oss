import { getAssistantPool } from './data/pool'
import { loadAssistantTenantConfig, loadPayloadGatewaySecret } from './config'
import { OpenRouterAssistantModel, StubAssistantModel } from './model'
import { PayloadAssistantOperations } from './operations'
import {
  QdrantSalesKnowledgeRetriever,
  QdrantSupportKnowledgeStore,
  qdrantSalesKnowledgeConfigFromEnvironment,
} from './qdrant'
import { PostgresAssistantRepository } from './repository'
import { AssistantService } from './service'

export function supportAssistantTenantId(): string {
  return process.env.ASSISTANT_SUPPORT_TENANT_ID ?? 'taicho'
}

export function createAssistantRuntime(
  tenantId: string,
  options: { salesKnowledge?: boolean } = {},
) {
  const config = loadAssistantTenantConfig(tenantId)
  const repository = new PostgresAssistantRepository(getAssistantPool(tenantId), tenantId)
  const payloadSecret = loadPayloadGatewaySecret(config)
  const operations = config.payloadGatewayUrl && payloadSecret
    ? new PayloadAssistantOperations(config.payloadGatewayUrl, payloadSecret)
    : null
  const model = process.env.NODE_ENV !== 'production' && process.env.ASSISTANT_MODEL_MODE === 'stub'
    ? new StubAssistantModel(({ system }) => (
        system.includes('public sales assistant')
          ? 'Based on the approved product information, that option is available. I can help you compare the plans.'
          : 'Follow the documented steps shown in the cited source. [S1]'
      ))
    : new OpenRouterAssistantModel()
  const qdrantConfig = qdrantSalesKnowledgeConfigFromEnvironment()
  if (
    !qdrantConfig &&
    (
      process.env.NODE_ENV === 'production' ||
      (options.salesKnowledge && process.env.ASSISTANT_KNOWLEDGE_BACKEND === 'qdrant')
    )
  ) {
    throw new Error('The assistant requires Qdrant knowledge configuration.')
  }
  const salesKnowledge = options.salesKnowledge && qdrantConfig
    ? new QdrantSalesKnowledgeRetriever(qdrantConfig)
    : undefined
  const supportKnowledgeStore = qdrantConfig
    ? new QdrantSupportKnowledgeStore(qdrantConfig)
    : undefined
  const service = new AssistantService(
    repository,
    model,
    operations,
    {
      brandName: config.brandName,
      discordUrl: config.discordUrl,
      maxHistoryMessages: 16,
    },
    salesKnowledge,
    supportKnowledgeStore,
  )
  return { config, repository, service, supportKnowledgeStore }
}
