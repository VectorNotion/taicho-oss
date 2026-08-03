import { NextRequest, NextResponse } from 'next/server';
import {
  getResearchSourceById,
  updateResearchSource,
  deleteResearchSource,
} from '@/products/content-generator/data/research-repository';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const source = await getResearchSourceById(id);

    if (!source) {
      return NextResponse.json(
        { error: 'Research source not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(source);
  } catch (error) {
    console.error('Error fetching research source:', error);
    return NextResponse.json(
      { error: 'Failed to fetch research source' },
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
    const { name, type, url, enabled } = body;

    // Validate type if provided
    if (type !== undefined && !['website', 'search_term'].includes(type)) {
      return NextResponse.json(
        { error: 'type must be "website" or "search_term"' },
        { status: 400 }
      );
    }

    const source = await updateResearchSource(id, {
      name,
      type,
      url,
      enabled,
    });

    if (!source) {
      return NextResponse.json(
        { error: 'Research source not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(source);
  } catch (error) {
    console.error('Error updating research source:', error);
    return NextResponse.json(
      { error: 'Failed to update research source' },
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
    const deleted = await deleteResearchSource(id);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Research source not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting research source:', error);
    return NextResponse.json(
      { error: 'Failed to delete research source' },
      { status: 500 }
    );
  }
}
