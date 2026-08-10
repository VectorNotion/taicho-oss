import { NextRequest, NextResponse } from 'next/server';
import { deleteProspectNote, getProspectNotes } from '@/products/outreach/data/prospect-repository';
import { withProspectOrg } from '@/lib/prospect-scope';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  return withProspectOrg(request, async () => {
    try {
      const { id, noteId } = await params;

      // Verify the note belongs to this route's prospect before deleting.
      const notes = await getProspectNotes(id);
      if (!notes.some((note) => note.id === noteId)) {
        return NextResponse.json({ error: 'Note not found' }, { status: 404 });
      }

      const deleted = await deleteProspectNote(noteId);

      if (!deleted) {
        return NextResponse.json({ error: 'Note not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('Error deleting note:', error);
      return NextResponse.json(
        { error: 'Failed to delete note' },
        { status: 500 }
      );
    }
  });
}
