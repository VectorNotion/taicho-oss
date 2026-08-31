"use client";

import { useState } from "react";
import { AlarmClock, Calendar as CalendarIcon, Check, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { ListCard } from "@/components/ListCard";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { ActionItem } from "@/products/outreach/domain/action-items";
import { DueBadge } from "../action-items/DueBadge";

const SNOOZE_PRESETS = [
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "Next week", days: 7 },
] as const;

/** The obvious case: a follow-up touch point some number of days out. */
const FOLLOW_UP_PRESETS = [3, 5, 7, 10] as const;

export function presetDueAt(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}

function dateInputToIso(value: string): string {
  return new Date(`${value}T09:00`).toISOString();
}

const pad = (part: number) => String(part).padStart(2, "0");

/** Local-calendar yyyy-mm-dd, matching the badges' local-day math. */
function toDateInputValue(source: string | Date): string {
  const date = typeof source === "string" ? new Date(source) : source;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** shadcn date picker: an outline trigger that opens a calendar popover. Value is
 * a local yyyy-mm-dd string so it drops into the existing dueAt conversion. */
function DatePicker({
  value,
  onChange,
  className,
  placeholder = "Pick a date",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T00:00`) : undefined;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          className={cn("h-8 justify-start gap-2 font-normal", !value && "text-muted-foreground", className)}
          size="sm"
          variant="outline"
        >
          <CalendarIcon className="size-3.5" />
          {selected
            ? selected.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
            : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          disabled={{ before: today }}
          mode="single"
          onSelect={(date) => {
            if (!date) return;
            onChange(toDateInputValue(date));
            setOpen(false);
          }}
          selected={selected}
        />
      </PopoverContent>
    </Popover>
  );
}

interface NextActionCardProps {
  items: ActionItem[];
  isLoading: boolean;
  onComplete: (id: string) => void;
  onSnooze: (id: string, dueAt: string) => void;
  onCreate: (title: string, dueAt: string) => void;
  onEdit: (id: string, title: string, dueAt: string) => void;
  onDelete: (id: string) => void;
}

export function NextActionCard({
  items,
  isLoading,
  onComplete,
  onSnooze,
  onCreate,
  onEdit,
  onDelete,
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

  const shell = (children: React.ReactNode) => (
    <ListCard description="The one next step so this prospect doesn't go quiet." title="Next action">
      <div className="space-y-3 p-6">{children}</div>
    </ListCard>
  );

  if (isLoading) {
    return shell(
      <div className="space-y-2">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-8 w-1/2" />
      </div>,
    );
  }

  if (!next) {
    return shell(
      <Tabs defaultValue="quick">
        <TabsList>
          <TabsTrigger value="quick">Quick</TabsTrigger>
          <TabsTrigger value="custom">Custom</TabsTrigger>
        </TabsList>
        <TabsContent className="mt-3 space-y-2" value="quick">
          <p className="text-sm text-muted-foreground">Schedule a follow-up touch point:</p>
          <div className="flex flex-wrap gap-2">
            {FOLLOW_UP_PRESETS.map((days) => (
              <Button
                key={days}
                onClick={() => onCreate("Follow up", presetDueAt(days))}
                size="sm"
                variant="secondary"
              >
                In {days} days
              </Button>
            ))}
          </div>
        </TabsContent>
        <TabsContent className="mt-3" value="custom">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Next action title"
              className="h-8 w-56"
              onChange={(event) => setDraftTitle(event.target.value)}
              placeholder="What's the next step?"
              value={draftTitle}
            />
            <DatePicker className="w-40" onChange={setDraftDate} value={draftDate} />
            <Button disabled={!draftTitle.trim() || !draftDate} onClick={submitCreate} size="sm">
              Set next action
            </Button>
          </div>
        </TabsContent>
      </Tabs>,
    );
  }

  if (editing) {
    return shell(
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Next action title"
          className="h-8 w-56"
          onChange={(event) => setDraftTitle(event.target.value)}
          value={draftTitle}
        />
        <DatePicker className="w-40" onChange={setDraftDate} value={draftDate} />
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
      </div>,
    );
  }

  return shell(
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-medium">{next.title}</p>
          <DueBadge dueAt={next.dueAt} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
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
            <PopoverContent align="end" className="w-56 space-y-1 p-2">
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
              <DatePicker className="flex-1" onChange={setSnoozeDate} placeholder="Custom date" value={snoozeDate} />
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
          <Button
            aria-label={`Remove ${next.title}`}
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(next.id)}
            size="icon-sm"
            variant="ghost"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      {items.length > 1 && (
        <div className="space-y-1.5 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            Upcoming ({items.length - 1})
          </p>
          {items.slice(1).map((item) => (
            <div className="flex items-center justify-between gap-2" key={item.id}>
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm">{item.title}</span>
                <DueBadge dueAt={item.dueAt} />
              </div>
              <Button
                aria-label={`Remove ${item.title}`}
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(item.id)}
                size="icon-sm"
                variant="ghost"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </>,
  );
}
