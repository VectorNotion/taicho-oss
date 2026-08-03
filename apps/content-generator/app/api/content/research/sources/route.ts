import { NextRequest, NextResponse } from 'next/server';
import {
  createResearchSource,
  getResearchSources,
} from '@/products/content-generator/data/research-repository';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, type, url, enabled } = body;

    // Validate required fields
    if (!name || !type || !url) {
      return NextResponse.json(
        { error: 'name, type, and url are required' },
        { status: 400 }
      );
    }

    // Validate type
    if (!['website', 'search_term'].includes(type)) {
      return NextResponse.json(
        { error: 'type must be "website" or "search_term"' },
        { status: 400 }
      );
    }

    const source = await createResearchSource({
      name,
      type,
      url,
      enabled,
    });

    return NextResponse.json(source, { status: 201 });
  } catch (error) {
    console.error('Error creating research source:', error);
    return NextResponse.json(
      { error: 'Failed to create research source' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const sources = await getResearchSources();
    return NextResponse.json(sources);
  } catch (error) {
    console.error('Error fetching research sources:', error);
    return NextResponse.json(
      { error: 'Failed to fetch research sources' },
      { status: 500 }
    );
  }
}
