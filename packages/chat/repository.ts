import type { Pool } from 'pg'
import {
  conversationsInAssistant as conversationsTable,
  databaseFor,
  documentsInAssistant as documentsTable,
  idempotency_keysInAssistant as idempotencyKeysTable,
  identity_linksInAssistant as identityLinksTable,
  messagesInAssistant as messagesTable,
  rate_limit_bucketsInAssistant as rateLimitBucketsTable,
  request_receiptsInAssistant as requestReceiptsTable,
} from '@content-automation/database'
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
} from 'drizzle-orm'
import type { ChatSurface, Citation, LeadState } from './contracts'

export type ConversationActor = {
  tenantId: string
  surface: ChatSurface
  subjectId: string
  accountId?: string
  userId?: string
  siteId?: string
  botId?: string
}

export type ConversationRecord = ConversationActor & {
  id: string
  status: 'open' | 'escalated' | 'resolved' | 'closed'
  leadState: LeadState
  failedAnswerCount: number
  metadata: Record<string, unknown>
}

export type StoredMessage = {
  id: string
  conversationId: string
  requestId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  citations: Citation[]
  metadata: Record<string, unknown>
  createdAt: string
}

export type KnowledgeDocument = Citation & {
  content: string
  contentHash: string
  kind: 'docs' | 'sales_fact'
  pagePath?: string
  rank?: number
  metadata?: Record<string, unknown>
}

export type ConversationSummary = {
  conversationId: string
  leadState: LeadState
  summary?: string
  updatedAt: string
}

export interface AssistantRepository {
  ensureConversation(actor: ConversationActor, conversationId?: string): Promise<ConversationRecord>
  findMessage(conversationId: string, requestId: string, role: StoredMessage['role']): Promise<StoredMessage | null>
  appendMessage(input: Omit<StoredMessage, 'id' | 'createdAt'>): Promise<StoredMessage>
  listMessages(conversationId: string, limit?: number): Promise<StoredMessage[]>
  updateLeadState(conversationId: string, leadState: LeadState, metadata?: Record<string, unknown>): Promise<void>
  incrementFailedAnswers(conversationId: string): Promise<number>
  resetFailedAnswers(conversationId: string): Promise<void>
  recordSupportFeedback(
    conversationId: string,
    input: { helpful: boolean; note?: string; createdAt: string },
  ): Promise<number>
  markEscalated(conversationId: string, ticket: Record<string, unknown>): Promise<void>
  searchKnowledge(query: string, kind: KnowledgeDocument['kind'], limit?: number, pagePath?: string): Promise<KnowledgeDocument[]>
  replaceKnowledge(kind: KnowledgeDocument['kind'], documents: KnowledgeDocument[]): Promise<void>
  linkIdentity(sourceSubjectId: string, targetSubjectId: string, verifiedBy: 'authenticated_session' | 'verified_email'): Promise<void>
  salesContextFor(targetSubjectId: string, limit?: number): Promise<ConversationSummary[]>
  getIdempotentResult<T>(key: string, operation: string): Promise<T | null>
  saveIdempotentResult(key: string, operation: string, result: unknown, expiresAt: Date): Promise<void>
  consumeRequestReceipt(
    purpose: 'sales' | 'knowledge',
    requestId: string,
    ttlSeconds?: number,
  ): Promise<boolean>
  consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<{
    allowed: boolean
    remaining: number
    retryAfterSeconds: number
  }>
}

type ConversationRow = {
  id: string
  tenant_id: string
  surface: ChatSurface
  subject_id: string
  account_id: string | null
  user_id: string | null
  status: ConversationRecord['status']
  lead_state: LeadState
  failed_answer_count: number
  metadata: Record<string, unknown>
}

type MessageRow = {
  id: string
  conversation_id: string
  request_id: string
  role: StoredMessage['role']
  content: string
  citations: Citation[]
  metadata: Record<string, unknown>
  created_at: string
}

