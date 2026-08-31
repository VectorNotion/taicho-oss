"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  Clipboard,
  FileText,
  Linkedin,
  Mail,
  MessageSquare,
  Pencil,
  UserPlus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { apiMutate } from "@content-automation/platform/network/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  connection_note: UserPlus,
};

function statusFromUrl(value: string | null): OutreachStatus | "all" {
  return value === "draft" || value === "sent" ? value : "all";
}

function mediumFromUrl(value: string | null): OutreachMedium | "all" {
  return value === "inmail"
    || value === "inmail_traditional"
    || value === "email"
    || value === "content_comment"
    || value === "connection_note"
    ? value
    : "all";
}

function formatMoment(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

export function DraftsWorkspace({
  initialFilters = {},
  initialMessages,
}: {
  initialFilters?: {
    medium?: OutreachMedium | "all";
    search?: string;
    status?: OutreachStatus | "all";
  };
  initialMessages: OutreachMessageWithProspect[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [search, setSearch] = useState(initialFilters.search ?? "");
  const [status, setStatus] = useState<OutreachStatus | "all">(
    initialFilters.status ?? "all",
  );
  const [medium, setMedium] = useState<OutreachMedium | "all">(
    initialFilters.medium ?? "all",
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingEdit, setPendingEdit] =
    useState<OutreachMessageWithProspect | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const editBusyRef = useRef(false);
  const [pendingDelete, setPendingDelete] =
    useState<OutreachMessageWithProspect | null>(null);

  useEffect(() => {
    function restoreFilterContext() {
      const parameters = new URLSearchParams(window.location.search);
      setSearch(parameters.get("q") ?? "");
      setStatus(statusFromUrl(parameters.get("status")));
      setMedium(mediumFromUrl(parameters.get("medium")));
    }

    restoreFilterContext();
    window.addEventListener("popstate", restoreFilterContext);
    return () => window.removeEventListener("popstate", restoreFilterContext);
  }, []);

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

  function preserveFilterContext(next: {
    medium: OutreachMedium | "all";
    search: string;
    status: OutreachStatus | "all";
  }) {
    const parameters = new URLSearchParams(window.location.search);
    for (const [key, value] of [
      ["q", next.search],
      ["status", next.status === "all" ? "" : next.status],
      ["medium", next.medium === "all" ? "" : next.medium],
    ] as const) {
      if (value) parameters.set(key, value);
      else parameters.delete(key);
    }
    const query = parameters.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }

  function changeSearch(nextSearch: string) {
    setSearch(nextSearch);
    preserveFilterContext({ medium, search: nextSearch, status });
  }

  function changeStatus(nextStatus: OutreachStatus | "all") {
    setStatus(nextStatus);
    preserveFilterContext({ medium, search, status: nextStatus });
  }

  function changeMedium(nextMedium: OutreachMedium | "all") {
    setMedium(nextMedium);
    preserveFilterContext({ medium: nextMedium, search, status });
  }

  function clearFilters() {
    setSearch("");
    setStatus("all");
    setMedium("all");
    preserveFilterContext({ medium: "all", search: "", status: "all" });
  }

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
      const { data } = await apiMutate<{ message: OutreachMessageWithProspect["message"] }>(
        "PATCH",
        `/outreach/messages/${item.message.id}`,
        { status: nextStatus },
      );
      const updated = data.message;
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

  function openEdit(item: OutreachMessageWithProspect) {
    setPendingEdit(item);
    setEditSubject(item.message.subject ?? "");
    setEditContent(item.message.content);
  }

  async function saveEdit() {
    if (!pendingEdit || !editContent.trim() || editBusyRef.current) return;
    editBusyRef.current = true;
    setEditBusy(true);
    try {
      const { data } = await apiMutate<{ message: OutreachMessageWithProspect["message"] }>(
        "PATCH",
        `/outreach/messages/${pendingEdit.message.id}`,
        { subject: editSubject.trim(), content: editContent.trim() },
      );
      setMessages((current) => current.map((entry) => (
        entry.message.id === data.message.id
          ? { ...entry, message: data.message }
          : entry
      )));
      setPendingEdit(null);
      toast.success("Draft changes saved");
    } catch {
      toast.error("Could not save the draft. Your edits are still here.");
    } finally {
      editBusyRef.current = false;
      setEditBusy(false);
    }
  }

  async function deleteMessage(item: OutreachMessageWithProspect) {
    setBusyId(item.message.id);
    try {
      await apiMutate("DELETE", `/outreach/messages/${item.message.id}`, { confirm: true });
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
                  onClick={clearFilters}
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
                changeStatus(value as OutreachStatus | "all")
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
                changeMedium(value as OutreachMedium | "all")
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
        onSearchChange={changeSearch}
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
                    icon: Pencil,
                    label: `Edit message for ${prospect.name}`,
                    onSelect: () => openEdit(item),
                  },
                  {
                    icon: copiedId === message.id ? Check : Clipboard,
                    label:
                      copiedId === message.id ? "Copied" : "Copy message",
                    onSelect: () =>
                      void copyMessage(message.id, message.content),
                  },
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
          if (!open && !editBusy) setPendingEdit(null);
        }}
        open={Boolean(pendingEdit)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit outreach draft</DialogTitle>
            <DialogDescription>
              Review the subject and message for {pendingEdit?.prospect.name}. Saving changes updates the shared review queue without delivering anything.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="outreach-draft-subject">Subject</Label>
              <Input
                disabled={editBusy}
                id="outreach-draft-subject"
                maxLength={1_000}
                onChange={(event) => setEditSubject(event.target.value)}
                value={editSubject}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="outreach-draft-content">Message</Label>
              <Textarea
                disabled={editBusy}
                id="outreach-draft-content"
                maxLength={100_000}
                onChange={(event) => setEditContent(event.target.value)}
                rows={10}
                value={editContent}
              />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={editBusy} onClick={() => setPendingEdit(null)} variant="outline">
              Cancel
            </Button>
            <Button disabled={editBusy || !editContent.trim()} onClick={() => void saveEdit()}>
              {editBusy ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
