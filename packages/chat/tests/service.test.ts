import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatRequest } from '../contracts'
import { StubAssistantModel, type AssistantModel } from '../model'
import { InMemoryAssistantOperations } from '../operations'
import { InMemoryAssistantRepository, type ConversationActor, type KnowledgeDocument } from '../repository'
import type { SalesKnowledgeRetriever, SupportKnowledgeRetriever } from '../qdrant'
import { AssistantService } from '../service'

const tenantId = 'taicho'

function request(surface: 'sales' | 'support', message: string, conversationId?: string): ChatRequest {
  return {
    version: '1',
    requestId: crypto.randomUUID(),
    conversationId,
    surface,
    message,
    page: surface === 'sales' ? { path: '/pricing' } : undefined,
  }
}

function actor(surface: 'sales' | 'support'): ConversationActor {
  return surface === 'sales'
    ? { tenantId, surface, subjectId: 'anonymous:1234567890abcdef' }
    : {
        tenantId,
        surface,
        subjectId: 'user:user-1',
        accountId: 'organization-1',
        userId: 'user-1',
      }
}

function document(input: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    sourceId: 'pricing#team',
    title: 'Pricing',
    url: 'https://docs.taicho.ai/pricing',
    heading: 'Team plan',
    content: 'The Team plan supports shared workspaces.',
    contentHash: 'hash-1',
    kind: 'sales_fact',
    pagePath: '/pricing',
    ...input,
  }
}

test('sales and support are isolated policy surfaces over one repository', async () => {
  const repository = new InMemoryAssistantRepository(tenantId)
  await repository.replaceKnowledge('sales_fact', [document()])
  await repository.replaceKnowledge('docs', [document({
    sourceId: 'api#prospects',
    title: 'Prospect API',
    url: 'https://docs.taicho.ai/api',
    content: 'Create prospects through the REST API or MCP tools.',
    contentHash: 'hash-2',
    kind: 'docs',
    pagePath: undefined,
  })])
  const model = new StubAssistantModel(({ system }) => (
    system.includes('public sales') ? 'The Team plan supports shared workspaces.' : 'Use the prospect API. [S1]'
  ))
  const service = new AssistantService(repository, model, new InMemoryAssistantOperations(), {
    brandName: 'Taicho',
    discordUrl: 'https://discord.gg/example',
  })

  const salesEvents = await service.chat(request('sales', 'Does the team plan support workspaces?'), actor('sales'))
  const supportEvents = await service.chat(request('support', 'How do I create a prospect?'), actor('support'))
  assert.equal(salesEvents.some(({ event }) => event === 'citation.added'), false)
  assert.equal(supportEvents.some(({ event }) => event === 'citation.added'), true)
  assert.match(model.requests[0].system, /approved facts/i)
  assert.match(model.requests[1].system, /documentation/i)
})

test('model tokens are emitted as separate assistant deltas', async () => {
  const repository = new InMemoryAssistantRepository(tenantId)
  await repository.replaceKnowledge('sales_fact', [document()])
  const model: AssistantModel = {
    async complete() {
      return 'unused'
    },
    async *stream() {
      yield 'The Team'
      await Promise.resolve()
      yield ' plan fits.'
    },
  }
  const streamed: string[] = []
  const service = new AssistantService(repository, model, null, { brandName: 'Taicho' })
  const events = await service.chat(
    request('sales', 'Tell me about Team'),
    actor('sales'),
    undefined,
    (event) => {
      if (event.event === 'assistant.delta' && typeof event.data.text === 'string') {
        streamed.push(event.data.text)
      }
    },
  )

  assert.deepEqual(streamed, ['The Team', ' plan fits.'])
  assert.deepEqual(
    events.filter(({ event }) => event === 'assistant.delta').map(({ data }) => data.text),
    streamed,
  )
})