function conversationFromRow(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    surface: row.surface,
    subjectId: row.subject_id,
    accountId: row.account_id ?? undefined,
    userId: row.user_id ?? undefined,
    siteId: typeof row.metadata.siteId === 'string' ? row.metadata.siteId : undefined,
    botId: typeof row.metadata.botId === 'string' ? row.metadata.botId : undefined,
    status: row.status,
    leadState: row.lead_state,
    failedAnswerCount: row.failed_answer_count,
    metadata: row.metadata,
  }
}

function messageFromRow(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    requestId: row.request_id,
    role: row.role,
    content: row.content,
    citations: row.citations,
    metadata: row.metadata,
    createdAt: row.created_at,
  }
}

const SEARCH_STOP_WORDS = new Set([
  'about',
  'are',
  'can',
  'could',
  'does',
  'for',
  'from',
  'have',
  'how',
  'much',
  'should',
  'that',
  'the',
  'this',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
  'you',
  'your',
])

function searchExpression(value: string): string {
  return [...new Set(
    value
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((term) => term.length >= 2 && !SEARCH_STOP_WORDS.has(term))
      ?? [],
  )]
    .slice(0, 20)
    .map((term) => `${term}:*`)
    .join(' | ')
}

export class PostgresAssistantRepository implements AssistantRepository {
  private readonly db

  constructor(
    private readonly pool: Pool,
    private readonly tenantId: string,
  ) {
    this.db = databaseFor(pool)
  }

  async ensureConversation(actor: ConversationActor, conversationId?: string): Promise<ConversationRecord> {
    if (actor.tenantId !== this.tenantId) throw new Error('Assistant repository tenant mismatch.')

    if (conversationId) {
      const [row] = await this.db
        .select()
        .from(conversationsTable)
        .where(and(
          eq(conversationsTable.tenant_id, this.tenantId),
          eq(conversationsTable.id, conversationId),
          eq(conversationsTable.surface, actor.surface),
          eq(conversationsTable.subject_id, actor.subjectId),
          actor.accountId
            ? eq(conversationsTable.account_id, actor.accountId)
            : isNull(conversationsTable.account_id),
          actor.userId
            ? eq(conversationsTable.user_id, actor.userId)
            : isNull(conversationsTable.user_id),
          actor.siteId ? sql`${conversationsTable.metadata}->>'siteId' = ${actor.siteId}` : undefined,
          actor.botId ? sql`${conversationsTable.metadata}->>'botId' = ${actor.botId}` : undefined,
        ))
        .limit(1)
      if (!row) throw new Error('Conversation not found.')
      return conversationFromRow(row as ConversationRow)
    }

    const [row] = await this.db
      .insert(conversationsTable)
      .values({
        tenant_id: this.tenantId,
        surface: actor.surface,
        subject_id: actor.subjectId,
        account_id: actor.accountId ?? null,
        user_id: actor.userId ?? null,
        metadata: {
          ...(actor.siteId ? { siteId: actor.siteId } : {}),
          ...(actor.botId ? { botId: actor.botId } : {}),
        },
      })
      .returning()
    return conversationFromRow(row as ConversationRow)
  }

  async findMessage(conversationId: string, requestId: string, role: StoredMessage['role']): Promise<StoredMessage | null> {
    const [row] = await this.db
      .select()
      .from(messagesTable)
      .where(and(
        eq(messagesTable.tenant_id, this.tenantId),
        eq(messagesTable.conversation_id, conversationId),
        eq(messagesTable.request_id, requestId),
        eq(messagesTable.role, role),
      ))
      .limit(1)
    return row ? messageFromRow(row as MessageRow) : null
  }

  async appendMessage(input: Omit<StoredMessage, 'id' | 'createdAt'>): Promise<StoredMessage> {
    const [row] = await this.db
      .insert(messagesTable)
      .values({
        tenant_id: this.tenantId,
        conversation_id: input.conversationId,
        request_id: input.requestId,
        role: input.role,
        content: input.content,
        citations: input.citations,
        metadata: input.metadata,
      })
      .onConflictDoUpdate({
        target: [
          messagesTable.tenant_id,
          messagesTable.conversation_id,
          messagesTable.request_id,
          messagesTable.role,
        ],
        set: { content: sql`${messagesTable.content}` },
      })
      .returning()
    return messageFromRow(row as MessageRow)
  }

