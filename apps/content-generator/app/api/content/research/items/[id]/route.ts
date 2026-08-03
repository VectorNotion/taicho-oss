import { NextRequest, NextResponse } from 'next/server';
import {
  getResearchItemById,
  updateResearchItem,
  deleteResearchItem,
} from '@/products/content-generator/data/research-repository';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const item = await getResearchItemById(id);

    if (!item) {
      return NextResponse.json(
        { error: 'Research item not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(item);
  } catch (error) {
    console.error('Error fetching research item:', error);
    return NextResponse.json(
      { error: 'Failed to fetch research item' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, content, status, priority, humanNote, tags } = body;

    // Validate status if provided
    const validStatuses = [
      'unprocessed',
      'flagged_for_video',
      'flagged_for_blog',
      'flagged_for_tweet',
      'processed',
    ];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate priority if provided
    const validPriorities = ['low', 'medium', 'high'];
    if (priority && !validPriorities.includes(priority)) {
      return NextResponse.json(
        { error: `priority must be one of: ${validPriorities.join(', ')}` },
        { status: 400 }
      );
    }

    const item = await updateResearchItem(id, {
      title,
      content,
      status,
      priority,
      humanNote,
      tags,
    });

    if (!item) {
      return NextResponse.json(
        { error: 'Research item not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(item);
  } catch (error) {
    console.error('Error updating research item:', error);
    return NextResponse.json(
      { error: 'Failed to update research item' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deleted = await deleteResearchItem(id);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Research item not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting research item:', error);
    return NextResponse.json(
      { error: 'Failed to delete research item' },
      { status: 500 }
    );
  }
}
