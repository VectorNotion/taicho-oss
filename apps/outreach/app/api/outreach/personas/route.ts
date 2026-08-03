import { NextRequest, NextResponse } from 'next/server';
import { getPersonas, createPersona } from '@/products/outreach/data/persona-repository';
import type { CreatePersonaInput } from '@/products/outreach/domain/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') === 'true';

    const personas = await getPersonas(activeOnly);
    return NextResponse.json(personas);
  } catch (error) {
    console.error('Error fetching personas:', error);
    return NextResponse.json(
      { error: 'Failed to fetch personas' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.name || !body.description || !body.targetTitles || !body.signals) {
      return NextResponse.json(
        { error: 'Missing required fields: name, description, targetTitles, signals' },
        { status: 400 }
      );
    }

    const data: CreatePersonaInput = {
      name: body.name,
      description: body.description,
      targetTitles: body.targetTitles,
      companySizeMin: body.companySizeMin,
      companySizeMax: body.companySizeMax,
      fundingStages: body.fundingStages,
      targetDomains: body.targetDomains,
      signals: body.signals,
      isActive: body.isActive ?? true,
    };

    const persona = await createPersona(data);
    return NextResponse.json(persona, { status: 201 });
  } catch (error) {
    console.error('Error creating persona:', error);
    return NextResponse.json(
      { error: 'Failed to create persona' },
      { status: 500 }
    );
  }
}
