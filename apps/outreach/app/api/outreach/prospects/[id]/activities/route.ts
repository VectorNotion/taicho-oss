import { getAuthorizationContext } from '@content-automation/auth/server';
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { generateProspectInsights } from '@/products/outreach/agent/prospect-insights';
import { getProspectActivities, createProspectActivity } from '@/products/outreach/data/prospect-repository';
import { ACTIVITY_TYPE_CONFIG, type CreateActivityInput } from '@/products/outreach/domain/types';

export const maxDuration = 600;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authorization = await getAuthorizationContext(await headers());
  if (!authorization) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const activities = await getProspectActivities(id);
    return NextResponse.json(activities);
  } catch (error) {
    console.error('Error fetching activities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch activities' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authorization = await getAuthorizationContext(await headers());
  if (!authorization) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const body = await request.json();

    const { type, title, notes, metadata } = body as CreateActivityInput;

    if (typeof type !== 'string'
      || !(type in ACTIVITY_TYPE_CONFIG)
      || typeof title !== 'string'
      || !title.trim()
      || title.length > 500
      || (notes !== undefined && (typeof notes !== 'string' || notes.length > 20_000))) {
      return NextResponse.json(
        { error: 'Choose a valid activity type and provide a title.' },
        { status: 400 }
      );
    }

    const activity = await createProspectActivity(id, {
      type,
      title: title.trim(),
      notes,
      metadata,
    });
    let insightStatus = 'refreshed';
    try {
      await generateProspectInsights({
        organizationId: authorization.organizationId,
        prospectId: id,
        reason: 'activity_update',
        createdBy: authorization.session.user.id,
      });
    } catch {
      insightStatus = 'pending';
    }
    return NextResponse.json(activity, {
      status: 201,
      headers: { 'X-Prospect-Insight-Status': insightStatus },
    });
  } catch (error) {
    console.error('Error creating activity:', error);
    return NextResponse.json(
      { error: 'Failed to create activity' },
      { status: 500 }
    );
  }
}
