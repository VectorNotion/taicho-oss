import type { LeadState, TicketDetail, TicketSummary } from './contracts'
import { signInternalRequest } from './security'

export type LeadInput = {
  tenantId: string
  conversationId: string
  state: LeadState
  summary: string
}

export type TicketInput = {
  tenantId: string
  conversationId: string
  accountId: string
  userId: string
  requesterName?: string
  requesterEmail: string
  reason: string
  severity: 'low' | 'normal' | 'high' | 'urgent'
  transcript: Array<{ role: 'user' | 'assistant'; content: string }>
}

export type TicketListInput = {
  tenantId: string
  accountId: string
  userId: string
}

export interface AssistantOperations {
  createLead(input: LeadInput, idempotencyKey: string): Promise<{ id: string }>
  createTicket(input: TicketInput, idempotencyKey: string): Promise<TicketSummary>
  listTickets(input: TicketListInput): Promise<TicketDetail[]>
}

export class PayloadAssistantOperations implements AssistantOperations {
  constructor(
    private readonly gatewayUrl: string,
    private readonly secret: string,
  ) {}

  createLead(input: LeadInput, idempotencyKey: string): Promise<{ id: string }> {
    return this.request('lead.create', input, idempotencyKey)
  }

  createTicket(input: TicketInput, idempotencyKey: string): Promise<TicketSummary> {
    return this.request('ticket.create', input, idempotencyKey)
  }

  listTickets(input: TicketListInput): Promise<TicketDetail[]> {
    return this.request('ticket.list', input)
  }

  private async request<T>(action: string, input: unknown, idempotencyKey?: string): Promise<T> {
    const body = JSON.stringify({
      version: '1',
      action,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      input,
    })
    const signed = signInternalRequest(this.secret, body)
    const response = await fetch(this.gatewayUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-assistant-request-id': signed.requestId,
        'x-assistant-timestamp': signed.timestamp,
        'x-assistant-signature': signed.signature,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Payload assistant operation failed (${response.status}).`)
    }
    return response.json() as Promise<T>
  }
}

export class InMemoryAssistantOperations implements AssistantOperations {
  readonly leads: LeadInput[] = []
  readonly tickets: TicketInput[] = []

  async createLead(input: LeadInput): Promise<{ id: string }> {
    this.leads.push(structuredClone(input))
    return { id: crypto.randomUUID() }
  }

  async createTicket(input: TicketInput): Promise<TicketSummary> {
    this.tickets.push(structuredClone(input))
    return { id: crypto.randomUUID(), ticketNumber: 'TKT-TEST-0001', status: 'new' }
  }

  async listTickets(input: TicketListInput): Promise<TicketDetail[]> {
    return this.tickets
      .filter((ticket) => (
        ticket.tenantId === input.tenantId &&
        ticket.accountId === input.accountId &&
        ticket.userId === input.userId
      ))
      .map((ticket, index) => ({
        id: `ticket-${index + 1}`,
        ticketNumber: `TKT-TEST-${String(index + 1).padStart(4, '0')}`,
        status: 'new',
        subject: ticket.reason,
        severity: ticket.severity,
        updatedAt: new Date().toISOString(),
      }))
  }
}
