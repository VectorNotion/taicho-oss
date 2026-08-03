"use client";

import { useState } from "react";
import { ArrowLeft, Copy, GitBranch, Pause, Pencil, Plus, Share2, Trash2 } from "lucide-react";
import { ListRow, ListRows } from "@/components/ListRow";
import { FilterSelect, ListSurface } from "@/components/ListSurface";
import { StatRow, type Stat } from "@/components/StatRow";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DemoFrame, Section, Spec } from "../../components/section";

const STATS: Stat[] = [
  { label: "Total leads", value: "94", delta: "+11", direction: "up", trend: [61, 68, 72, 79, 83, 88, 94] },
  { label: "Active enrollments", value: "536", delta: "no change", direction: "flat", trend: [534, 538, 535, 537, 536, 535, 536] },
  { label: "Interest clicks", value: "41", delta: "−6", direction: "down", trend: [58, 52, 55, 49, 47, 44, 41] },
  { label: "Published this month", value: "12", delta: "+4", direction: "up", featured: true, trend: [4, 6, 5, 8, 7, 9, 12] },
];

/** Fixed sample week for the calendar recipe demo — no live data needed. */
const CALENDAR_WEEK = [
  { day: "20", today: true, posts: [{ time: "08:37", label: "Launch recap", dot: "bg-chart-2" }] },
  { day: "21", posts: [] },
  { day: "22", posts: [{ time: "09:00", label: "Feature deep-dive", dot: "bg-muted-foreground" }] },
  { day: "23", posts: [{ time: "10:15", label: "Customer story", dot: "bg-muted-foreground" }, { time: "16:00", label: "Weekly short", dot: "bg-destructive" }] },
  { day: "24", posts: [] },
  { day: "25", posts: [] },
  { day: "26", posts: [] },
];

type ListState = "loaded" | "loading" | "empty";

/* Deterministic browse dataset — index math only, so SSR and client agree. */
const FUNNEL_NAMES = ["Onboarding", "Newsletter", "Discovery", "Re-engagement", "Launch follow-up", "Trial nurture", "Webinar invite"];
const BROWSE_RECORDS = Array.from({ length: 42 }, (_, index) => {
  const status = index % 3 === 2 ? "draft" : "active";
  const type = index % 2 === 0 ? "sequence" : "queue";
  const activeCount = ((index * 7) % 90) + 4;
  const updatedHours = (index % 22) + 1;
  return {
    id: `funnel-${index + 1}`,
    name: `${FUNNEL_NAMES[index % FUNNEL_NAMES.length]} ${Math.floor(index / FUNNEL_NAMES.length) + 1}`,
    status,
    type,
    activeCount,
    updatedHours,
    meta: [type === "sequence" ? "sequence" : "open-ended queue", `${activeCount} active`, `updated ${updatedHours}h ago`],
  };
});
const PAGE_SIZE = 12;

