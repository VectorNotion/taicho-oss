import { NextRequest, NextResponse } from 'next/server';
import {
  getTopicById,
  updateTopic,
  dismissTopic,
} from '@/products/content-generator/data/topic-repository';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const topic = await getTopicById(id);

    if (!topic) {
      return NextResponse.json(
        { error: 'Topic not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(topic);
  } catch (error) {
    console.error('Error fetching topic:', error);
    return NextResponse.json(
      { error: 'Failed to fetch topic' },
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
    const { displayName, description } = body;

    // At least one field must be provided
    if (displayName === undefined && description === undefined) {
      return NextResponse.json(
        { error: 'At least one of displayName or description must be provided' },
        { status: 400 }
      );
    }

    const topic = await updateTopic(id, { displayName, description });

    if (!topic) {
      return NextResponse.json(
        { error: 'Topic not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(topic);
  } catch (error) {
    console.error('Error updating topic:', error);
    return NextResponse.json(
      { error: 'Failed to update topic' },
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

    // Soft delete - dismisses the topic
    const topic = await dismissTopic(id);

    if (!topic) {
      return NextResponse.json(
        { error: 'Topic not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(topic);
  } catch (error) {
    console.error('Error dismissing topic:', error);
    return NextResponse.json(
      { error: 'Failed to dismiss topic' },
      { status: 500 }
    );
  }
}
