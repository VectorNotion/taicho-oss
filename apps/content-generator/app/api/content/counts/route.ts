import { NextResponse } from 'next/server';
import { getContentCounts } from '@/products/content-generator/data/content-repository';

export async function GET() {
  try {
    const counts = await getContentCounts();
    return NextResponse.json(counts);
  } catch (error) {
    console.error('Error fetching content counts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch content counts' },
      { status: 500 }
    );
  }
}
