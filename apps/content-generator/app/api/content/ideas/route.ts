import { NextRequest, NextResponse } from 'next/server';
import { createContentIdea, getContentIdeas } from '@/products/content-generator/data/content-repository';
import type { ContentIdeaFilters } from '@/products/content-generator/domain/content';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const filters: ContentIdeaFilters = {};

    const status = searchParams.get('status');
    if (status) {
      filters.status = status as ContentIdeaFilters['status'];
    }

    // Ideas are format-agnostic - no type or targetPlatform filters

    const priority = searchParams.get('priority');
    if (priority) {
      filters.priority = priority as ContentIdeaFilters['priority'];
    }

    const search = searchParams.get('search');
    if (search) {
      filters.search = search;
    }

    const ideas = await getContentIdeas(filters);
    return NextResponse.json(ideas);
  } catch (error) {
    console.error('Error fetching content ideas:', error);
    return NextResponse.json(
      { error: 'Failed to fetch content ideas' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Ideas are format-agnostic - no type or targetPlatform required
    const { title, description, rationale } = body;

    if (!title || !description || !rationale) {
      return NextResponse.json(
        { error: 'title, description, and rationale are required' },
        { status: 400 }
      );
    }

    const idea = await createContentIdea({
      title,
      description,
      rationale,
      priority: body.priority,
      sourceTopicIds: body.sourceTopicIds,
      sourceResearchIds: body.sourceResearchIds,
    });

    return NextResponse.json(idea, { status: 201 });
  } catch (error) {
    console.error('Error creating content idea:', error);
    return NextResponse.json(
      { error: 'Failed to create content idea' },
      { status: 500 }
    );
  }
}