test('sales retrieval uses the signed Payload tenant, site, and bot scope', async () => {
  const repository = new InMemoryAssistantRepository('payload-tenant-id')
  const scopes: unknown[] = []
  const salesKnowledge: SalesKnowledgeRetriever = {
    async search(scope) {
      scopes.push(scope)
      return [document({
        sourceId: 'vectornotion:services',
        title: 'VectorNotion services',
        url: 'https://vectornotion.com',
        content: 'VectorNotion builds web and AI products.',
      })]
    },
  }
  const model = new StubAssistantModel('VectorNotion builds web and AI products.')
  const service = new AssistantService(
    repository,
    model,
    null,
    { brandName: 'Fallback brand' },
    salesKnowledge,
  )
  const salesActor: ConversationActor = {
    tenantId: 'payload-tenant-id',
    surface: 'sales',
    subjectId: 'anonymous:1234567890abcdef',
  }
  const scope = {
    tenantId: 'payload-tenant-id',
    siteId: 'vectornotion',
    botId: 'payload-bot-id',
    brandName: 'VectorNotion',
    systemInstructions: 'Ask one focused question about the visitor’s product.',
  }

  await service.chat(request('sales', 'What do you build?'), salesActor, scope)

  assert.deepEqual(scopes, [scope])
  assert.match(model.requests[0].system, /public sales assistant for VectorNotion/)
  assert.match(model.requests[0].system, /Ask one focused question about the visitor’s product/)
  await assert.rejects(
    service.chat(request('sales', 'Wrong tenant'), salesActor, {
      ...scope,
      tenantId: 'another-tenant',
    }),
    /knowledge tenant mismatch/,
  )
})

test('sales prospect creation requires explicit consent and an email', async () => {
  const repository = new InMemoryAssistantRepository(tenantId)
  await repository.replaceKnowledge('sales_fact', [document()])
  const operations = new InMemoryAssistantOperations()
  const service = new AssistantService(
    repository,
    new StubAssistantModel('The Team plan supports shared workspaces.'),
    operations,
    { brandName: 'Taicho' },
  )
  const first = await service.chat(request('sales', 'My email is buyer@example.com'), actor('sales'))
  const conversationId = first[0].conversationId
  assert.equal(operations.prospects.length, 0)

  const second = await service.chat(
    request('sales', 'Yes, please contact me', conversationId),
    actor('sales'),
  )
  assert.equal(operations.prospects.length, 1)
  assert.equal(second.some(({ event, data }) => event === 'prospect.state.updated' && data.submitted === true), true)
})

test('sales does not treat an explicit contact refusal as consent', async () => {
  const repository = new InMemoryAssistantRepository(tenantId)
  await repository.replaceKnowledge('sales_fact', [document()])
  const operations = new InMemoryAssistantOperations()
  const service = new AssistantService(
    repository,
    new StubAssistantModel('Approved answer.'),
    operations,
    { brandName: 'Taicho' },
  )

  await service.chat(
    request('sales', "Do not contact me. My email is buyer@example.com"),
    actor('sales'),
  )

  assert.equal(operations.prospects.length, 0)
})

test('sales routes account support requests to the signed support URL without invoking the model', async () => {
  const repository = new InMemoryAssistantRepository(tenantId)
  const model = new StubAssistantModel('This should not be used.')
  const service = new AssistantService(repository, model, null, { brandName: 'Taicho' })
  const events = await service.chat(
    request('sales', 'I need help with an issue in my account login'),
    actor('sales'),
    {
      tenantId,
      siteId: 'taicho',
      botId: 'bot-1',
      brandName: 'Taicho',
      links: {
        support: 'https://cloud.taicho.ai/support',
        docs: 'https://docs.taicho.ai',
      },
    },
  )

  assert.equal(model.requests.length, 0)
  assert.equal(events.some(({ event, data }) => (
    event === 'assistant.delta' &&
    typeof data.text === 'string' &&
    data.text.includes('https://cloud.taicho.ai/support')
  )), true)
  assert.equal(events.some(({ event, data }) => (
    event === 'suggestions.updated' &&
    Array.isArray(data.suggestions) &&
    data.suggestions.includes('Open support')
  )), true)
})

test('support offers escalation after two evidence failures and creates one idempotent ticket', async () => {
  const repository = new InMemoryAssistantRepository(tenantId)
  const operations = new InMemoryAssistantOperations()
  const service = new AssistantService(
    repository,
    new StubAssistantModel('unused'),
    operations,
    { brandName: 'Taicho', discordUrl: 'https://discord.gg/example' },
  )
  const first = await service.chat(request('support', 'Unknown issue one'), actor('support'))
  const conversationId = first[0].conversationId
  const second = await service.chat(request('support', 'Unknown issue two', conversationId), actor('support'))
  assert.equal(second.some(({ event }) => event === 'support.escalation.offered'), true)

  const escalation = {
    version: '1' as const,
    requestId: crypto.randomUUID(),
    conversationId,
    reason: 'The documentation did not resolve this.',
    severity: 'normal' as const,
  }
  const escalationActor = {
    ...actor('support'),
    requesterName: 'A User',
    requesterEmail: 'user@example.com',
  }
  const created = await service.escalate(escalation, escalationActor)
  const replayed = await service.escalate(escalation, escalationActor)
  const tickets = await service.listTickets(actor('support'))
  assert.equal(operations.tickets.length, 1)
  assert.equal(tickets.length, 1)
  assert.equal(created.some(({ event }) => event === 'support.ticket.created'), true)
  assert.equal(replayed.some(({ data }) => data.replayed === true), true)
})

