"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, RotateCcw, XCircle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { apiGet, apiMutate } from "@content-automation/platform/network/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListRow, ListRows } from "@/components/ListRow";
import { FilterSelect, ListSurface } from "@/components/ListSurface";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

interface CalendarPost {
  id: string;
  draftId: string | null;
  draftTitle: string | null;
  destination: string;
  channelName: string;
  status: "scheduled" | "publishing" | "published" | "failed" | "cancelled";
  publishAt: string;
  attempts: number;
  resultUrl: string | null;
  error: string | null;
}

const STATUS_VARIANT: Record<CalendarPost["status"], "default" | "secondary" | "destructive" | "outline"> = {
  published: "default",
  publishing: "secondary",
  scheduled: "secondary",
  failed: "destructive",
  cancelled: "outline",
};

/** §8 calendar recipe: status dots carry the only color meaning on chips. */
const STATUS_DOT: Record<CalendarPost["status"], string> = {
  published: "bg-chart-2",
  publishing: "bg-muted-foreground",
  scheduled: "bg-muted-foreground",
  failed: "bg-destructive",
  cancelled: "bg-border",
};

const DESTINATION_LABEL: Record<string, string> = {
  youtube: "YouTube",
  x: "X",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  cms: "CMS",
  webhook: "Webhook",
};

function destinationLabel(destination: string): string {
  return DESTINATION_LABEL[destination] ?? destination;
}

function postLabel(post: CalendarPost): string {
  return post.draftTitle ?? destinationLabel(post.destination);
}

