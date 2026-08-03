import { NextRequest, NextResponse } from 'next/server';
import { getProjectEntities } from '@/products/content-generator/data/project-repository';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const entities = await getProjectEntities(projectId);
    return NextResponse.json(entities);
  } catch (error) {
    console.error('Failed to fetch project entities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch entities', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