test('authenticated support receives only explicitly linked sales context', async () => {
  const repository = new InMemoryAssistantRepository(tenantId)
  await repository.replaceKnowledge('sales_fact', [document()])
  await repository.replaceKnowledge('docs', [document({
    sourceId: 'api#prospects',
    title: 'Prospect API',
    url: 'https://docs.taicho.ai/api',
    content: 'Create prospects through the REST API or MCP tools.',
    contentHash: 'hash-2',
    kind: 'docs',
    pagePath: undefined,
  })])
  const model = new StubAssistantModel('Use the prospect API. [S1]')
  const service = new AssistantService(repository, model, new InMemoryAssistantOperations(), { brandName: 'Taicho' })
  const sales = await service.chat(
    request('sales', 'Company: Acme\nUse case: create prospects through the API'),
    actor('sales'),
  )
  const anonymous = actor('sales').subjectId
  const authenticated = actor('support').subjectId
  await repository.linkIdentity(anonymous, authenticated, 'authenticated_session')
  await service.chat(request('support', 'How do I create a prospect?'), actor('support'))
  assert.match(model.requests.at(-1)?.system ?? '', /Company: Acme/)
  assert.doesNotMatch(model.requests.at(-1)?.system ?? '', /buyer@example\.com/)
  assert.ok(sales[0].conversationId)
})

test('product questions containing the verb support do not trigger human handoff', async () => {
  const repository = new InMemoryAssistantRepository(tenantId)
  await repository.replaceKnowledge('docs', [document({
    sourceId: 'api#prospects',
    title: 'Prospect API',
    url: 'https://docs.taicho.ai/api',
    content: 'The prospect API supports validated JSON payloads.',
    contentHash: 'hash-2',
    kind: 'docs',
    pagePath: undefined,
  })])
  const model = new StubAssistantModel('The prospect API supports JSON payloads. [S1]')
  const service = new AssistantService(repository, model, null, { brandName: 'Taicho' })
  const events = await service.chat(
    request('support', 'Does the prospect API support JSON?'),
    actor('support'),
  )
  assert.equal(events.some(({ event }) => event === 'support.escalation.offered'), false)
  assert.equal(model.requests.length, 1)
})

test('support fuses semantic and lexical documentation without crossing the tenant', async () => {
  const repository = new InMemoryAssistantRepository(tenantId)
  await repository.replaceKnowledge('docs', [
    document({
      sourceId: 'api#lexical',
      title: 'Prospect API troubleshooting',
      url: 'https://docs.taicho.ai/api',
      content: 'Resolve a prospect payload validation error.',
      contentHash: 'hash-lexical',
      kind: 'docs',
      pagePath: undefined,
    }),
  ])
  const semanticScopes: string[] = []
  const semanticKnowledge: SupportKnowledgeRetriever = {
    async search(scopeTenantId) {
      semanticScopes.push(scopeTenantId)
      return [
        document({
          sourceId: 'api#semantic',
          title: 'Prospect fields',
          url: 'https://docs.taicho.ai/api/prospects',
          content: 'Send supported prospect fields in the request body.',
          contentHash: 'hash-semantic',
          kind: 'docs',
          pagePath: undefined,
        }),
      ]
    },
  }
  const model = new StubAssistantModel('Check the validation error and supported fields. [S1] [S2]')
  const service = new AssistantService(
    repository,
    model,
    null,
    { brandName: 'Taicho' },
    undefined,
    semanticKnowledge,
  )

  const events = await service.chat(
    request('support', 'How do I resolve a prospect payload validation error?'),
    actor('support'),
  )

  assert.deepEqual(semanticScopes, [tenantId])
  assert.match(model.requests[0].system, /Prospect fields/)
  assert.match(model.requests[0].system, /Prospect API troubleshooting/)
  assert.equal(events.filter(({ event }) => event === 'citation.added').length, 2)
  assert.equal(events.some(({ event, data }) => (
    event === 'activity.updated' &&
    data.lexicalMatches === 1 &&
    data.semanticMatches === 1 &&
    data.selectedSources === 2
  )), true)
})