  async listMessages(conversationId: string, limit = 20): Promise<StoredMessage[]> {
    const recent = this.db
      .select()
      .from(messagesTable)
      .where(and(
        eq(messagesTable.tenant_id, this.tenantId),
        eq(messagesTable.conversation_id, conversationId),
        inArray(messagesTable.role, ['user', 'assistant']),
      ))
      .orderBy(desc(messagesTable.created_at))
      .limit(Math.max(1, Math.min(limit, 50)))
      .as('recent_messages')
    const rows = await this.db.select().from(recent).orderBy(asc(recent.created_at))
    return rows.map((row) => messageFromRow(row as MessageRow))
  }

  async updateLeadState(conversationId: string, leadState: LeadState, metadata: Record<string, unknown> = {}): Promise<void> {
    await this.db
      .update(conversationsTable)
      .set({
        lead_state: leadState,
        metadata: sql`${conversationsTable.metadata} || ${metadata}`,
        updated_at: new Date().toISOString(),
      })
      .where(and(
        eq(conversationsTable.tenant_id, this.tenantId),
        eq(conversationsTable.id, conversationId),
        eq(conversationsTable.surface, 'sales'),
      ))
  }

  async incrementFailedAnswers(conversationId: string): Promise<number> {
    const [row] = await this.db
      .update(conversationsTable)
      .set({
        failed_answer_count: sql`${conversationsTable.failed_answer_count} + 1`,
        updated_at: new Date().toISOString(),
      })
      .where(and(
        eq(conversationsTable.tenant_id, this.tenantId),
        eq(conversationsTable.id, conversationId),
      ))
      .returning({ count: conversationsTable.failed_answer_count })
    return row?.count ?? 0
  }

  async resetFailedAnswers(conversationId: string): Promise<void> {
    await this.db
      .update(conversationsTable)
      .set({ failed_answer_count: 0, updated_at: new Date().toISOString() })
      .where(and(
        eq(conversationsTable.tenant_id, this.tenantId),
        eq(conversationsTable.id, conversationId),
        eq(conversationsTable.surface, 'support'),
      ))
  }

  async recordSupportFeedback(
    conversationId: string,
    input: { helpful: boolean; note?: string; createdAt: string },
  ): Promise<number> {
    const increment = input.helpful
      ? sql<number>`0`
      : sql<number>`coalesce((${conversationsTable.metadata}->>'unhelpfulFeedbackCount')::integer, 0) + 1`
    const [row] = await this.db
      .update(conversationsTable)
      .set({
        metadata: sql`${conversationsTable.metadata} || jsonb_build_object(
          'lastSupportFeedback', ${JSON.stringify(input)}::jsonb,
          'unhelpfulFeedbackCount', ${increment}
        )`,
        updated_at: new Date().toISOString(),
      })
      .where(and(
        eq(conversationsTable.tenant_id, this.tenantId),
        eq(conversationsTable.id, conversationId),
        eq(conversationsTable.surface, 'support'),
      ))
      .returning({
        count: sql<number>`coalesce((${conversationsTable.metadata}->>'unhelpfulFeedbackCount')::integer, 0)`,
      })
    if (!row) throw new Error('Conversation not found.')
    return row.count
  }

  async markEscalated(conversationId: string, ticket: Record<string, unknown>): Promise<void> {
    await this.db
      .update(conversationsTable)
      .set({
        status: 'escalated',
        metadata: sql`${conversationsTable.metadata} || jsonb_build_object('ticket', ${JSON.stringify(ticket)}::jsonb)`,
        updated_at: new Date().toISOString(),
      })
      .where(and(
        eq(conversationsTable.tenant_id, this.tenantId),
        eq(conversationsTable.id, conversationId),
        eq(conversationsTable.surface, 'support'),
      ))
  }

