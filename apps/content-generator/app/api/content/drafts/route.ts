import { NextRequest, NextResponse } from 'next/server';
import { createContentDraft, getContentDrafts } from '@/products/content-generator/data/content-repository';
import type { ContentDraftFilters } from '@/products/content-generator/domain/content';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const filters: ContentDraftFilters = {};

    const status = searchParams.get('status');
    if (status) {
      filters.status = status as ContentDraftFilters['status'];
    }

    const type = searchParams.get('type');
    if (type) {
      filters.type = type as ContentDraftFilters['type'];
    }

    const ideaId = searchParams.get('ideaId');
    if (ideaId) {
      filters.ideaId = ideaId;
    }

    const search = searchParams.get('search');
    if (search) {
      filters.search = search;
    }

    const drafts = await getContentDrafts(filters);
    return NextResponse.json(drafts);
  } catch (error) {
    console.error('Error fetching content drafts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch content drafts' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { ideaId, title, type, content } = body;

    if (!ideaId || !title || !type || !content) {
      return NextResponse.json(
        { error: 'ideaId, title, type, and content are required' },
        { status: 400 }
      );
    }

    const draft = await createContentDraft({
      ideaId,
      title,
      type,
      content,
      citations: body.citations,
      innerLinks: body.innerLinks,
    });

    return NextResponse.json(draft, { status: 201 });
  } catch (error) {
    console.error('Error creating content draft:', error);
    return NextResponse.json(
      { error: 'Failed to create content draft' },
      { status: 500 }
    );
  }
}