test('support classifies urgent incidents and account issues deterministically', async () => {
  const repository = new InMemoryAssistantRepository(tenantId)
  const service = new AssistantService(
    repository,
    new StubAssistantModel('unused'),
    null,
    { brandName: 'Taicho' },
  )

  const urgent = await service.chat(
    request('support', 'Our credentials were exposed in a security breach'),
    actor('support'),
  )
  assert.equal(urgent.some(({ event, data }) => (
    event === 'support.escalation.offered' &&
    data.reason === 'security' &&
    data.severity === 'urgent'
  )), true)

  await repository.replaceKnowledge('docs', [document({
    sourceId: 'billing#invoice',
    title: 'Invoices',
    url: 'https://docs.taicho.ai/billing',
    content: 'Invoices can be downloaded from billing settings.',
    contentHash: 'hash-billing',
    kind: 'docs',
    pagePath: undefined,
  })])
  const accountIssue = await service.chat(
    request('support', 'Where can I download my billing invoice?'),
    actor('support'),
  )
  assert.equal(accountIssue.some(({ event, data }) => (
    event === 'support.escalation.offered' &&
    data.reason === 'account_or_billing' &&
    data.severity === 'high'
  )), true)
})

test('support feedback is idempotent, escalates after two unhelpful ratings, and helpful feedback resets it', async () => {
  const repository = new InMemoryAssistantRepository(tenantId)
  const service = new AssistantService(
    repository,
    new StubAssistantModel('unused'),
    null,
    { brandName: 'Taicho' },
  )
  const chat = await service.chat(request('support', 'Unknown issue'), actor('support'))
  const conversationId = chat[0].conversationId
  const firstRequest = {
    version: '1' as const,
    requestId: crypto.randomUUID(),
    conversationId,
    helpful: false,
  }
  const first = await service.feedback(firstRequest, actor('support'))
  const replayed = await service.feedback(firstRequest, actor('support'))
  const second = await service.feedback({
    ...firstRequest,
    requestId: crypto.randomUUID(),
  }, actor('support'))
  const reset = await service.feedback({
    ...firstRequest,
    requestId: crypto.randomUUID(),
    helpful: true,
  }, actor('support'))

  assert.equal(first.some(({ event }) => event === 'support.escalation.offered'), false)
  assert.equal(replayed.some(({ event, data }) => event === 'assistant.completed' && data.replayed === true), true)
  assert.equal(second.some(({ event, data }) => (
    event === 'support.escalation.offered' && data.unhelpfulRatings === 2
  )), true)
  assert.equal(reset.some(({ event, data }) => (
    event === 'support.feedback.recorded' && data.helpful === true && data.unhelpfulRatings === 0
  )), true)
})

test('conversation history is restored only for the owning actor and surface', async () => {
  const repository = new InMemoryAssistantRepository(tenantId)
  await repository.replaceKnowledge('sales_fact', [document()])
  const service = new AssistantService(
    repository,
    new StubAssistantModel('The Team plan supports shared workspaces.'),
    null,
    { brandName: 'Taicho' },
  )
  const salesActor = actor('sales')
  const events = await service.chat(request('sales', 'Tell me about Team'), salesActor)
  const conversationId = events[0].conversationId
  const history = await service.history(conversationId, salesActor)

  assert.equal(history.surface, 'sales')
  assert.deepEqual(history.messages.map(({ role }) => role), ['user', 'assistant'])
  assert.deepEqual(history.prospectState, { consent: false })
  await assert.rejects(
    service.history(conversationId, { ...salesActor, subjectId: 'anonymous:different-user' }),
    /Conversation not found/,
  )
  await assert.rejects(
    service.history(conversationId, actor('support')),
    /Conversation not found/,
  )
})

test('public sales conversations are bound to their signed site and bot', async () => {
  const repository = new InMemoryAssistantRepository(tenantId)
  await repository.replaceKnowledge('sales_fact', [document()])
  const service = new AssistantService(
    repository,
    new StubAssistantModel('Approved answer.'),
    null,
    { brandName: 'Taicho' },
  )
  const scopedActor: ConversationActor = {
    ...actor('sales'),
    siteId: 'taicho',
    botId: 'taicho-bot',
  }
  const events = await service.chat(request('sales', 'Tell me about Team'), scopedActor)
  const conversationId = events[0].conversationId

  await assert.rejects(
    service.history(conversationId, {
      ...scopedActor,
      siteId: 'another-site',
      botId: 'another-bot',
    }),
    /Conversation not found/,
  )
})
