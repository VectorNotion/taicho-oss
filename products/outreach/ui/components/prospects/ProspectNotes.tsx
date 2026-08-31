"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { ListCard } from "@/components/ListCard";
import { ListRow, ListRows } from "@/components/ListRow";
import { AlertCircle, Plus, Trash2, Loader2, Pencil } from "lucide-react";
import type { ProspectNote } from "@/products/outreach/domain/types";

interface ProspectNotesProps {
  notes: ProspectNote[];
  isLoading?: boolean;
  onAddNote: (content: string) => Promise<void>;
  onUpdateNote: (noteId: string, content: string, expectedRevision: number) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  } else {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
}

function stripHtml(html: string): string {
  let text = "";
  let insideTag = false;
  for (const character of html) {
    if (character === "<") insideTag = true;
    else if (character === ">") insideTag = false;
    else if (!insideTag) text += character;
  }
  return text.trim();
}

function authorLabel(actor?: string): string {
  return actor ? "Workspace member" : "System";
}

export function ProspectNotes({
  notes,
  isLoading = false,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
}: ProspectNotesProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<ProspectNote | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (!editingNote) return;
    const latest = notes.find((note) => note.id === editingNote.id);
    if (!latest || latest.revision === editingNote.revision) return;
    setEditingNote((current) => current?.id === latest.id ? latest : current);
  }, [editingNote, notes]);

  const handleSaveNote = async () => {
    if (!newNoteContent.trim()) return;

    setIsSaving(true);
    try {
      await onAddNote(newNoteContent);
      setNewNoteContent("");
      setIsAdding(false);
    } catch (error) {
      console.error("Failed to save note:", error);
      toast.error("Could not save the note — try again");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    setConfirmDeleteId(null);
    setDeletingId(noteId);
    try {
      await onDeleteNote(noteId);
    } catch (error) {
      console.error("Failed to delete note:", error);
      toast.error("Could not delete the note — try again");
    } finally {
      setDeletingId(null);
    }
  };

  const startEditing = (note: ProspectNote) => {
    setEditingNote(note);
    setEditContent(note.content);
    setEditError(null);
    setIsAdding(false);
    setNewNoteContent("");
  };

  const cancelEditing = () => {
    setEditingNote(null);
    setEditContent("");
    setEditError(null);
  };

  const handleUpdateNote = async () => {
    if (!editingNote || !editContent.trim()) return;
    setIsUpdating(true);
    setEditError(null);
    try {
      await onUpdateNote(editingNote.id, editContent, editingNote.revision);
      cancelEditing();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update the note — try again";
      setEditError(message);
      toast.error(message);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <>
      <ListCard
        actions={
          !isAdding && !editingNote ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsAdding(true)}
                className="h-7"
              >
                <Plus className="h-3 w-3 mr-1" />
                <span className="text-xs">Add</span>
              </Button>
          ) : null
        }
        description="Context and observations saved for this person."
        title="Notes"
      >
        {/* Add Note Form */}
        {isAdding && (
          <div className="space-y-3 border-b p-4">
            <RichTextEditor
              content={newNoteContent}
              onChange={setNewNoteContent}
              placeholder="Write a note..."
              minHeight="80px"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsAdding(false);
                  setNewNoteContent("");
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveNote}
                disabled={!newNoteContent.trim() || isSaving}
              >
                {isSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        )}

        {editingNote && (
          <div className="space-y-3 border-b p-4">
            <p className="text-sm font-medium">Edit note</p>
            <RichTextEditor
              content={editContent}
              onChange={setEditContent}
              placeholder="Update this note..."
              minHeight="80px"
            />
            {editError && (
              <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <p>{editError}</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={cancelEditing} size="sm" variant="outline">Cancel</Button>
              <Button disabled={!editContent.trim() || isUpdating} onClick={handleUpdateNote} size="sm">
                {isUpdating && <Loader2 className="mr-1 size-3 animate-spin" />}
                Save changes
              </Button>
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="divide-y">
            {[1, 2].map((i) => (
              <div className="space-y-2 px-6 py-3.5" key={i}>
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        )}

        {/* Notes List */}
        {!isLoading && notes.length === 0 && !isAdding && (
          <div className="px-6 py-10 text-center text-muted-foreground">
            <p className="text-sm">No notes yet</p>
            <p className="text-xs mt-1">Add notes to track important details</p>
          </div>
        )}

        {!isLoading && notes.length > 0 && (
          <ListRows>
            {notes.map((note) => (
              <ListRow
                actions={[
                  {
                    icon: Pencil,
                    label: "Edit note",
                    onSelect: () => startEditing(note),
                  },
                  {
                    destructive: true,
                    disabled: deletingId === note.id,
                    icon: deletingId === note.id ? Loader2 : Trash2,
                    label: "Delete note",
                    onSelect: () => setConfirmDeleteId(note.id),
                  },
                ]}
                className="scroll-mt-24 target:bg-primary/10 target:ring-2 target:ring-inset target:ring-primary/30 data-[prospect-source-target=true]:bg-primary/10 data-[prospect-source-target=true]:ring-2 data-[prospect-source-target=true]:ring-inset data-[prospect-source-target=true]:ring-primary/30"
                id={`note-${note.id}`}
                key={note.id}
                meta={[
                  `${note.revision > 1 ? "Edited" : "Added"} by ${authorLabel(note.updatedBy ?? note.createdBy)}`,
                  formatDate(note.updatedAt ?? note.createdAt),
                ]}
                title={stripHtml(note.content)}
              />
            ))}
          </ListRows>
        )}
      </ListCard>
      <Dialog onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }} open={confirmDeleteId !== null}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete note</DialogTitle>
            <DialogDescription>The note and its content will be permanently removed.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmDeleteId(null)} variant="outline">Cancel</Button>
            <Button onClick={() => confirmDeleteId && handleDeleteNote(confirmDeleteId)} variant="destructive">Delete note</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
