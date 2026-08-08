import { getAuthorizationContext } from '@content-automation/auth/server';
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { generateLeadInsights } from '@/products/outreach/agent/lead-insights';
import { updateLeadActivity, deleteLeadActivity, getActivityById } from '@/products/outreach/data/lead-repository';
import type { UpdateActivityInput } from '@/products/outreach/domain/types';

export const maxDuration = 600;

async function refreshInsights(organizationId: string, userId: string, leadId: string) {
  try {
    await generateLeadInsights({
      organizationId,
      leadId,
      reason: 'activity_update',
      createdBy: userId,
    });
    return 'refreshed';
  } catch {
    return 'pending';
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; activityId: string }> }
) {
  const authorization = await getAuthorizationContext(await headers());
  if (!authorization) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id, activityId } = await params;
    const body = await request.json();
    const existing = await getActivityById(activityId);
    if (!existing || existing.leadId !== id) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    }

    const { title, notes, metadata } = body as UpdateActivityInput;

    const activity = await updateLeadActivity(activityId, {
      title,
      notes,
      metadata,
    });

    if (!activity) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    }

    const insightStatus = await refreshInsights(authorization.organizationId, authorization.session.user.id, id);
    return NextResponse.json(activity, { headers: { 'X-Lead-Insight-Status': insightStatus } });
  } catch (error) {
    console.error('Error updating activity:', error);
    return NextResponse.json(
      { error: 'Failed to update activity' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; activityId: string }> }
) {
  const authorization = await getAuthorizationContext(await headers());
  if (!authorization) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id, activityId } = await params;
    const existing = await getActivityById(activityId);
    if (!existing || existing.leadId !== id) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    }
    const deleted = await deleteLeadActivity(activityId);

    if (!deleted) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    }

    const insightStatus = await refreshInsights(authorization.organizationId, authorization.session.user.id, id);
    return NextResponse.json({ success: true }, { headers: { 'X-Lead-Insight-Status': insightStatus } });
  } catch (error) {
    console.error('Error deleting activity:', error);
    return NextResponse.json(
      { error: 'Failed to delete activity' },
      { status: 500 }
    );
  }
}