  async searchKnowledge(
    query: string,
    kind: KnowledgeDocument['kind'],
    limit = 5,
    pagePath?: string,
  ): Promise<KnowledgeDocument[]> {
    const expression = searchExpression(query)
    const rank = sql<number>`ts_rank_cd(
      ${documentsTable.search_vector},
      to_tsquery('english', ${expression})
    )`
    const pageFilter = pagePath
      ? or(
          sql`${documentsTable.metadata}->>'pagePath' = ${pagePath}`,
          sql`${documentsTable.metadata}->>'pagePath' IS NULL`,
        )
      : undefined
    const matchFilter = expression
      ? sql`${documentsTable.search_vector} @@ to_tsquery('english', ${expression})`
      : pagePath
        ? sql`true`
        : sql`false`
    const rows = await this.db
      .select({
        sourceId: documentsTable.source_id,
        title: documentsTable.title,
        url: documentsTable.url,
        heading: documentsTable.heading,
        content: documentsTable.content,
        contentHash: documentsTable.content_hash,
        metadata: documentsTable.metadata,
        rank,
      })
      .from(documentsTable)
      .where(and(
        eq(documentsTable.tenant_id, this.tenantId),
        sql`${documentsTable.metadata}->>'kind' = ${kind}`,
        pageFilter,
        matchFilter,
      ))
      .orderBy(
        pagePath
          ? sql`CASE WHEN ${documentsTable.metadata}->>'pagePath' = ${pagePath} THEN 0 ELSE 1 END`
          : sql`1`,
        desc(rank),
        desc(documentsTable.updated_at),
      )
      .limit(Math.max(1, Math.min(limit, 10)))
    return rows.map((row) => ({
      sourceId: row.sourceId,
      title: row.title,
      url: row.url,
      heading: row.heading ?? undefined,
      content: row.content,
      contentHash: row.contentHash,
      kind,
      pagePath: typeof (row.metadata as Record<string, unknown>).pagePath === 'string'
        ? (row.metadata as Record<string, unknown>).pagePath as string
        : undefined,
      rank: Number(row.rank),
      metadata: row.metadata as Record<string, unknown>,
    }))
  }