export default function PublishingCalendarPage() {
  const [queue, setQueue] = useState<CalendarPost[]>([]);
  const [history, setHistory] = useState<CalendarPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [upcomingQuery, setUpcomingQuery] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyStatus, setHistoryStatus] = useState<"all" | CalendarPost["status"]>("all");

  const load = useCallback(async (silent = false) => {
    try {
      const data = await apiGet<{ queue?: CalendarPost[]; history?: CalendarPost[] }>("/publishing");
      setQueue(data.queue ?? []);
      setHistory(data.history ?? []);
    } catch {
      if (!silent) toast.error("Could not load the publishing schedule. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const act = useCallback(
    async (action: "cancel" | "retry", postId: string) => {
      setPendingAction(postId);
      setConfirmCancelId(null);
      try {
        await apiMutate(
          "POST",
          `/publishing/posts/${postId}/${action}`,
          action === "cancel" ? { confirm: true } : undefined,
        );
        toast.success(action === "cancel" ? "Post cancelled" : "Post requeued");
        await load(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Could not ${action} the post`);
      } finally {
        setPendingAction(null);
      }
    },
    [load],
  );

  const allPosts = useMemo(() => [...queue, ...history], [queue, history]);

  const weeks = useMemo(() => {
    const first = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const last = endOfMonth(month);
    const rows: Date[][] = [];
    let cursor = first;
    while (isBefore(cursor, last) || isSameDay(cursor, last)) {
      rows.push(Array.from({ length: 7 }, (_, d) => addDays(cursor, d)));
      cursor = addDays(cursor, 7);
    }
    return rows;
  }, [month]);

  const postsOn = useCallback(
    (day: Date) => allPosts.filter((p) => isSameDay(new Date(p.publishAt), day)),
    [allPosts],
  );

  const failedCount = history.filter((p) => p.status === "failed").length;
  const matchesQuery = useCallback((post: CalendarPost, query: string) => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return true;
    return [
      postLabel(post),
      destinationLabel(post.destination),
      post.channelName,
      post.status,
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  }, []);
  const filteredQueue = useMemo(
    () => queue.filter((post) => matchesQuery(post, upcomingQuery)),
    [matchesQuery, queue, upcomingQuery],
  );
  const filteredHistory = useMemo(
    () => history.filter(
      (post) =>
        (historyStatus === "all" || post.status === historyStatus) &&
        matchesQuery(post, historyQuery),
    ),
    [history, historyQuery, historyStatus, matchesQuery],
  );
  const hasHistoryFilters = historyQuery.trim().length > 0 || historyStatus !== "all";

  const clearHistoryFilters = () => {
    setHistoryQuery("");
    setHistoryStatus("all");
  };

  return (
    <div className="w-full min-w-0 space-y-8">
      <PageHeader
        title="Calendar"
        description="What goes out when — scheduled posts on their future dates, published posts where they landed."
      />

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{format(month, "MMMM yyyy")}</h2>
        <div className="flex items-center gap-2">
          <Button aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))} size="icon" variant="outline">
            <ChevronLeft className="size-4" />
          </Button>
          <Button onClick={() => setMonth(startOfMonth(new Date()))} variant="outline">
            Today
          </Button>
          <Button aria-label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))} size="icon" variant="outline">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden py-0">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid grid-cols-7 gap-2 p-4">
              {Array.from({ length: 35 }, (_, i) => (
                <Skeleton className="h-24" key={i} />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[840px]">
                <div className="grid grid-cols-7 border-b">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                    <div className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground" key={d}>
                      {d}
                    </div>
                  ))}
                </div>
                {weeks.map((week, wi) => (
                  <div className="grid grid-cols-7 border-b last:border-b-0" key={wi}>
                    {week.map((day) => {
                      const posts = postsOn(day);
                      const inMonth = isSameMonth(day, month);
                      return (
                        <div
                          className={`min-h-28 border-r px-3 py-2 last:border-r-0 ${inMonth ? "" : "bg-muted/30"}`}
                          key={day.toISOString()}
                        >
                          <span
                            className={`inline-grid size-6 place-items-center rounded-full text-xs ${
                              isToday(day)
                                ? "font-semibold text-foreground ring-1 ring-primary"
                                : inMonth
                                  ? "text-foreground"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {format(day, "d")}
                          </span>
                          <div className="mt-1 space-y-0.5">
                            {posts.slice(0, 3).map((post) => (
                              <Link
                                className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs transition-colors hover:bg-accent"
                                href={post.draftId ? `/content/drafts/${post.draftId}` : "/content/calendar"}
                                key={post.id}
                                title={`${postLabel(post)} — ${destinationLabel(post.destination)} · ${post.status} · ${format(new Date(post.publishAt), "PPp")}`}
                              >
                                <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[post.status]}`} />
                                <span className="truncate">
                                  <span className="text-muted-foreground">{format(new Date(post.publishAt), "HH:mm")}</span>{" "}
                                  <span className="text-foreground">{postLabel(post)}</span>
                                </span>
                              </Link>
                            ))}
                            {posts.length > 3 && (
                              <p className="px-1 text-[11px] text-muted-foreground">+{posts.length - 3} more</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ListSurface
        count={filteredQueue.length}
        description="Scheduled posts the engine will send, soonest first."
        emptyState={
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <CalendarDays className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">
              {upcomingQuery ? "No scheduled posts match your search" : "Nothing scheduled"}
            </p>
            <p className="text-sm text-muted-foreground">
              {upcomingQuery
                ? "Try another title, channel, or destination."
                : "Schedule a ready Post and it appears here."}
            </p>
            {upcomingQuery ? (
              <Button onClick={() => setUpcomingQuery("")} size="sm" variant="outline">
                Clear search
              </Button>
            ) : null}
          </div>
        }
        isLoading={loading}
        onSearchChange={setUpcomingQuery}
        searchPlaceholder="Search scheduled posts…"
        searchValue={upcomingQuery}
        title="Upcoming"
      >
        {!loading && filteredQueue.length > 0 ? (
          <ListRows>
            {filteredQueue.map((post) => (
              <ListRow
                actions={[{
                  destructive: true,
                  disabled: pendingAction === post.id,
                  icon: XCircle,
                  label: `Cancel ${postLabel(post)}`,
                  onSelect: () => setConfirmCancelId(post.id),
                }]}
                badge={<Badge variant="secondary">Scheduled</Badge>}
                href={post.draftId ? `/content/drafts/${post.draftId}` : undefined}
                key={post.id}
                meta={[
                  destinationLabel(post.destination),
                  post.channelName,
                  <span key="publish-at" title={format(new Date(post.publishAt), "PPpp")}>
                    {format(new Date(post.publishAt), "PPp")}
                  </span>,
                ]}
                title={postLabel(post)}
              />
            ))}
          </ListRows>
        ) : null}
      </ListSurface>

      <ListSurface
        count={filteredHistory.length}
        description={`What actually went out, newest first${failedCount > 0 ? ` — ${failedCount} failed` : ""}.`}
        emptyState={
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <CalendarDays className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">
              {hasHistoryFilters ? "No history matches these filters" : "No posts have gone out yet"}
            </p>
            <p className="text-sm text-muted-foreground">
              {hasHistoryFilters
                ? "Try another search or publishing status."
                : "Published, failed, and cancelled posts will appear here."}
            </p>
            {hasHistoryFilters ? (
              <Button onClick={clearHistoryFilters} size="sm" variant="outline">
                Clear filters
              </Button>
            ) : null}
          </div>
        }
        filters={
          <>
            <FilterSelect
              label="Status"
              onValueChange={(value) => setHistoryStatus(value as "all" | CalendarPost["status"])}
              options={[
                { label: "All statuses", value: "all" },
                { label: "Published", value: "published" },
                { label: "Publishing", value: "publishing" },
                { label: "Failed", value: "failed" },
                { label: "Cancelled", value: "cancelled" },
              ]}
              value={historyStatus}
            />
            {hasHistoryFilters ? (
              <Button onClick={clearHistoryFilters} size="sm" variant="ghost">
                Clear
              </Button>
            ) : null}
          </>
        }
        isLoading={loading}
        onSearchChange={setHistoryQuery}
        searchPlaceholder="Search publishing history…"
        searchValue={historyQuery}
        title="History"
      >
        {!loading && filteredHistory.length > 0 ? (
          <ListRows>
            {filteredHistory.map((post) => (
              <ListRow
                actions={[
                  ...(post.resultUrl ? [{
                    external: true,
                    href: post.resultUrl,
                    icon: ExternalLink,
                    label: "View published post",
                  }] : []),
                  ...((post.status === "failed" || post.status === "cancelled") ? [{
                    disabled: pendingAction === post.id,
                    icon: RotateCcw,
                    label: `Retry ${postLabel(post)}`,
                    onSelect: () => void act("retry", post.id),
                  }] : []),
                ]}
                badge={<Badge variant={STATUS_VARIANT[post.status]}>{post.status}</Badge>}
                href={post.draftId ? `/content/drafts/${post.draftId}` : undefined}
                key={post.id}
                meta={[
                  destinationLabel(post.destination),
                  post.channelName,
                  <span key="publish-at" title={format(new Date(post.publishAt), "PPpp")}>
                    {format(new Date(post.publishAt), "PPp")}
                  </span>,
                  ...(post.error ? [<span className="text-destructive" key="error">{post.error}</span>] : []),
                ]}
                title={postLabel(post)}
              />
            ))}
          </ListRows>
        ) : null}
      </ListSurface>

      <Dialog onOpenChange={(open) => { if (!open) setConfirmCancelId(null); }} open={confirmCancelId !== null}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel scheduled post</DialogTitle>
            <DialogDescription>The post will not be sent. It can be requeued later from history.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmCancelId(null)} variant="outline">Keep it scheduled</Button>
            <Button onClick={() => confirmCancelId && void act("cancel", confirmCancelId)} variant="destructive">Cancel post</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
