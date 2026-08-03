import { NextRequest, NextResponse } from 'next/server';
import {
  getContentIdeaById,
  updateContentIdea,
  deleteContentIdea,
} from '@/products/content-generator/data/content-repository';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const idea = await getContentIdeaById(id);

    if (!idea) {
      return NextResponse.json({ error: 'Content idea not found' }, { status: 404 });
    }

    return NextResponse.json(idea);
  } catch (error) {
    console.error('Error fetching content idea:', error);
    return NextResponse.json(
      { error: 'Failed to fetch content idea' },
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

    const idea = await updateContentIdea(id, body);

    if (!idea) {
      return NextResponse.json({ error: 'Content idea not found' }, { status: 404 });
    }

    return NextResponse.json(idea);
  } catch (error) {
    console.error('Error updating content idea:', error);
    return NextResponse.json(
      { error: 'Failed to update content idea' },
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
    const deleted = await deleteContentIdea(id);

    if (!deleted) {
      return NextResponse.json({ error: 'Content idea not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting content idea:', error);
    return NextResponse.json(
      { error: 'Failed to delete content idea' },
      { status: 500 }
    );
  }
}
