import { NextRequest, NextResponse } from 'next/server';
import { restoreTopic } from '@/products/content-generator/data/topic-repository';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const topic = await restoreTopic(id);

    if (!topic) {
      return NextResponse.json(
        { error: 'Topic not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(topic);
  } catch (error) {
    console.error('Error restoring topic:', error);
    return NextResponse.json(
      { error: 'Failed to restore topic' },
      { status: 500 }
    );
  }
}
