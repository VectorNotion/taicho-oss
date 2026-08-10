import { NextRequest, NextResponse } from 'next/server';
import { generateProspectInsights } from '@/products/outreach/agent/prospect-insights';
import { getProspectById, getProspectNotes, createProspectNote } from '@/products/outreach/data/prospect-repository';
import { withProspectOrg } from '@/lib/prospect-scope';

export const maxDuration = 600;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withProspectOrg(request, async () => {
    try {
      const { id } = await params;
      const notes = await getProspectNotes(id);
      return NextResponse.json(notes);
    } catch (error) {
      console.error('Error fetching notes:', error);
      return NextResponse.json(
        { error: 'Failed to fetch notes' },
        { status: 500 }
      );
    }
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withProspectOrg(request, async (context) => {
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

      const prospect = await getProspectById(id);
      if (!prospect) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
      const note = await createProspectNote(id, content);
      let insightStatus = 'refreshed';
      try {
        await generateProspectInsights({
          organizationId: context.organizationId,
          prospectId: id,
          reason: 'manual_update',
          createdBy: context.session.user.id,
        });
      } catch {
        // The note is the source of truth. A model outage must not discard it.
        insightStatus = 'pending';
      }
      return NextResponse.json(note, {
        status: 201,
        headers: { 'X-Prospect-Insight-Status': insightStatus },
      });
    } catch (error) {
      console.error('Error creating note:', error);
      return NextResponse.json(
        { error: 'Failed to create note' },
        { status: 500 }
      );
    }
  });
}
