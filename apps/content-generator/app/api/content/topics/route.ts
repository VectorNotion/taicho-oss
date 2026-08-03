import { NextRequest, NextResponse } from 'next/server';
import { getTopics, createTopic, topicExistsByName } from '@/products/content-generator/data/topic-repository';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const includeDismissed = searchParams.get('includeDismissed') === 'true';

    const result = await getTopics(includeDismissed);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching topics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch topics' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, displayName, description, source } = body;

    // Validate required fields
    if (!name || !displayName || !description) {
      return NextResponse.json(
        { error: 'name, displayName, and description are required' },
        { status: 400 }
      );
    }

    // Validate source if provided
    if (source && !['llm_extracted', 'manual'].includes(source)) {
      return NextResponse.json(
        { error: 'source must be "llm_extracted" or "manual"' },
        { status: 400 }
      );
    }

    // Check for duplicate (including dismissed topics)
    const exists = await topicExistsByName(name);
    if (exists) {
      return NextResponse.json(
        { error: 'Topic with this name already exists' },
        { status: 409 }
      );
    }

    const topic = await createTopic({
      name,
      displayName,
      description,
      source,
    });

    if (!topic) {
      return NextResponse.json(
        { error: 'Topic with this name already exists' },
        { status: 409 }
      );
    }

    return NextResponse.json(topic, { status: 201 });
  } catch (error) {
    console.error('Error creating topic:', error);
    return NextResponse.json(
      { error: 'Failed to create topic' },
      { status: 500 }
    );
  }
}
