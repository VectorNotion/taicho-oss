"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  Mail,
  Phone,
  MessageSquare,
  Eye,
  Search,
  FileText,
  ArrowRight,
  Calendar,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type ActivityType, type Activity, ACTIVITY_CONFIG } from "./ActivityTimeline";

interface AddActivityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (activity: Omit<Activity, "id" | "createdAt" | "leadId">) => void;
  isSubmitting?: boolean;
  editActivity?: Activity | null; // If provided, we're editing
}

const ACTIVITY_TYPES: { type: ActivityType; label: string; icon: React.ComponentType<{ className?: string }>; defaultTitle: string }[] = [
  { type: "outreach_sent", label: "Outreach sent", icon: Mail, defaultTitle: "Sent outreach" },
  { type: "reply_received", label: "Reply received", icon: MessageSquare, defaultTitle: "Received reply" },
  { type: "call", label: "Call", icon: Phone, defaultTitle: "Had a call" },
  { type: "meeting", label: "Meeting", icon: Calendar, defaultTitle: "Had a meeting" },
  { type: "observation", label: "Observation", icon: Eye, defaultTitle: "Observed something interesting" },
  { type: "note", label: "Note", icon: FileText, defaultTitle: "Added a note" },
];

export function AddActivityDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting = false,
  editActivity,
}: AddActivityDialogProps) {
  const [selectedType, setSelectedType] = useState<ActivityType>(
    editActivity?.type || "note"
  );
  const [title, setTitle] = useState(editActivity?.title || "");
  const [notes, setNotes] = useState(editActivity?.notes || "");
  const [postUrl, setPostUrl] = useState(editActivity?.metadata?.postUrl || "");

  const isEditing = !!editActivity;

  const handleTypeSelect = (type: ActivityType) => {
    setSelectedType(type);
    // Auto-fill title if empty
    if (!title || ACTIVITY_TYPES.some((t) => t.defaultTitle === title)) {
      const typeConfig = ACTIVITY_TYPES.find((t) => t.type === type);
      setTitle(typeConfig?.defaultTitle || "");
    }
  };

  const handleSubmit = () => {
    onSubmit({
      type: selectedType,
      title: title || ACTIVITY_TYPES.find((t) => t.type === selectedType)?.defaultTitle || "Activity",
      notes: notes || undefined,
      metadata: postUrl ? { postUrl } : undefined,
    });

    // Reset form
    if (!isEditing) {
      setSelectedType("note");
      setTitle("");
      setNotes("");
      setPostUrl("");
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset form when closing
      setSelectedType(editActivity?.type || "note");
      setTitle(editActivity?.title || "");
      setNotes(editActivity?.notes || "");
      setPostUrl(editActivity?.metadata?.postUrl || "");
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit activity" : "Add activity"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update this activity entry."
              : "Log a call, observation, or note about this person."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Activity Type Selector */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Activity type</Label>
            <div className="grid grid-cols-3 gap-2">
              {ACTIVITY_TYPES.map(({ type, label, icon: Icon }) => {
                const config = ACTIVITY_CONFIG[type];
                const isSelected = selectedType === type;

                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleTypeSelect(type)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all",
                      "hover:border-primary/50 hover:bg-muted/50",
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border"
                    )}
                  >
                    <div className={cn("p-1.5 rounded-full", config.bgColor, config.color)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-xs font-medium">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title" className="text-xs text-muted-foreground">
              Title
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                ACTIVITY_TYPES.find((t) => t.type === selectedType)?.defaultTitle
              }
            />
          </div>

          {/* Notes - TipTap Editor */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <RichTextEditor
              content={notes}
              onChange={setNotes}
              placeholder="Add details, observations, or follow-up items..."
              minHeight="100px"
            />
          </div>

          {/* URL field for observations */}
          {selectedType === "observation" && (
            <div className="space-y-2">
              <Label htmlFor="postUrl" className="text-xs text-muted-foreground">
                Link (optional)
              </Label>
              <Input
                id="postUrl"
                value={postUrl}
                onChange={(e) => setPostUrl(e.target.value)}
                placeholder="https://linkedin.com/posts/..."
                type="url"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEditing ? "Save changes" : "Add activity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
