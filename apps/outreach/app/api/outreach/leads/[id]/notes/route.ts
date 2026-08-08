import { getAuthorizationContext } from '@content-automation/auth/server';
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { generateLeadInsights } from '@/products/outreach/agent/lead-insights';
import { getLeadById, getLeadNotes, createLeadNote } from '@/products/outreach/data/lead-repository';

export const maxDuration = 600;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authorization = await getAuthorizationContext(await headers());
  if (!authorization) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const notes = await getLeadNotes(id);
    return NextResponse.json(notes);
  } catch (error) {
    console.error('Error fetching notes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notes' },
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

    const { content } = body;

    if (!content || typeof content !== 'string' || content.length > 20_000) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      );
    }

    const lead = await getLeadById(id);
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    const note = await createLeadNote(id, content);
    let insightStatus = 'refreshed';
    try {
      await generateLeadInsights({
        organizationId: authorization.organizationId,
        leadId: id,
        reason: 'manual_update',
        createdBy: authorization.session.user.id,
      });
    } catch {
      // The note is the source of truth. A model outage must not discard it.
      insightStatus = 'pending';
    }
    return NextResponse.json(note, {
      status: 201,
      headers: { 'X-Lead-Insight-Status': insightStatus },
    });
  } catch (error) {
    console.error('Error creating note:', error);
    return NextResponse.json(
      { error: 'Failed to create note' },
      { status: 500 }
    );
  }
}