  async replaceKnowledge(kind: KnowledgeDocument['kind'], documents: KnowledgeDocument[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const sourceIds: string[] = []
      for (const document of documents) {
        sourceIds.push(document.sourceId)
        const metadata = { ...document.metadata, kind, pagePath: document.pagePath }
        await tx
          .insert(documentsTable)
          .values({
            tenant_id: this.tenantId,
            source_id: document.sourceId,
            url: document.url,
            title: document.title,
            heading: document.heading ?? null,
            content: document.content,
            content_hash: document.contentHash,
            metadata,
          })
          .onConflictDoUpdate({
            target: [documentsTable.tenant_id, documentsTable.source_id],
            set: {
              url: document.url,
              title: document.title,
              heading: document.heading ?? null,
              content: document.content,
              content_hash: document.contentHash,
              metadata,
              updated_at: new Date().toISOString(),
            },
          })
      }
      const filters = [
        eq(documentsTable.tenant_id, this.tenantId),
        sql`${documentsTable.metadata}->>'kind' = ${kind}`,
      ]
      if (sourceIds.length > 0) filters.push(notInArray(documentsTable.source_id, sourceIds))
      await tx.delete(documentsTable).where(and(...filters))
    })
  }

  async linkIdentity(
    sourceSubjectId: string,
    targetSubjectId: string,
    verifiedBy: 'authenticated_session' | 'verified_email',
  ): Promise<void> {
    await this.db
      .insert(identityLinksTable)
      .values({
        tenant_id: this.tenantId,
        source_subject_id: sourceSubjectId,
        target_subject_id: targetSubjectId,
        verified_by: verifiedBy,
      })
      .onConflictDoNothing()
  }

  async salesContextFor(targetSubjectId: string, limit = 3): Promise<ConversationSummary[]> {
    const linkedSubjects = this.db
      .select({ sourceSubjectId: identityLinksTable.source_subject_id })
      .from(identityLinksTable)
      .where(and(
        eq(identityLinksTable.tenant_id, this.tenantId),
        eq(identityLinksTable.target_subject_id, targetSubjectId),
      ))
    const rows = await this.db
      .select({
        id: conversationsTable.id,
        leadState: conversationsTable.lead_state,
        summary: sql<string | null>`${conversationsTable.metadata}->>'salesSummary'`,
        updatedAt: conversationsTable.updated_at,
      })
      .from(conversationsTable)
      .where(and(
        eq(conversationsTable.tenant_id, this.tenantId),
        eq(conversationsTable.surface, 'sales'),
        or(
          eq(conversationsTable.subject_id, targetSubjectId),
          inArray(conversationsTable.subject_id, linkedSubjects),
        ),
      ))
      .orderBy(desc(conversationsTable.updated_at))
      .limit(Math.max(1, Math.min(limit, 10)))
    return rows.map((row) => ({
      conversationId: row.id,
      leadState: row.leadState as LeadState,
      summary: row.summary ?? undefined,
      updatedAt: row.updatedAt,
    }))
  }

  async getIdempotentResult<T>(key: string, operation: string): Promise<T | null> {
    const [row] = await this.db
      .select({ result: idempotencyKeysTable.result })
      .from(idempotencyKeysTable)
      .where(and(
        eq(idempotencyKeysTable.tenant_id, this.tenantId),
        eq(idempotencyKeysTable.key, key),
        eq(idempotencyKeysTable.operation, operation),
        gt(idempotencyKeysTable.expires_at, new Date().toISOString()),
      ))
      .limit(1)
    return (row?.result as T | undefined) ?? null
  }

  async saveIdempotentResult(key: string, operation: string, result: unknown, expiresAt: Date): Promise<void> {
    await this.db
      .insert(idempotencyKeysTable)
      .values({
        tenant_id: this.tenantId,
        key,
        operation,
        result,
        expires_at: expiresAt.toISOString(),
      })
      .onConflictDoNothing()
  }

  async consumeRequestReceipt(
    purpose: 'sales' | 'knowledge',
    requestId: string,
    ttlSeconds = 24 * 60 * 60,
  ): Promise<boolean> {
    const lifetime = Math.max(300, Math.min(ttlSeconds, 30 * 24 * 60 * 60))
    const now = new Date()
    const nowIso = now.toISOString()
    const expiresAt = new Date(now.getTime() + lifetime * 1_000).toISOString()
    const [row] = await this.db
      .insert(requestReceiptsTable)
      .values({
        tenant_id: this.tenantId,
        purpose,
        request_id: requestId,
        received_at: nowIso,
        expires_at: expiresAt,
      })
      .onConflictDoUpdate({
        target: [
          requestReceiptsTable.tenant_id,
          requestReceiptsTable.purpose,
          requestReceiptsTable.request_id,
        ],
        set: {
          received_at: sql`CASE
            WHEN ${requestReceiptsTable.expires_at} <= ${nowIso} THEN ${nowIso}
            ELSE ${requestReceiptsTable.received_at}
          END`,
          expires_at: sql`CASE
            WHEN ${requestReceiptsTable.expires_at} <= ${nowIso} THEN ${expiresAt}
            ELSE ${requestReceiptsTable.expires_at}
          END`,
        },
      })
      .returning({ receivedAt: requestReceiptsTable.received_at })
    return new Date(row.receivedAt).getTime() === now.getTime()
  }

  async consumeRateLimit(key: string, limit: number, windowSeconds: number) {
    const now = new Date()
    const nowIso = now.toISOString()
    const expiresAt = new Date(now.getTime() + windowSeconds * 1_000).toISOString()
    const [row] = await this.db
      .insert(rateLimitBucketsTable)
      .values({
        tenant_id: this.tenantId,
        key,
        hits: 1,
        window_started_at: nowIso,
        expires_at: expiresAt,
      })
      .onConflictDoUpdate({
        target: [rateLimitBucketsTable.tenant_id, rateLimitBucketsTable.key],
        set: {
          hits: sql`CASE
            WHEN ${rateLimitBucketsTable.expires_at} <= ${nowIso} THEN 1
            ELSE ${rateLimitBucketsTable.hits} + 1
          END`,
          window_started_at: sql`CASE
            WHEN ${rateLimitBucketsTable.expires_at} <= ${nowIso} THEN ${nowIso}
            ELSE ${rateLimitBucketsTable.window_started_at}
          END`,
          expires_at: sql`CASE
            WHEN ${rateLimitBucketsTable.expires_at} <= ${nowIso} THEN ${expiresAt}
            ELSE ${rateLimitBucketsTable.expires_at}
          END`,
        },
      })
      .returning({ hits: rateLimitBucketsTable.hits, expiresAt: rateLimitBucketsTable.expires_at })
    return {
      allowed: row.hits <= limit,
      remaining: Math.max(0, limit - row.hits),
      retryAfterSeconds: Math.max(1, Math.ceil((new Date(row.expiresAt).getTime() - Date.now()) / 1_000)),
    }
  }
}

