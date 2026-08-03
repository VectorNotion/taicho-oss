/**
 * Outreach→Cascade "add person to list" registry action. It performs the same
 * direct write as the UI/API/MCP surface:
 * canonical workspace Contact → Cascade contact import → nurture role →
 * funnel membership. Callers must already be inside organization context.
 */
import { addFunnelMember } from '@/products/cascade/data/funnel-repository';
import {
  importOutreachLead,
  markWorkspaceContactLinked,
} from '@/products/cascade/data/intake';
import { getCascadePool } from '@/products/cascade/data/pool';
import { getLeadById } from '@/products/outreach/data/lead-repository';
import { requireGraphOrganizationId } from '../data/organization-context';
import {
  addWorkspaceContactRole,
  ensureWorkspaceContact,
} from '../workspace/contacts';
import type { AddToFunnelPayload } from './payloads';

export interface AddToFunnelResult {
  memberId: string;
  contactId: string;
  funnelId: string;
}

export async function runAddToFunnel(
  payload: AddToFunnelPayload,
): Promise<AddToFunnelResult> {
  if (!payload.funnelId) throw new Error('funnelId is required');
  if (!payload.contactId && !payload.leadId) {
    throw new Error('Provide leadId or contactId to add');
  }
  const organizationId = requireGraphOrganizationId();
  const pool = getCascadePool(organizationId);

  if (payload.contactId) {
    const member = await addFunnelMember(pool, {
      funnelId: payload.funnelId,
      contactId: payload.contactId,
    });
    return {
      memberId: member.id,
      contactId: member.contactId,
      funnelId: payload.funnelId,
    };
  }

  const lead = await getLeadById(payload.leadId!);
  if (!lead) throw new Error(`Lead not found: ${payload.leadId}`);
  if (!lead.email) {
    throw new Error(`Lead ${payload.leadId} has no email; cannot add it to a funnel`);
  }

  const { contact: canonical } = await ensureWorkspaceContact({
    id: lead.id,
    email: lead.email,
    name: lead.name,
    company: lead.company,
    title: lead.title,
  });
  const contact = await importOutreachLead(pool, {
    email: canonical.email ?? lead.email,
    outreachLeadId: canonical.id,
    attributes: { name: canonical.name, company: canonical.company, title: canonical.title },
  });
  await addWorkspaceContactRole(canonical.id, 'nurture');
  await markWorkspaceContactLinked(pool, contact.id);
  const member = await addFunnelMember(pool, {
    funnelId: payload.funnelId,
    contactId: contact.id,
  });
  return {
    memberId: member.id,
    contactId: member.contactId,
    funnelId: payload.funnelId,
  };
}
