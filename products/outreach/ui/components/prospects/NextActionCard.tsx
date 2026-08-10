"use client";

import { useState } from "react";
import { AlarmClock, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActionItem } from "@/products/outreach/domain/action-items";
import { DueBadge } from "../action-items/DueBadge";

const SNOOZE_PRESETS = [
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "Next week", days: 7 },
] as const;

export function presetDueAt(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}

function dateInputToIso(value: string): string {
  return new Date(`${value}T09:00`).toISOString();
}

/** Local-calendar yyyy-mm-dd for a date input, matching the badges' local-day math. */
function toDateInputValue(iso: string): string {
  const date = new Date(iso);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface NextActionCardProps {
  items: ActionItem[];
  isLoading: boolean;
  onComplete: (id: string) => void;
  onSnooze: (id: string, dueAt: string) => void;
  onCreate: (title: string, dueAt: string) => void;
  onEdit: (id: string, title: string, dueAt: string) => void;
}

export function NextActionCard({
  items,
  isLoading,
  onComplete,
  onSnooze,
  onCreate,
  onEdit,
}: NextActionCardProps) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [snoozeDate, setSnoozeDate] = useState("");

  const next = items[0];

  const clearDrafts = () => {
    setDraftTitle("");
    setDraftDate("");
  };

  const startEdit = () => {
    if (!next) return;
    setDraftTitle(next.title);
    setDraftDate(toDateInputValue(next.dueAt));
    setEditing(true);
  };

  const submitEdit = () => {
    if (!draftTitle.trim() || !draftDate) return;
    onEdit(next.id, draftTitle.trim(), dateInputToIso(draftDate));
    setEditing(false);
    clearDrafts();
  };

  const submitCreate = () => {
    if (!draftTitle.trim() || !draftDate) return;
    onCreate(draftTitle.trim(), dateInputToIso(draftDate));
    clearDrafts();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Next action</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-8 w-1/2" />
          </div>
        ) : !next ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No next action. Set one so this prospect doesn&apos;t go quiet.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="Next action title"
                className="h-8 w-56"
                onChange={(event) => setDraftTitle(event.target.value)}
                placeholder="What's the next step?"
                value={draftTitle}
              />
              <Input
                aria-label="Next action due date"
                className="h-8 w-36"
                onChange={(event) => setDraftDate(event.target.value)}
                type="date"
                value={draftDate}
              />
              <Button disabled={!draftTitle.trim() || !draftDate} onClick={submitCreate} size="sm">
                Set next action
              </Button>
            </div>
          </div>
        ) : editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Next action title"
              className="h-8 w-56"
              onChange={(event) => setDraftTitle(event.target.value)}
              value={draftTitle}
            />
            <Input
              aria-label="Next action due date"
              className="h-8 w-36"
              onChange={(event) => setDraftDate(event.target.value)}
              type="date"
              value={draftDate}
            />
            <Button disabled={!draftTitle.trim() || !draftDate} onClick={submitEdit} size="sm">
              Save
            </Button>
            <Button
              onClick={() => {
                setEditing(false);
                clearDrafts();
              }}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{next.title}</p>
              <DueBadge dueAt={next.dueAt} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => onComplete(next.id)} size="sm">
                <Check className="size-3.5" />
                Done
              </Button>
              <Popover onOpenChange={setSnoozeOpen} open={snoozeOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline">
                    <AlarmClock className="size-3.5" />
                    Snooze
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-56 space-y-1 p-2">
                  {SNOOZE_PRESETS.map((preset) => (
                    <Button
                      className="w-full justify-start"
                      key={preset.label}
                      onClick={() => {
                        onSnooze(next.id, presetDueAt(preset.days));
                        setSnoozeOpen(false);
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      {preset.label}
                    </Button>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <Input
                      aria-label="Snooze until date"
                      className="h-8"
                      onChange={(event) => setSnoozeDate(event.target.value)}
                      type="date"
                      value={snoozeDate}
                    />
                    <Button
                      disabled={!snoozeDate}
                      onClick={() => {
                        onSnooze(next.id, dateInputToIso(snoozeDate));
                        setSnoozeDate("");
                        setSnoozeOpen(false);
                      }}
                      size="sm"
                      variant="secondary"
                    >
                      Apply
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              <Button onClick={startEdit} size="sm" variant="ghost">
                <Pencil className="size-3.5" />
                Edit
              </Button>
            </div>
            {items.length > 1 && (
              <p className="text-xs text-muted-foreground">
                +{items.length - 1} more scheduled
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
