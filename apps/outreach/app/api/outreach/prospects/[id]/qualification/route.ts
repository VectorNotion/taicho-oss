import { NextResponse } from 'next/server';
import { getProspectQualification } from '@/products/outreach/data/qualification-repository';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const qualification = await getProspectQualification(id);
    if (!qualification) {
      return NextResponse.json({ error: 'No qualification found' }, { status: 404 });
    }
    return NextResponse.json(qualification);
  } catch (error) {
    console.error('Error fetching qualification:', error);
    return NextResponse.json({ error: 'Failed to fetch qualification' }, { status: 500 });
  }
}
