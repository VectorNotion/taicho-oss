import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  deleteDimensionDefinition,
  updateDimensionDefinition,
} from '@/products/outreach/data/dimension-repository';

const updateDimensionSchema = z.object({
  key: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/).optional(),
  name: z.string().min(1).optional(),
  dimensionType: z.enum(['fit', 'timing']).optional(),
  appliesTo: z.enum(['account', 'prospect']).optional(),
  researchInstruction: z.string().min(1).optional(),
  idealValue: z.string().optional(),
  weight: z.number().positive().max(1).optional(),
  halfLifeDays: z.number().positive().optional(),
  freshnessWindowDays: z.number().positive().optional(),
  hardExclusionRule: z.string().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = updateDimensionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid dimension patch', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const dimension = await updateDimensionDefinition(id, parsed.data);
    if (!dimension) {
      return NextResponse.json({ error: 'Dimension not found' }, { status: 404 });
    }
    return NextResponse.json(dimension);
  } catch (error) {
    console.error('Error updating dimension:', error);
    return NextResponse.json({ error: 'Failed to update dimension' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deleted = await deleteDimensionDefinition(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Dimension not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting dimension:', error);
    return NextResponse.json({ error: 'Failed to delete dimension' }, { status: 500 });
  }
}