export class InMemoryAssistantRepository implements AssistantRepository {
  private readonly conversations = new Map<string, ConversationRecord>()
  private readonly messages: StoredMessage[] = []
  private readonly documents: KnowledgeDocument[] = []
  private readonly links = new Map<string, Set<string>>()
  private readonly idempotency = new Map<string, unknown>()
  private readonly requestReceipts = new Map<string, number>()

  constructor(private readonly tenantId: string) {}

  async ensureConversation(actor: ConversationActor, conversationId?: string): Promise<ConversationRecord> {
    if (actor.tenantId !== this.tenantId) throw new Error('Assistant repository tenant mismatch.')
    if (conversationId) {
      const existing = this.conversations.get(conversationId)
      if (
        !existing ||
        existing.surface !== actor.surface ||
        existing.subjectId !== actor.subjectId ||
        existing.accountId !== actor.accountId ||
        existing.userId !== actor.userId ||
        existing.siteId !== actor.siteId ||
        existing.botId !== actor.botId
      ) throw new Error('Conversation not found.')
      return structuredClone(existing)
    }
    const conversation: ConversationRecord = {
      ...actor,
      id: crypto.randomUUID(),
      status: 'open',
      leadState: { consent: false },
      failedAnswerCount: 0,
      metadata: {
        ...(actor.siteId ? { siteId: actor.siteId } : {}),
        ...(actor.botId ? { botId: actor.botId } : {}),
      },
    }
    this.conversations.set(conversation.id, conversation)
    return structuredClone(conversation)
  }

  async findMessage(conversationId: string, requestId: string, role: StoredMessage['role']): Promise<StoredMessage | null> {
    return structuredClone(this.messages.find((message) => (
      message.conversationId === conversationId && message.requestId === requestId && message.role === role
    )) ?? null)
  }

  async appendMessage(input: Omit<StoredMessage, 'id' | 'createdAt'>): Promise<StoredMessage> {
    const existing = await this.findMessage(input.conversationId, input.requestId, input.role)
    if (existing) return existing
    const message = { ...structuredClone(input), id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    this.messages.push(message)
    return structuredClone(message)
  }

  async listMessages(conversationId: string, limit = 20): Promise<StoredMessage[]> {
    return structuredClone(this.messages.filter((message) => message.conversationId === conversationId).slice(-limit))
  }

  async updateLeadState(conversationId: string, leadState: LeadState, metadata: Record<string, unknown> = {}): Promise<void> {
    const conversation = this.requireConversation(conversationId)
    conversation.leadState = structuredClone(leadState)
    conversation.metadata = { ...conversation.metadata, ...structuredClone(metadata) }
  }

  async incrementFailedAnswers(conversationId: string): Promise<number> {
    const conversation = this.requireConversation(conversationId)
    conversation.failedAnswerCount += 1
    return conversation.failedAnswerCount
  }

  async resetFailedAnswers(conversationId: string): Promise<void> {
    const conversation = this.requireConversation(conversationId)
    conversation.failedAnswerCount = 0
  }

  async recordSupportFeedback(
    conversationId: string,
    input: { helpful: boolean; note?: string; createdAt: string },
  ): Promise<number> {
    const conversation = this.requireConversation(conversationId)
    const previous = Number(conversation.metadata.unhelpfulFeedbackCount ?? 0)
    const unhelpfulFeedbackCount = input.helpful ? 0 : previous + 1
    conversation.metadata.unhelpfulFeedbackCount = unhelpfulFeedbackCount
    conversation.metadata.lastSupportFeedback = structuredClone(input)
    return unhelpfulFeedbackCount
  }

  async markEscalated(conversationId: string, ticket: Record<string, unknown>): Promise<void> {
    const conversation = this.requireConversation(conversationId)
    conversation.status = 'escalated'
    conversation.metadata.ticket = structuredClone(ticket)
  }

  async searchKnowledge(query: string, kind: KnowledgeDocument['kind'], limit = 5, pagePath?: string): Promise<KnowledgeDocument[]> {
    const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2)
    return structuredClone(this.documents
      .filter((document) => document.kind === kind && (!pagePath || !document.pagePath || document.pagePath === pagePath))
      .map((document) => ({
        document,
        score: terms.reduce((score, term) => score + (document.content.toLowerCase().includes(term) ? 1 : 0), 0)
          + (document.pagePath === pagePath ? 2 : 0),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ document, score }) => ({ ...document, rank: score })))
  }

