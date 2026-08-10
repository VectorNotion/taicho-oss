import { NextResponse } from 'next/server';
import { withProspectOrg } from '@/lib/prospect-scope';
import { getProspectPersonaDetail, getProspectScore } from '@/products/outreach/data/qualification-repository';

/** Persona (prospect fit) dimensions with observation + evidence + match, plus the persona score. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withProspectOrg(request, async () => {
    try {
      const { id } = await params;
      const [dimensions, score] = await Promise.all([
        getProspectPersonaDetail(id),
        getProspectScore(id),
      ]);
      return NextResponse.json({ dimensions, personaScore: score?.personaScore ?? null });
    } catch (error) {
      console.error('Error fetching persona detail:', error);
      return NextResponse.json({ error: 'Failed to fetch persona detail' }, { status: 500 });
    }
  });
}
