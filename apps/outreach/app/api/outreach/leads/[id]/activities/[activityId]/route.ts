import { NextRequest, NextResponse } from 'next/server';
import { updateLeadActivity, deleteLeadActivity } from '@/products/outreach/data/lead-repository';
import type { UpdateActivityInput } from '@/products/outreach/domain/types';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; activityId: string }> }
) {
  try {
    const { activityId } = await params;
    const body = await request.json();

    const { title, notes, metadata } = body as UpdateActivityInput;

    const activity = await updateLeadActivity(activityId, {
      title,
      notes,
      metadata,
    });

    if (!activity) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    }

    return NextResponse.json(activity);
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
  try {
    const { activityId } = await params;
    const deleted = await deleteLeadActivity(activityId);

    if (!deleted) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting activity:', error);
    return NextResponse.json(
      { error: 'Failed to delete activity' },
      { status: 500 }
    );
  }
}
