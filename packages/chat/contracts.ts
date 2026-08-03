import { z } from 'zod'

export const CHAT_VERSION = '1' as const

export const ChatSurfaceSchema = z.enum(['sales', 'support'])
export type ChatSurface = z.infer<typeof ChatSurfaceSchema>

const TrustedHttpUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol
  return protocol === 'https:' || protocol === 'http:'
}, 'Trusted assistant links must use HTTP or HTTPS.')

export const TrustedPageContextSchema = z.object({
  path: z.string().min(1).max(500),
  locale: z.string().min(2).max(20).optional(),
}).strict()

export const ChatRequestSchema = z.object({
  version: z.literal(CHAT_VERSION),
  requestId: z.uuid(),
  conversationId: z.uuid().optional(),
  surface: ChatSurfaceSchema,
  message: z.string().trim().min(1).max(4_000),
  page: TrustedPageContextSchema.optional(),
}).strict()
export type ChatRequest = z.infer<typeof ChatRequestSchema>

export const AssistantKnowledgeScopeSchema = z.object({
  tenantId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),
  siteId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),
  botId: z.string().min(1).max(128),
  brandName: z.string().min(1).max(100),
  systemInstructions: z.string().min(1).max(4_000).optional(),
  links: z.object({
    product: TrustedHttpUrlSchema.optional(),
    pricing: TrustedHttpUrlSchema.optional(),
    docs: TrustedHttpUrlSchema.optional(),
    contact: TrustedHttpUrlSchema.optional(),
    support: TrustedHttpUrlSchema.optional(),
  }).strict().optional(),
}).strict()
export type AssistantKnowledgeScope = z.infer<typeof AssistantKnowledgeScopeSchema>

export const PublicChatRequestSchema = z.object({
  tenantId: AssistantKnowledgeScopeSchema.shape.tenantId,
  siteId: AssistantKnowledgeScopeSchema.shape.siteId,
  botId: AssistantKnowledgeScopeSchema.shape.botId,
  brandName: AssistantKnowledgeScopeSchema.shape.brandName,
  systemInstructions: AssistantKnowledgeScopeSchema.shape.systemInstructions,
  links: AssistantKnowledgeScopeSchema.shape.links,
  subject: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  chat: ChatRequestSchema,
}).strict()
export type PublicChatRequest = z.infer<typeof PublicChatRequestSchema>

export const PublicConversationHistoryRequestSchema = z.object({
  version: z.literal(CHAT_VERSION),
  requestId: z.uuid(),
  tenantId: AssistantKnowledgeScopeSchema.shape.tenantId,
  siteId: AssistantKnowledgeScopeSchema.shape.siteId,
  botId: AssistantKnowledgeScopeSchema.shape.botId,
  subject: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  conversationId: z.uuid(),
}).strict()
export type PublicConversationHistoryRequest = z.infer<typeof PublicConversationHistoryRequestSchema>

export const CitationSchema = z.object({
  sourceId: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  heading: z.string().optional(),
})
export type Citation = z.infer<typeof CitationSchema>

export const LeadStateSchema = z.object({
  consent: z.boolean().default(false),
  email: z.string().email().optional(),
  name: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  role: z.string().max(200).optional(),
  useCase: z.string().max(1_000).optional(),
  timeframe: z.string().max(200).optional(),
  planInterest: z.string().max(200).optional(),
  submittedAt: z.string().datetime().optional(),
})
export type LeadState = z.infer<typeof LeadStateSchema>

export const TicketSummarySchema = z.object({
  id: z.string().min(1),
  ticketNumber: z.string().min(1),
  status: z.string().min(1),
})
export type TicketSummary = z.infer<typeof TicketSummarySchema>

export const TicketDetailSchema = TicketSummarySchema.extend({
  subject: z.string().min(1),
  severity: z.enum(['low', 'normal', 'high', 'urgent']),
  updatedAt: z.string().datetime(),
})
export type TicketDetail = z.infer<typeof TicketDetailSchema>

export const ChatEventTypeSchema = z.enum([
  'conversation.ready',
  'assistant.ack',
  'assistant.delta',
  'activity.updated',
  'citation.added',
  'lead.state.updated',
  'support.escalation.offered',
  'support.feedback.recorded',
  'support.ticket.created',
  'support.discord.available',
  'suggestions.updated',
  'assistant.completed',
  'error',
])
export type ChatEventType = z.infer<typeof ChatEventTypeSchema>

export const ChatEventEnvelopeSchema = z.object({
  version: z.literal(CHAT_VERSION),
  eventId: z.uuid(),
  sequence: z.number().int().positive(),
  timestamp: z.string().datetime(),
  conversationId: z.uuid(),
  requestId: z.uuid(),
  event: ChatEventTypeSchema,
  data: z.record(z.string(), z.unknown()),
})
export type ChatEventEnvelope = z.infer<typeof ChatEventEnvelopeSchema>

export const EscalationRequestSchema = z.object({
  version: z.literal(CHAT_VERSION),
  requestId: z.uuid(),
  conversationId: z.uuid(),
  reason: z.string().trim().min(1).max(1_000),
  severity: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
}).strict()
export type EscalationRequest = z.infer<typeof EscalationRequestSchema>

export const SupportFeedbackRequestSchema = z.object({
  version: z.literal(CHAT_VERSION),
  requestId: z.uuid(),
  conversationId: z.uuid(),
  helpful: z.boolean(),
  note: z.string().trim().min(1).max(1_000).optional(),
}).strict()
export type SupportFeedbackRequest = z.infer<typeof SupportFeedbackRequestSchema>

export const ConversationHistoryMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  citations: z.array(CitationSchema),
  createdAt: z.string().datetime(),
})
export type ConversationHistoryMessage = z.infer<typeof ConversationHistoryMessageSchema>

export const ConversationHistorySchema = z.object({
  conversationId: z.uuid(),
  surface: ChatSurfaceSchema,
  messages: z.array(ConversationHistoryMessageSchema).max(50),
  leadState: LeadStateSchema.optional(),
})
export type ConversationHistory = z.infer<typeof ConversationHistorySchema>

export const KnowledgeDocumentInputSchema = z.object({
  sourceId: z.string().min(1).max(500),
  title: z.string().min(1).max(500),
  url: z.string().url(),
  heading: z.string().max(500).optional(),
  content: z.string().min(1).max(20_000),
  contentHash: z.string().min(16).max(128),
  pagePath: z.string().min(1).max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict()

export const KnowledgeIngestRequestSchema = z.object({
  version: z.literal(CHAT_VERSION),
  kind: z.enum(['docs', 'sales_fact']),
  documents: z.array(KnowledgeDocumentInputSchema).max(5_000),
}).strict()
export type KnowledgeIngestRequest = z.infer<typeof KnowledgeIngestRequestSchema>

export function chatEvent(
  input: Omit<ChatEventEnvelope, 'version' | 'eventId' | 'timestamp'>,
): ChatEventEnvelope {
  return {
    ...input,
    version: CHAT_VERSION,
    eventId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  }
}

export function encodeSseEvent(envelope: ChatEventEnvelope): string {
  return `id: ${envelope.eventId}\nevent: ${envelope.event}\ndata: ${JSON.stringify(envelope)}\n\n`
}
