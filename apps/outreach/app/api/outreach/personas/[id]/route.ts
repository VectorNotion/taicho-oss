import { NextRequest, NextResponse } from 'next/server';
import { getPersonaById, updatePersona, deletePersona } from '@/products/outreach/data/persona-repository';
import type { UpdatePersonaInput } from '@/products/outreach/domain/types';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const persona = await getPersonaById(id);

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
    }

    return NextResponse.json(persona);
  } catch (error) {
    console.error('Error fetching persona:', error);
    return NextResponse.json(
      { error: 'Failed to fetch persona' },
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

    const data: UpdatePersonaInput = {
      name: body.name,
      description: body.description,
      targetTitles: body.targetTitles,
      companySizeMin: body.companySizeMin,
      companySizeMax: body.companySizeMax,
      fundingStages: body.fundingStages,
      targetDomains: body.targetDomains,
      signals: body.signals,
      isActive: body.isActive,
    };

    // Remove undefined values
    Object.keys(data).forEach((key) => {
      if (data[key as keyof UpdatePersonaInput] === undefined) {
        delete data[key as keyof UpdatePersonaInput];
      }
    });

    const persona = await updatePersona(id, data);

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
    }

    return NextResponse.json(persona);
  } catch (error) {
    console.error('Error updating persona:', error);
    return NextResponse.json(
      { error: 'Failed to update persona' },
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
    const deleted = await deletePersona(id);

    if (!deleted) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting persona:', error);
    return NextResponse.json(
      { error: 'Failed to delete persona' },
      { status: 500 }
    );
  }
}
