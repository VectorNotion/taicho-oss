import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withProspectOrg } from '@/lib/prospect-scope';
import {
  createActionItem,
  getOpenActionItemsForProspects,
  listOpenActionItems,
} from '@/products/outreach/data/action-item-repository';
import { getProspectSummariesByIds } from '@/products/outreach/data/prospect-repository';

const createSchema = z.object({
  title: z.string().trim().min(1).max(500),
  dueAt: z.string().datetime({ offset: true }),
  prospectId: z.string().min(1).optional(),
});

export async function GET(request: NextRequest) {
  return withProspectOrg(request, async () => {
    try {
      // Per-prospect requests return the COMPLETE set of open items (no
      // horizon) — surfaces treating the response as "the next action" must
      // never miss a far-future item. The horizon only bounds org-wide lists.
      const prospectId = request.nextUrl.searchParams.get('prospectId');
      if (prospectId) {
        const grouped = await getOpenActionItemsForProspects([prospectId]);
        const prospects = await getProspectSummariesByIds([prospectId]);
        const prospect = prospects.get(prospectId) ?? null;
        return NextResponse.json({
          items: (grouped.get(prospectId) ?? []).map((item) => ({ ...item, prospect })),
        });
      }
      const raw = Number(request.nextUrl.searchParams.get('horizonDays') ?? '7');
      const horizonDays = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 90) : 7;
      const dueBefore = new Date(Date.now() + horizonDays * 86_400_000).toISOString();
      const open = await listOpenActionItems({ dueBefore });
      const prospects = await getProspectSummariesByIds(
        [...new Set(open.map((item) => item.prospectId).filter((id): id is string => Boolean(id)))],
      );
      return NextResponse.json({
        items: open.map((item) => ({
          ...item,
          prospect: item.prospectId ? prospects.get(item.prospectId) ?? null : null,
        })),
      });
    } catch (error) {
      console.error('Error listing action items:', error);
      return NextResponse.json({ error: 'Failed to list action items' }, { status: 500 });
    }
  });
}

export async function POST(request: NextRequest) {
  return withProspectOrg(request, async () => {
    try {
      const body = await request.json().catch(() => null);
      const parsed = createSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Provide a title and a valid ISO due date.' },
          { status: 400 },
        );
      }
      if (parsed.data.prospectId) {
        const known = await getProspectSummariesByIds([parsed.data.prospectId]);
        if (!known.has(parsed.data.prospectId)) {
          return NextResponse.json(
            { error: 'That prospect does not exist in this workspace.' },
            { status: 404 },
          );
        }
      }
      const item = await createActionItem(parsed.data);
      return NextResponse.json(item, { status: 201 });
    } catch (error) {
      console.error('Error creating action item:', error);
      return NextResponse.json({ error: 'Failed to create action item' }, { status: 500 });
    }
  });
}
