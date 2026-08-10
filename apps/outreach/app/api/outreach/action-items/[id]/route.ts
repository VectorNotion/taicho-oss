import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withProspectOrg } from '@/lib/prospect-scope';
import {
  completeActionItem,
  deleteActionItem,
  dismissActionItem,
  updateActionItem,
} from '@/products/outreach/data/action-item-repository';
import { createProspectActivity } from '@/products/outreach/data/prospect-repository';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z.union([
  z.object({ action: z.enum(['complete', 'dismiss']) }),
  z.object({
    title: z.string().trim().min(1).max(500).optional(),
    dueAt: z.string().datetime({ offset: true }).optional(),
  }).refine((value) => value.title !== undefined || value.dueAt !== undefined, {
    message: 'Provide a title or a due date.',
  }),
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withProspectOrg(request, async () => {
    try {
      const { id } = await params;
      if (!UUID_PATTERN.test(id)) {
        return NextResponse.json({ error: 'Action item not found' }, { status: 404 });
      }
      const parsed = patchSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid action item update.' }, { status: 400 });
      }
      const body = parsed.data;
      const item = 'action' in body
        ? body.action === 'complete'
          ? await completeActionItem(id)
          : await dismissActionItem(id)
        : await updateActionItem(id, body);
      if (!item) {
        return NextResponse.json({ error: 'Action item not found' }, { status: 404 });
      }
      if ('action' in body && body.action === 'complete' && item.prospectId) {
        // History lives on the prospect timeline; the repository stays single-store.
        await createProspectActivity(item.prospectId, {
          type: 'next_action_completed',
          title: item.title,
        }).catch((error) => console.error('Failed to record completion activity:', error));
      }
      return NextResponse.json(item);
    } catch (error) {
      console.error('Error updating action item:', error);
      return NextResponse.json({ error: 'Failed to update action item' }, { status: 500 });
    }
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withProspectOrg(request, async () => {
    try {
      const { id } = await params;
      if (!UUID_PATTERN.test(id)) {
        return NextResponse.json({ deleted: false });
      }
      return NextResponse.json({ deleted: await deleteActionItem(id) });
    } catch (error) {
      console.error('Error deleting action item:', error);
      return NextResponse.json({ error: 'Failed to delete action item' }, { status: 500 });
    }
  });
}
