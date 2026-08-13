import { NextRequest, NextResponse } from 'next/server';
import { withProspectOrg } from '@/lib/prospect-scope';
import { generateProspectInsights } from '@/products/outreach/agent/prospect-insights';
import {
  getOutreachById,
  updateOutreachMessage,
  deleteOutreachMessage,
} from '@/products/outreach/data/prospect-repository';

export const maxDuration = 600;

// GET /api/outreach/prospects/[id]/outreach/[messageId] - Get single outreach message
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  return withProspectOrg(request, async () => {
   try {
    const { id, messageId } = await params;

    const message = await getOutreachById(messageId);
    if (!message || message.prospectId !== id) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    return NextResponse.json(message);
   } catch (error) {
    console.error('Error fetching outreach message:', error);
    return NextResponse.json(
      { error: 'Failed to fetch outreach message' },
      { status: 500 }
    );
   }
  });
}

// PATCH /api/outreach/prospects/[id]/outreach/[messageId] - Update outreach message
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  return withProspectOrg(request, async (authorization) => {
   try {
    const { id, messageId } = await params;
    const body = await request.json();
    const existing = await getOutreachById(messageId);
    if (!existing || existing.prospectId !== id) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }
    const message = await updateOutreachMessage(messageId, body);
    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    let insightStatus = 'unchanged';
    if (body?.status === 'sent' && existing.status !== 'sent') {
      insightStatus = 'refreshed';
      try {
        await generateProspectInsights({
          organizationId: authorization.organizationId,
          prospectId: id,
          reason: 'outreach_sent',
          createdBy: authorization.session.user.id,
        });
      } catch {
        insightStatus = 'pending';
      }
    }
    return NextResponse.json(message, {
      headers: { 'X-Prospect-Insight-Status': insightStatus },
    });
   } catch (error) {
    console.error('Error updating outreach message:', error);
    return NextResponse.json(
      { error: 'Failed to update outreach message' },
      { status: 500 }
    );
   }
  });
}

// DELETE /api/outreach/prospects/[id]/outreach/[messageId] - Delete outreach message
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  return withProspectOrg(request, async () => {
   try {
    const { id, messageId } = await params;

    const message = await getOutreachById(messageId);
    if (!message || message.prospectId !== id) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    const deleted = await deleteOutreachMessage(messageId);
    if (!deleted) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
   } catch (error) {
    console.error('Error deleting outreach message:', error);
    return NextResponse.json(
      { error: 'Failed to delete outreach message' },
      { status: 500 }
    );
   }
  });
}
