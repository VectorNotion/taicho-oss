"use client";

import { useCallback, useEffect, useState } from "react";
import { AlarmClock, Check, CheckCircle2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ListCard } from "@/components/ListCard";
import { ListRow, ListRows } from "@/components/ListRow";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ActionItem } from "@/products/outreach/domain/action-items";
import { groupByDue } from "@/products/outreach/domain/action-item-view";
import { DueBadge } from "@/products/outreach/ui/components/action-items/DueBadge";

type DueItem = ActionItem & {
  prospect: { id: string; name: string; company?: string; status: string } | null;
};

function snoozeDueAt(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}

/** Count chip on a tab trigger; hidden at zero so empty buckets stay quiet. */
function TabCount({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
      {n}
    </span>
  );
}

export function DueActionsCard() {
  const [items, setItems] = useState<DueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/outreach/action-items?horizonDays=90");
      if (!response.ok) throw new Error("Failed to load action items");
      const data = await response.json();
      setItems(data.items as DueItem[]);
      setFailed(false);
    } catch (error) {
      console.error("Error loading due actions:", error);
      setFailed(true);
      toast.error("Could not load due actions — refresh to try again");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const complete = async (id: string) => {
    try {
      const response = await fetch(`/api/outreach/action-items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
      if (!response.ok) throw new Error("Failed to complete action item");
      toast.success("Action completed");
      await refresh();
    } catch (error) {
      console.error("Error completing action item:", error);
      toast.error("Could not complete the action");
    }
  };

  const snooze = async (id: string) => {
    try {
      const response = await fetch(`/api/outreach/action-items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueAt: snoozeDueAt(3) }),
      });
      if (!response.ok) throw new Error("Failed to snooze action item");
      toast.success("Snoozed 3 days");
      await refresh();
    } catch (error) {
      console.error("Error snoozing action item:", error);
      toast.error("Could not snooze the action");
    }
  };

  const dismiss = async (id: string) => {
    try {
      const response = await fetch(`/api/outreach/action-items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });
      if (!response.ok) throw new Error("Failed to dismiss action item");
      toast.success("Dismissed");
      await refresh();
    } catch (error) {
      console.error("Error dismissing action item:", error);
      toast.error("Could not dismiss the action");
    }
  };

  const groups = groupByDue(items, new Date());
  const defaultTab = groups.today.length
    ? "today"
    : groups.overdue.length
      ? "past"
      : "upcoming";

  const renderRow = (item: DueItem) => {
    // A prospect id that no longer resolves means the target is gone (deleted
    // outside the app, reseeded dev data): the item is unactionable, so offer
    // dismissal instead of snooze.
    const orphaned = Boolean(item.prospectId) && !item.prospect;
    return (
      <ListRow
        actions={
          orphaned
            ? [{
                destructive: true,
                icon: X,
                label: "Dismiss — prospect no longer exists",
                onSelect: () => void dismiss(item.id),
              }]
            : [
                { label: "Done", icon: Check, onSelect: () => void complete(item.id) },
                { label: "Snooze 3 days", icon: AlarmClock, onSelect: () => void snooze(item.id) },
              ]
        }
        badge={<DueBadge dueAt={item.dueAt} />}
        href={item.prospect ? `/outreach/prospects/${item.prospect.id}` : undefined}
        key={item.id}
        meta={[
          item.prospect
            ? [item.prospect.name, item.prospect.company].filter(Boolean).join(" · ")
            : orphaned
              ? "Prospect no longer exists — dismiss this item"
              : "Not linked to a prospect",
        ]}
        title={item.title}
      />
    );
  };

  const renderBucket = (rows: DueItem[], emptyText: string) =>
    rows.length === 0 ? (
      <div className="px-6 py-12 text-center text-sm text-muted-foreground">{emptyText}</div>
    ) : (
      <ListRows className="pb-2">{rows.map(renderRow)}</ListRows>
    );

  return (
    <ListCard
      description="Follow-ups due today, overdue, and coming up."
      title="Due"
    >
      {loading ? (
        <ListRows>
          {Array.from({ length: 5 }).map((_, index) => (
            <li className="px-6 py-3.5" key={index}>
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-2 h-3 w-1/4" />
            </li>
          ))}
        </ListRows>
      ) : failed && items.length === 0 ? (
        <div className="grid min-h-56 place-items-center px-6 text-center">
          <div className="max-w-sm">
            <p className="font-medium">Due actions didn&apos;t load</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Something went wrong while fetching your action items.
            </p>
            <Button
              className="mt-4"
              onClick={() => {
                setLoading(true);
                void refresh();
              }}
              size="sm"
              variant="outline"
            >
              <RefreshCw className="size-3.5" />
              Try again
            </Button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="grid min-h-56 place-items-center px-6 text-center">
          <div className="max-w-sm">
            <CheckCircle2 className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 font-medium">All caught up</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Action items appear here as you contact prospects or set
              follow-ups on their pages.
            </p>
          </div>
        </div>
      ) : (
        <Tabs defaultValue={defaultTab}>
          <div className="px-6 py-3">
            <TabsList>
              <TabsTrigger value="today">
                Today
                <TabCount n={groups.today.length} />
              </TabsTrigger>
              <TabsTrigger value="past">
                Past
                <TabCount n={groups.overdue.length} />
              </TabsTrigger>
              <TabsTrigger value="upcoming">
                Upcoming
                <TabCount n={groups.upcoming.length} />
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="today">
            {renderBucket(groups.today, "Nothing due today.")}
          </TabsContent>
          <TabsContent value="past">
            {renderBucket(groups.overdue, "Nothing overdue — you're clear.")}
          </TabsContent>
          <TabsContent value="upcoming">
            {renderBucket(groups.upcoming, "Nothing scheduled ahead.")}
          </TabsContent>
        </Tabs>
      )}
    </ListCard>
  );
}
