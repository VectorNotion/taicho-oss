import { NextRequest, NextResponse } from 'next/server';
import {
  createResearchItem,
  getResearchItems,
} from '@/products/content-generator/data/research-repository';
import type { ResearchItemFilters } from '@/products/content-generator/domain/research';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      content,
      sourceUrl,
      sourceId,
      addedBy,
      tags,
      status,
      priority,
      humanNote,
    } = body;

    // Validate required fields
    if (!title || !content || !sourceUrl) {
      return NextResponse.json(
        { error: 'title, content, and sourceUrl are required' },
        { status: 400 }
      );
    }

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

    const item = await createResearchItem({
      title,
      content,
      sourceUrl,
      sourceId,
      addedBy,
      tags,
      status,
      priority,
      humanNote,
    });

    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    console.error('Error creating research item:', error);
    return NextResponse.json(
      { error: 'Failed to create research item' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Build filters from query params
    const filters: ResearchItemFilters = {};

    const status = searchParams.get('status');
    if (status) {
      filters.status = status as ResearchItemFilters['status'];
    }

    const priority = searchParams.get('priority');
    if (priority) {
      filters.priority = priority as ResearchItemFilters['priority'];
    }

    const sourceId = searchParams.get('sourceId');
    if (sourceId) {
      filters.sourceId = sourceId;
    }

    const addedBy = searchParams.get('addedBy');
    if (addedBy) {
      filters.addedBy = addedBy as ResearchItemFilters['addedBy'];
    }

    const items = await getResearchItems(
      Object.keys(filters).length > 0 ? filters : undefined
    );
    return NextResponse.json(items);
  } catch (error) {
    console.error('Error fetching research items:', error);
    return NextResponse.json(
      { error: 'Failed to fetch research items' },
      { status: 500 }
    );
  }
}