export default function PatternsPage() {
  const [listState, setListState] = useState<ListState>("loaded");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "draft">("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortBy, setSortBy] = useState("recent");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  const filtered = BROWSE_RECORDS.filter(
    (record) =>
      (statusFilter === "all" || record.status === statusFilter) &&
      (typeFilter === "all" || record.type === typeFilter) &&
      record.name.toLowerCase().includes(query.trim().toLowerCase()),
  ).sort((a, b) =>
    sortBy === "name" ? a.name.localeCompare(b.name) : sortBy === "active" ? b.activeCount - a.activeCount : a.updatedHours - b.updatedHours,
  );
  const shown = filtered.slice(0, visible);

  const loadMore = () => {
    if (loadingMore) return;
    setLoadingMore(true);
    setTimeout(() => {
      setVisible((value) => value + PAGE_SIZE);
      setLoadingMore(false);
    }, 450);
  };

  const setFilter = (next: "all" | "active" | "draft") => {
    setStatusFilter(next);
    setVisible(PAGE_SIZE);
  };

  return (
    <div className="w-full min-w-0 space-y-12">
      <PageHeader
        title="Patterns"
        description="The §8 structural recipes rendered live. Identical constructs use identical markup — these are the constructs."
      />

      <Section title="Page header" description="Every page opens with PageHeader: noun-phrase title, one-sentence description, 0–2 primary actions.">
        <DemoFrame>
          <PageHeader
            title="Funnels"
            description="Sequences and open-ended queues your leads move through."
            actions={<Button><Plus className="h-4 w-4" /> New funnel</Button>}
          />
        </DemoFrame>
      </Section>

      <Section
        title="List surface"
        description="One integrated component owns the whole browse loop: search in the header band (press / to focus), one filter row, ListRows, and infinite scroll via a sentinel — record collections never paginate. Try searching, filtering, and scrolling the 42-record set:"
      >
        <Tabs onValueChange={(v) => setListState(v as ListState)} value={listState}>
          <TabsList>
            <TabsTrigger value="loaded">Loaded</TabsTrigger>
            <TabsTrigger value="loading">Loading</TabsTrigger>
            <TabsTrigger value="empty">Empty</TabsTrigger>
          </TabsList>
        </Tabs>
        <ListSurface
          count={listState === "empty" ? 0 : filtered.length}
          description="Sequences and open-ended queues your leads move through."
          emptyState={
            <div className="flex flex-col items-center gap-2 p-10">
              <GitBranch className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {listState !== "empty" && query
                  ? `No funnels match “${query}”.`
                  : "No funnels yet. Sequences and open-ended queues you create appear here."}
              </p>
              {listState !== "empty" && query ? (
                <Button onClick={() => setQuery("")} variant="outline">Clear search</Button>
              ) : (
                <Button variant="outline"><Plus className="h-4 w-4" /> New funnel</Button>
              )}
            </div>
          }
          filters={
            <>
              {(["all", "active", "draft"] as const).map((option) => (
                <Button
                  key={option}
                  onClick={() => setFilter(option)}
                  size="sm"
                  variant={statusFilter === option ? "secondary" : "ghost"}
                >
                  {option === "all" ? "All" : option === "active" ? "Active" : "Draft"}
                </Button>
              ))}
              <FilterSelect
                label="Type"
                onValueChange={(value) => {
                  setTypeFilter(value);
                  setVisible(PAGE_SIZE);
                }}
                options={[
                  { value: "all", label: "All types" },
                  { value: "sequence", label: "Sequence" },
                  { value: "queue", label: "Open-ended queue" },
                ]}
                value={typeFilter}
              />
              <FilterSelect
                label="Sort"
                onValueChange={setSortBy}
                options={[
                  { value: "recent", label: "Recently updated" },
                  { value: "name", label: "Name" },
                  { value: "active", label: "Most active" },
                ]}
                value={sortBy}
              />
            </>
          }
          hasMore={listState === "loaded" && visible < filtered.length}
          isLoading={listState === "loading"}
          isLoadingMore={loadingMore}
          maxHeightClassName="max-h-96"
          onLoadMore={loadMore}
          onSearchChange={setQuery}
          searchPlaceholder="Search funnels…"
          searchValue={query}
          title="Funnels"
        >
          {listState !== "empty" && shown.length > 0 ? (
            <ListRows>
              {shown.map((record, index) => (
                <ListRow
                  actions={
                    index % 4 === 3
                      ? [
                          { label: "Edit", icon: Pencil },
                          { label: "Duplicate", icon: Copy },
                          { label: "Share", icon: Share2 },
                          { label: "Pause", icon: Pause },
                          { label: "Delete", icon: Trash2, destructive: true },
                        ]
                      : [
                          { label: "Edit", icon: Pencil },
                          { label: "Duplicate", icon: Copy },
                        ]
                  }
                  badge={<Badge variant={record.status === "active" ? "default" : "secondary"}>{record.status}</Badge>}
                  href="#"
                  key={record.id}
                  meta={record.meta}
                  title={record.name}
                />
              ))}
            </ListRows>
          ) : null}
        </ListSurface>
        <Spec>
          ListSurface owns the browse anatomy: search right of the title (/ focuses it), filters in one row, infinite scroll at a sentinel with skeleton
          loading-more rows, and a quiet “All caught up” terminal line. ListRow rules unchanged: identity line, meta under it, tinted icon actions with ⋯ overflow.
        </Spec>
      </Section>

      <Section
        title="Stat row"
        description="StatRow owns the tile anatomy: label, value, delta chip (icon + ink — never color alone), a sparkline with an emphasized endpoint, and at most one featured tile per row on the resting tint. Tiles cascade in with a 75ms stagger."
      >
        <StatRow stats={STATS} />
      </Section>

      <Section title="Detail page top" description="Back link in the recipe's exact markup, then PageHeader with the record's actions.">
        <DemoFrame>
          <span className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" /> All funnels
          </span>
          <PageHeader
            title="Enterprise cadence (day 1-7-10-15)"
            actions={
              <div className="flex items-center gap-2">
                <Badge variant="outline">sequence</Badge>
                <Button variant="destructive"><Trash2 className="h-4 w-4" /> Delete funnel</Button>
              </div>
            }
          />
        </DemoFrame>
      </Section>

      <Section
        title="Calendar surface"
        description="Full-bleed month grid. Chips are neutral; the status dot carries the only color: positive, pending, failed. Today is a ring, never a filled circle."
      >
        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="p-0">
            <div className="grid grid-cols-7 border-b">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div className="px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground" key={d}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {CALENDAR_WEEK.map((cell) => (
                <div className="min-h-28 border-r px-3 py-2 last:border-r-0" key={cell.day}>
                  <span className={`inline-grid size-6 place-items-center rounded-full text-xs ${cell.today ? "font-semibold text-foreground ring-1 ring-primary" : "text-foreground"}`}>
                    {cell.day}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {cell.posts.map((post) => (
                      <span className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs transition-colors hover:bg-accent" key={post.label}>
                        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${post.dot}`} />
                        <span className="truncate">
                          <span className="text-muted-foreground">{post.time}</span>{" "}
                          <span className="text-foreground">{post.label}</span>
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Content section" description="Detail pages compose sections: CardHeader with title and one-sentence description, then content.">
        <Card>
          <CardHeader>
            <CardTitle>Routing</CardTitle>
            <CardDescription>Where leads go on completion or an interest click.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Section content composes any other pattern — forms, tables, stat rows.</p>
          </CardContent>
        </Card>
      </Section>

      <Section title="Voice" description="Buttons say verb + object. Errors say what happened and what to do. Nothing shouts.">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="space-y-2 p-6 text-sm">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Do</p>
              <p>“Create funnel” · “Save changes” · “Delete note”</p>
              <p>“Could not load channels. Refresh to try again.”</p>
              <p>“No posts have gone out yet.”</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2 p-6 text-sm text-muted-foreground">
              <p className="text-xs font-medium uppercase tracking-wider">Don&apos;t</p>
              <p className="line-through">“Submit” · “OK” · “Confirm action”</p>
              <p className="line-through">“Error!” · “Something went wrong!”</p>
              <p className="line-through">“Oops! Nothing here yet 🎉”</p>
            </CardContent>
          </Card>
        </div>
      </Section>
    </div>
  );
}
