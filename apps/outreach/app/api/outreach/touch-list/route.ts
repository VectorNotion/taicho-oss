import { NextRequest, NextResponse } from 'next/server';
import { getTouchList } from '@/products/outreach/data/qualification-repository';

/**
 * Weekly touch list (spec §11): top N QUALIFIED prospects ranked by Timing
 * Score. Fit gates. Timing ranks.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit') ?? 25);
    const entries = await getTouchList(Number.isFinite(limit) ? limit : 25);
    return NextResponse.json(entries);
  } catch (error) {
    console.error('Error fetching touch list:', error);
    return NextResponse.json({ error: 'Failed to fetch touch list' }, { status: 500 });
  }
}
