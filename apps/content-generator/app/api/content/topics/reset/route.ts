import { NextResponse } from 'next/server';
import { resetAllTopics } from '@/products/content-generator/data/topic-repository';

/**
 * POST /api/content/topics/reset
 * Delete ALL topics from the database (complete reset).
 */
export async function POST() {
  try {
    const result = await resetAllTopics();

    return NextResponse.json({
      success: true,
      deletedCount: result.deletedCount,
      message: `Deleted ${result.deletedCount} topics`,
    });
  } catch (error) {
    console.error('Error resetting topics:', error);
    return NextResponse.json(
      { error: 'Failed to reset topics' },
      { status: 500 }
    );
  }
}
