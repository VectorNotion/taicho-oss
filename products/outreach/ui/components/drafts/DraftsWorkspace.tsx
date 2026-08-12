"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  Clipboard,
  FileText,
  Linkedin,
  Mail,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ListRow, ListRows } from "@/components/ListRow";
import { ListSurface } from "@/components/ListSurface";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  OUTREACH_MEDIUM_CONFIG,
  OUTREACH_STATUS_CONFIG,
  type OutreachMedium,
  type OutreachMessageWithProspect,
  type OutreachStatus,
} from "@/products/outreach/domain/types";

const mediumIcons: Record<
  OutreachMedium,
  React.ComponentType<{ className?: string }>
> = {
  inmail: Linkedin,
  inmail_traditional: Linkedin,
  email: Mail,
  content_comment: MessageSquare,
};

function formatMoment(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

export function DraftsWorkspace({
  initialMessages,
}: {
  initialMessages: OutreachMessageWithProspect[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OutreachStatus | "all">("all");
  const [medium, setMedium] = useState<OutreachMedium | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<OutreachMessageWithProspect | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return messages.filter(({ prospect, message }) => {
      if (status !== "all" && message.status !== status) return false;
      if (medium !== "all" && message.medium !== medium) return false;
      if (!query) return true;
      return [
        prospect.name,
        prospect.company,
        prospect.title,
        prospect.email,
        message.subject,
        message.content,
      ].some((value) => value?.toLowerCase().includes(query));
    });
  }, [medium, messages, search, status]);

  const draftCount = messages.filter(
    ({ message }) => message.status === "draft",
  ).length;
  const filtersActive = Boolean(search) || status !== "all" || medium !== "all";

  async function copyMessage(id: string, content: string) {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    toast.success("Draft copied");
    window.setTimeout(() => setCopiedId(null), 1_500);
  }

  async function toggleStatus(item: OutreachMessageWithProspect) {
    setBusyId(item.message.id);
    const nextStatus: OutreachStatus =
      item.message.status === "draft" ? "sent" : "draft";
    try {
      const response = await fetch(
        `/api/outreach/prospects/${item.prospect.id}/outreach/${item.message.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      if (!response.ok) throw new Error();
      const updated = await response.json();
      setMessages((current) =>
        current.map((entry) =>
          entry.message.id === updated.id
            ? { ...entry, message: updated }
            : entry,
        ),
      );
      toast.success(
        nextStatus === "sent"
          ? "Marked as sent externally"
          : "Returned to drafts",
      );
    } catch {
      toast.error("Could not update the draft. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteMessage(item: OutreachMessageWithProspect) {
    setBusyId(item.message.id);
    try {
      const response = await fetch(
        `/api/outreach/prospects/${item.prospect.id}/outreach/${item.message.id}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error();
      setMessages((current) =>
        current.filter((entry) => entry.message.id !== item.message.id),
      );
      toast.success("Draft deleted");
    } catch {
      toast.error("Could not delete the draft. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <ListSurface
        count={filtered.length}
        description={`${filtered.length.toLocaleString()} message${filtered.length === 1 ? "" : "s"}${draftCount ? ` · ${draftCount.toLocaleString()} awaiting review` : ""}`}
        emptyState={
          <div className="grid min-h-72 place-items-center px-6 text-center">
            <div className="max-w-md">
              <FileText className="mx-auto size-9 text-muted-foreground" />
              <h2 className="mt-4 font-semibold">
                {messages.length === 0
                  ? "No outreach drafts yet"
                  : search
                    ? `No drafts match “${search}”`
                    : "No drafts match these filters"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {messages.length === 0
                  ? "Open a person in the pipeline to research them and prepare an email, InMail, or content comment."
                  : "Try another status, channel, or search term."}
              </p>
              {messages.length === 0 ? (
                <Button asChild className="mt-5">
                  <Link href="/outreach/prospects">Choose a person</Link>
                </Button>
              ) : filtersActive ? (
                <Button
                  className="mt-5"
                  onClick={() => {
                    setSearch("");
                    setStatus("all");
                    setMedium("all");
                  }}
                  variant="outline"
                >
                  Clear filters
                </Button>
              ) : null}
            </div>
          </div>
        }
        filters={
          <>
            <Select
              onValueChange={(value) =>
                setStatus(value as OutreachStatus | "all")
              }
              value={status}
            >
              <SelectTrigger aria-label="Filter by draft status" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Needs review</SelectItem>
                <SelectItem value="sent">Sent externally</SelectItem>
              </SelectContent>
            </Select>
            <Select
              onValueChange={(value) =>
                setMedium(value as OutreachMedium | "all")
              }
              value={medium}
            >
              <SelectTrigger aria-label="Filter by channel" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                {Object.entries(OUTREACH_MEDIUM_CONFIG).map(([value, config]) => (
                  <SelectItem key={value} value={value}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        onSearchChange={setSearch}
        searchPlaceholder="Search people or message copy…"
        searchValue={search}
        title="Outreach drafts"
      >
        {filtered.length > 0 ? (
          <ListRows>
          {filtered.map((item) => {
            const { prospect, message } = item;
            const MediumIcon = mediumIcons[message.medium];
            const isBusy = busyId === message.id;
            return (
              <ListRow
                actions={[
                  {
                    disabled: isBusy,
                    icon: Check,
                    label:
                      message.status === "draft"
                        ? "Mark sent externally"
                        : "Return to review",
                    onSelect: () => void toggleStatus(item),
                  },
                  {
                    icon: copiedId === message.id ? Check : Clipboard,
                    label:
                      copiedId === message.id ? "Copied" : "Copy message",
                    onSelect: () =>
                      void copyMessage(message.id, message.content),
                  },
                  {
                    destructive: true,
                    disabled: isBusy,
                    icon: Trash2,
                    label: `Delete message for ${prospect.name}`,
                    onSelect: () => setPendingDelete(item),
                  },
                ]}
                badge={
                  <Badge
                    variant={OUTREACH_STATUS_CONFIG[message.status].variant}
                  >
                    {message.status === "draft"
                      ? "Needs review"
                      : OUTREACH_STATUS_CONFIG[message.status].label}
                  </Badge>
                }
                href={`/outreach/prospects/${prospect.id}`}
                key={message.id}
                leading={
                  <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                    <MediumIcon className="size-4" />
                  </span>
                }
                meta={[
                  prospect.name,
                  [prospect.title, prospect.company].filter(Boolean).join(" · ")
                    || prospect.email
                    || "Outreach target",
                  OUTREACH_MEDIUM_CONFIG[message.medium].label,
                  <time dateTime={message.updatedAt} key="updated">
                      {formatMoment(message.updatedAt)}
                    </time>,
                  <span className="line-clamp-1 max-w-2xl" key="content">
                    {message.content}
                  </span>,
                ]}
                title={message.subject || `Message for ${prospect.name}`}
              />
            );
          })}
          </ListRows>
        ) : null}
      </ListSurface>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        open={Boolean(pendingDelete)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete outreach draft</DialogTitle>
            <DialogDescription>
              This permanently deletes the prepared message for{" "}
              {pendingDelete?.prospect.name}. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setPendingDelete(null)} variant="outline">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!pendingDelete) return;
                const item = pendingDelete;
                setPendingDelete(null);
                void deleteMessage(item);
              }}
              variant="destructive"
            >
              Delete draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
