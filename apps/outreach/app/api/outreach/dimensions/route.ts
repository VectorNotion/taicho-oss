import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withOrgScope } from '@/lib/prospect-scope';
import {
  createDimensionDefinition,
  getDimensionDefinitions,
} from '@/products/outreach/data/dimension-repository';

const createDimensionSchema = z.object({
  key: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/, 'snake_case key required'),
  name: z.string().min(1),
  dimensionType: z.enum(['fit', 'timing']),
  appliesTo: z.enum(['account', 'prospect']),
  researchInstruction: z.string().min(1),
  idealValue: z.string().optional(),
  weight: z.number().positive().max(1),
  halfLifeDays: z.number().positive().optional(),
  freshnessWindowDays: z.number().positive(),
  hardExclusionRule: z.string().optional(),
  isActive: z.boolean().default(true),
});

export async function GET(request: NextRequest) {
  return withOrgScope(request, async () => {
    try {
      const { searchParams } = new URL(request.url);
      const activeOnly = searchParams.get('active') === 'true';
      const appliesTo = searchParams.get('appliesTo');
      const dimensions = await getDimensionDefinitions({ activeOnly, seedIfEmpty: true });
      const filtered = appliesTo === 'account' || appliesTo === 'prospect'
        ? dimensions.filter((dim) => dim.appliesTo === appliesTo)
        : dimensions;
      return NextResponse.json(filtered);
    } catch (error) {
      console.error('Error fetching dimensions:', error);
      return NextResponse.json({ error: 'Failed to fetch dimensions' }, { status: 500 });
    }
  });
}

export async function POST(request: NextRequest) {
  return withOrgScope(request, async () => {
    try {
      const parsed = createDimensionSchema.safeParse(await request.json());
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid dimension', details: parsed.error.flatten() },
          { status: 400 }
        );
      }
      if (parsed.data.dimensionType === 'timing' && parsed.data.appliesTo !== 'account') {
        return NextResponse.json(
          { error: 'Timing dimensions apply to accounts only' },
          { status: 400 }
        );
      }
      const dimension = await createDimensionDefinition(parsed.data);
      return NextResponse.json(dimension, { status: 201 });
    } catch (error) {
      console.error('Error creating dimension:', error);
      return NextResponse.json({ error: 'Failed to create dimension' }, { status: 500 });
    }
  });
}
