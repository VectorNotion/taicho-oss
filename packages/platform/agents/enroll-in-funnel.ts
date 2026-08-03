/**
 * `enroll_in_funnel`: the outreach→Cascade rendezvous as a registry action.
 * One implementation of the flow the enroll route
 * (apps/unified/app/api/cascade/funnels/[id]/enroll/route.ts) and the MCP
 * cascade.contact.enroll tool (packages/mcp/cascade.ts) perform:
 * canonical workspace Contact → Cascade contact import → nurture role →
 * enrollment. Callers must already be inside runWithGraphOrganization —
 * true for request execution and the MCP operation worker.
 *
 * Imports use the same `@/products/*` path-alias style as registry.ts and touch
 * only cascade data files (pg + observability imports — no cycle back into
 * this package).
 */
import { enrollContact } from '@/products/cascade/data/enrollment-repository';
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
import type { EnrollInFunnelPayload } from './payloads';

export interface EnrollInFunnelResult {
  enrollmentId: string;
  contactId: string;
  funnelId: string;
  state: string;
}

export async function runEnrollInFunnel(
  payload: EnrollInFunnelPayload,
): Promise<EnrollInFunnelResult> {
  if (!payload.funnelId) throw new Error('funnelId is required');
  if (!payload.contactId && !payload.leadId) {
    throw new Error('Provide leadId or contactId to enroll');
  }
  const organizationId = requireGraphOrganizationId();
  const pool = getCascadePool(organizationId);

  if (payload.contactId) {
    const enrollment = await enrollContact(pool, payload.funnelId, payload.contactId);
    return {
      enrollmentId: enrollment.id,
      contactId: enrollment.contactId,
      funnelId: enrollment.funnelId,
      state: enrollment.state,
    };
  }

  const lead = await getLeadById(payload.leadId!);
  if (!lead) throw new Error(`Lead not found: ${payload.leadId}`);
  if (!lead.email) {
    throw new Error(`Lead ${payload.leadId} has no email; cannot enroll in a funnel`);
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
  const enrollment = await enrollContact(pool, payload.funnelId, contact.id);
  return {
    enrollmentId: enrollment.id,
    contactId: enrollment.contactId,
    funnelId: enrollment.funnelId,
    state: enrollment.state,
  };
}
