import { NextRequest, NextResponse } from 'next/server';
import {
  getContentDraftById,
  updateContentDraft,
  deleteContentDraft,
} from '@/products/content-generator/data/content-repository';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const draft = await getContentDraftById(id);

    if (!draft) {
      return NextResponse.json({ error: 'Content draft not found' }, { status: 404 });
    }

    return NextResponse.json(draft);
  } catch (error) {
    console.error('Error fetching content draft:', error);
    return NextResponse.json(
      { error: 'Failed to fetch content draft' },
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

    const draft = await updateContentDraft(id, body);

    if (!draft) {
      return NextResponse.json({ error: 'Content draft not found' }, { status: 404 });
    }

    return NextResponse.json(draft);
  } catch (error) {
    console.error('Error updating content draft:', error);
    return NextResponse.json(
      { error: 'Failed to update content draft' },
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
    const deleted = await deleteContentDraft(id);

    if (!deleted) {
      return NextResponse.json({ error: 'Content draft not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting content draft:', error);
    return NextResponse.json(
      { error: 'Failed to delete content draft' },
      { status: 500 }
    );
  }
}