  async replaceKnowledge(kind: KnowledgeDocument['kind'], documents: KnowledgeDocument[]): Promise<void> {
    for (let index = this.documents.length - 1; index >= 0; index--) {
      if (this.documents[index].kind === kind) this.documents.splice(index, 1)
    }
    this.documents.push(...structuredClone(documents))
  }

  async linkIdentity(
    sourceSubjectId: string,
    targetSubjectId: string,
    _verifiedBy: 'authenticated_session' | 'verified_email',
  ): Promise<void> {
    const sources = this.links.get(targetSubjectId) ?? new Set<string>()
    sources.add(sourceSubjectId)
    this.links.set(targetSubjectId, sources)
  }

  async salesContextFor(targetSubjectId: string, limit = 3): Promise<ConversationSummary[]> {
    const accepted = new Set([targetSubjectId, ...(this.links.get(targetSubjectId) ?? [])])
    return [...this.conversations.values()]
      .filter((conversation) => conversation.surface === 'sales' && accepted.has(conversation.subjectId))
      .slice(-limit)
      .map((conversation) => ({
        conversationId: conversation.id,
        leadState: structuredClone(conversation.leadState),
        summary: typeof conversation.metadata.salesSummary === 'string' ? conversation.metadata.salesSummary : undefined,
        updatedAt: new Date().toISOString(),
      }))
  }

  async getIdempotentResult<T>(key: string, operation: string): Promise<T | null> {
    return structuredClone((this.idempotency.get(`${operation}:${key}`) as T | undefined) ?? null)
  }

  async saveIdempotentResult(key: string, operation: string, result: unknown): Promise<void> {
    this.idempotency.set(`${operation}:${key}`, structuredClone(result))
  }

  async consumeRequestReceipt(
    purpose: 'sales' | 'knowledge',
    requestId: string,
    ttlSeconds = 24 * 60 * 60,
  ): Promise<boolean> {
    const key = `${purpose}:${requestId}`
    const now = Date.now()
    const expiresAt = this.requestReceipts.get(key)
    if (expiresAt && expiresAt > now) return false
    this.requestReceipts.set(
      key,
      now + Math.max(300, Math.min(ttlSeconds, 30 * 24 * 60 * 60)) * 1_000,
    )
    return true
  }

  async consumeRateLimit(key: string, limit: number) {
    const id = `rate:${key}`
    const hits = Number(this.idempotency.get(id) ?? 0) + 1
    this.idempotency.set(id, hits)
    return {
      allowed: hits <= limit,
      remaining: Math.max(0, limit - hits),
      retryAfterSeconds: 60,
    }
  }

  private requireConversation(id: string): ConversationRecord {
    const conversation = this.conversations.get(id)
    if (!conversation) throw new Error('Conversation not found.')
    return conversation
  }
}
