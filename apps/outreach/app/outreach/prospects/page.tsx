"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  AlarmClock,
  FileCheck2,
  Loader2,
  Pencil,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiMutate } from "@content-automation/platform/network/api-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListRow, ListRows } from "@/components/ListRow";
import { ListSurface } from "@/components/ListSurface";
import { PageHeader } from "@/components/PageHeader";
import { StatRow } from "@/components/StatRow";
import {
  PROSPECT_PRIORITY_CONFIG,
  PROSPECT_SOURCE_CONFIG,
  PROSPECT_STATUS_CONFIG,
  type Prospect,
  type ProspectPriority,
  type ProspectLifecycle,
  type ProspectSource,
  type ProspectStatus,
} from "@/products/outreach/domain/types";
import { DueBadge } from "@/products/outreach/ui/components/action-items/DueBadge";
import type { CatalogItem } from "@/products/outreach/domain/catalog";
import type { QualificationStatus } from "@/products/outreach/domain/qualification";

type ProspectListResponse = {
  items: Prospect[];
  total: number;
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
  counts: {
    total: number;
    byStatus: Record<string, number>;
    byLifecycle: Record<string, number>;
  };
};

const LIFECYCLE_LABELS: Record<ProspectLifecycle, string> = {
  untouched: "Untouched",
  researched: "Researched",
  draft_ready: "Draft ready",
  follow_up_scheduled: "Follow-up scheduled",
  contacted: "Contacted",
  replied: "Replied",
};

const QUALIFICATION_BADGES: Record<QualificationStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  QUALIFIED: { label: "Qualified fit", variant: "default" },
  UNQUALIFIED: { label: "Unqualified fit", variant: "secondary" },
  REVIEW: { label: "Fit needs review", variant: "outline" },
  HARD_EXCLUDED: { label: "Hard excluded", variant: "destructive" },
  CONTACT_DISCOVERY_REQUIRED: { label: "Find another person", variant: "outline" },
};

const PROSPECT_STATUSES = new Set<ProspectStatus>(
  Object.keys(PROSPECT_STATUS_CONFIG) as ProspectStatus[],
);
const PROSPECT_PRIORITIES = new Set<ProspectPriority>(
  Object.keys(PROSPECT_PRIORITY_CONFIG) as ProspectPriority[],
);
const PROSPECT_SOURCES = new Set<ProspectSource>(
  Object.keys(PROSPECT_SOURCE_CONFIG) as ProspectSource[],
);
const PROSPECT_LIFECYCLES = new Set<ProspectLifecycle>(
  Object.keys(LIFECYCLE_LABELS) as ProspectLifecycle[],
);

function valueFromUrl<T extends string>(
  value: string | null,
  allowed: ReadonlySet<T>,
): T | "all" {
  return value && allowed.has(value as T) ? value as T : "all";
}

async function fetchProspectList(filters: {
  status: ProspectStatus | "all";
  source: ProspectSource | "all";
  priority: ProspectPriority | "all";
  search: string;
  cursor?: string;
  pageSize: number;
  lifecycle: ProspectLifecycle | "all";
  catalogItemId: string | "all";
}, signal?: AbortSignal): Promise<ProspectListResponse> {
  return apiGet<ProspectListResponse>("/outreach/prospects", {
    status: filters.status === "all" ? undefined : filters.status,
    source: filters.source === "all" ? undefined : filters.source,
    priority: filters.priority === "all" ? undefined : filters.priority,
    search: filters.search || undefined,
    lifecycle: filters.lifecycle === "all" ? undefined : filters.lifecycle,
    catalogItemId: filters.catalogItemId === "all" ? undefined : filters.catalogItemId,
    cursor: filters.cursor,
    limit: filters.pageSize,
  }, { signal });
}

export default function PipelinePage() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [statusFilter, setStatusFilter] = useState<ProspectStatus | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<ProspectSource | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<ProspectPriority | "all">(
    "all",
  );
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [lifecycleCounts, setLifecycleCounts] = useState<Record<string, number>>({});
  const [lifecycleFilter, setLifecycleFilter] = useState<ProspectLifecycle | "all">("all");
  const [catalogFilter, setCatalogFilter] = useState("all");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Prospect | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filterContextReady, setFilterContextReady] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const loadMoreGeneration = useRef(0);

  const replaceFilterContext = useCallback((next: {
    catalogItemId: string;
    lifecycle: ProspectLifecycle | "all";
    pageSize: number;
    priority: ProspectPriority | "all";
    search: string;
    source: ProspectSource | "all";
    status: ProspectStatus | "all";
  }) => {
    const parameters = new URLSearchParams(window.location.search);
    const values = {
      q: next.search,
      status: next.status === "all" ? "" : next.status,
      source: next.source === "all" ? "" : next.source,
      priority: next.priority === "all" ? "" : next.priority,
      lifecycle: next.lifecycle === "all" ? "" : next.lifecycle,
      catalogItemId: next.catalogItemId === "all" ? "" : next.catalogItemId,
      limit: next.pageSize > 50 ? String(next.pageSize) : "",
    };
    for (const [key, value] of Object.entries(values)) {
      if (value) parameters.set(key, value);
      else parameters.delete(key);
    }
    const query = parameters.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, []);

  useEffect(() => {
    function restoreFilterContext() {
      const parameters = new URLSearchParams(window.location.search);
      const next = {
        search: parameters.get("q") ?? "",
        status: valueFromUrl(parameters.get("status"), PROSPECT_STATUSES),
        source: valueFromUrl(parameters.get("source"), PROSPECT_SOURCES),
        priority: valueFromUrl(parameters.get("priority"), PROSPECT_PRIORITIES),
        lifecycle: valueFromUrl(parameters.get("lifecycle"), PROSPECT_LIFECYCLES),
        catalogItemId: parameters.get("catalogItemId")?.trim() || "all",
        pageSize: parameters.get("limit") === "100" ? 100 : 50,
      };
      setSearchQuery(next.search);
      setStatusFilter(next.status);
      setSourceFilter(next.source);
      setPriorityFilter(next.priority);
      setLifecycleFilter(next.lifecycle);
      setCatalogFilter(next.catalogItemId);
      setPageSize(next.pageSize);
      replaceFilterContext(next);
      setFilterContextReady(true);
    }

    restoreFilterContext();
    window.addEventListener("popstate", restoreFilterContext);
    return () => window.removeEventListener("popstate", restoreFilterContext);
  }, [replaceFilterContext]);

  useEffect(() => {
    void apiGet<{ items: CatalogItem[] }>("/outreach/catalog")
      .then(({ items }) => setCatalog(items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!filterContextReady) return;
    let cancelled = false;
    const controller = new AbortController();
    loadMoreGeneration.current += 1;
    setLoading(true);
    setLoadingMore(false);
    void fetchProspectList({
      status: statusFilter,
      source: sourceFilter,
      priority: priorityFilter,
      search: deferredSearchQuery,
      pageSize,
      lifecycle: lifecycleFilter,
      catalogItemId: catalogFilter,
    }, controller.signal)
      .then((data) => {
        if (cancelled) return;
        setProspects(data.items);
        setNextCursor(data.pagination.nextCursor);
        setTotal(data.total);
        setLifecycleCounts(data.counts.byLifecycle);
      })
      .catch((error) => {
        if (cancelled || controller.signal.aborted) return;
        console.error("Error fetching Outreach pipeline:", error);
        toast.error("Could not load the pipeline. Refresh to try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    deferredSearchQuery,
    priorityFilter,
    sourceFilter,
    statusFilter,
    lifecycleFilter,
    catalogFilter,
    filterContextReady,
    pageSize,
  ]);

  function changeFilters(next: Partial<{
    catalogItemId: string;
    lifecycle: ProspectLifecycle | "all";
    priority: ProspectPriority | "all";
    search: string;
    source: ProspectSource | "all";
    status: ProspectStatus | "all";
  }>) {
    const values = {
      catalogItemId: next.catalogItemId ?? catalogFilter,
      lifecycle: next.lifecycle ?? lifecycleFilter,
      pageSize: 50,
      priority: next.priority ?? priorityFilter,
      search: next.search ?? searchQuery,
      source: next.source ?? sourceFilter,
      status: next.status ?? statusFilter,
    };
    if (next.catalogItemId !== undefined) setCatalogFilter(next.catalogItemId);
    if (next.lifecycle !== undefined) setLifecycleFilter(next.lifecycle);
    if (next.priority !== undefined) setPriorityFilter(next.priority);
    if (next.search !== undefined) setSearchQuery(next.search);
    if (next.source !== undefined) setSourceFilter(next.source);
    if (next.status !== undefined) setStatusFilter(next.status);
    setPageSize(50);
    replaceFilterContext(values);
  }

  function clearFilters() {
    changeFilters({
      catalogItemId: "all",
      lifecycle: "all",
      priority: "all",
      search: "",
      source: "all",
      status: "all",
    });
  }

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !nextCursor) return;
    const generation = loadMoreGeneration.current += 1;
    setLoadingMore(true);
    try {
      const data = await fetchProspectList({
        status: statusFilter,
        source: sourceFilter,
        priority: priorityFilter,
        search: deferredSearchQuery,
        cursor: nextCursor,
        pageSize,
        lifecycle: lifecycleFilter,
        catalogItemId: catalogFilter,
      });
      if (loadMoreGeneration.current !== generation) return;
      setProspects((current) => {
        const existingIds = new Set(current.map((prospect) => prospect.id));
        return [
          ...current,
          ...data.items.filter((prospect) => !existingIds.has(prospect.id)),
        ];
      });
      setNextCursor(data.pagination.nextCursor);
      setTotal(data.total);
      setLifecycleCounts(data.counts.byLifecycle);
      const nextPageSize = Math.min(100, pageSize + 50);
      if (nextPageSize !== pageSize) {
        setPageSize(nextPageSize);
        replaceFilterContext({
          catalogItemId: catalogFilter,
          lifecycle: lifecycleFilter,
          pageSize: nextPageSize,
          priority: priorityFilter,
          search: searchQuery,
          source: sourceFilter,
          status: statusFilter,
        });
      }
    } catch (error) {
      if (loadMoreGeneration.current !== generation) return;
      console.error("Error loading more Outreach people:", error);
      toast.error("Could not load more people. Try again.");
    } finally {
      if (loadMoreGeneration.current === generation) {
        setLoadingMore(false);
      }
    }
  }, [
    deferredSearchQuery,
    loading,
    loadingMore,
    nextCursor,
    pageSize,
    priorityFilter,
    replaceFilterContext,
    searchQuery,
    sourceFilter,
    statusFilter,
    lifecycleFilter,
    catalogFilter,
  ]);

  async function removeFromOutreach() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiMutate("DELETE", `/outreach/prospects/${deleteTarget.id}`, { confirm: true });
      toast.success(`${deleteTarget.name} removed from Outreach`);
      setDeleteTarget(null);
      const refreshed = await fetchProspectList({
        status: statusFilter,
        source: sourceFilter,
        priority: priorityFilter,
        search: deferredSearchQuery,
        pageSize,
        lifecycle: lifecycleFilter,
        catalogItemId: catalogFilter,
      });
      setProspects(refreshed.items);
      setNextCursor(refreshed.pagination.nextCursor);
      setTotal(refreshed.total);
      setLifecycleCounts(refreshed.counts.byLifecycle);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Person could not be removed.",
      );
    } finally {
      setDeleting(false);
    }
  }

  const statCards = [
    {
      featured: true,
      label: "Prospects",
      value: total.toLocaleString(),
      description: "People matching the current filters",
    },
    {
      label: "New",
      value: (lifecycleCounts.untouched ?? 0).toLocaleString(),
      description: "Never researched or contacted",
    },
    {
      label: "Ready for a next step",
      value: ((lifecycleCounts.researched ?? 0) + (lifecycleCounts.draft_ready ?? 0)).toLocaleString(),
      description: `${(lifecycleCounts.draft_ready ?? 0).toLocaleString()} drafts ready`,
    },
    {
      label: "Active conversations",
      value: ((lifecycleCounts.contacted ?? 0) + (lifecycleCounts.replied ?? 0)).toLocaleString(),
      description: `${(lifecycleCounts.follow_up_scheduled ?? 0).toLocaleString()} with follow-ups`,
    },
  ];
  const filtersActive = Boolean(deferredSearchQuery)
    || statusFilter !== "all"
    || sourceFilter !== "all"
    || priorityFilter !== "all"
    || lifecycleFilter !== "all"
    || catalogFilter !== "all";

  return (
    <div className="w-full min-w-0 space-y-8">
      <PageHeader
        actions={
          <Button asChild>
            <Link href="/contacts">
              Manage people
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        }
        description="Research, qualify, prepare outreach, and track the people selected from your shared workspace."
        title="Prospects"
      />

      <StatRow isLoading={loading} stats={statCards} />

      <ListSurface
        count={total}
        description={`${total.toLocaleString()} ${total === 1 ? "person" : "people"} match the current filters.`}
        emptyState={
          <div className="grid justify-items-center gap-3 px-6 py-16 text-center">
            <Users className="size-9 text-muted-foreground" />
            <div>
              <p className="font-medium">
                {deferredSearchQuery
                  ? `No people match “${deferredSearchQuery}”`
                  : filtersActive
                    ? "No people match these filters"
                  : "No one is in the Outreach pipeline yet"}
              </p>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                {filtersActive
                  ? "Try another search term or clear a filter."
                  : "Open People and start Outreach for the people you want to research and contact."}
              </p>
            </div>
            {filtersActive ? (
              <Button
                className="mt-2"
                onClick={clearFilters}
                variant="outline"
              >
                Clear filters
              </Button>
            ) : (
              <Button asChild className="mt-2" variant="outline">
                <Link href="/contacts">Choose people</Link>
              </Button>
            )}
          </div>
        }
        filters={
          <>
            <Select onValueChange={(value) => changeFilters({ lifecycle: value as ProspectLifecycle | "all" })} value={lifecycleFilter}>
              <SelectTrigger aria-label="Filter by lifecycle" className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All lifecycle states</SelectItem>
                {Object.entries(LIFECYCLE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select onValueChange={(value) => changeFilters({ catalogItemId: value })} value={catalogFilter}>
              <SelectTrigger aria-label="Filter by Catalog item" className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Catalog items</SelectItem>
                {catalog.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}{item.status === "archived" ? " (archived)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select
              onValueChange={(value) =>
                changeFilters({ status: value as ProspectStatus | "all" })
              }
              value={statusFilter}
            >
              <SelectTrigger aria-label="Filter by status" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.entries(PROSPECT_STATUS_CONFIG).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              onValueChange={(value) =>
                changeFilters({ priority: value as ProspectPriority | "all" })
              }
              value={priorityFilter}
            >
              <SelectTrigger aria-label="Filter by priority" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                {Object.entries(PROSPECT_PRIORITY_CONFIG).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              onValueChange={(value) =>
                changeFilters({ source: value as ProspectSource | "all" })
              }
              value={sourceFilter}
            >
              <SelectTrigger aria-label="Filter by source" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {Object.entries(PROSPECT_SOURCE_CONFIG).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        hasMore={!loading && nextCursor !== null}
        isLoading={loading}
        isLoadingMore={loadingMore}
        onLoadMore={() => void loadMore()}
        onSearchChange={(value) => changeFilters({ search: value })}
        searchPlaceholder="Search prospects…"
        searchValue={searchQuery}
        title="Prospects"
      >
        {!loading && prospects.length > 0 ? (
          <ListRows>
            {prospects.map((prospect) => {
              const lastActivity = prospect.lastContactedAt ?? prospect.createdAt;
              const personContext =
                [prospect.title, prospect.company].filter(Boolean).join(" · ")
                || prospect.email
                || "Outreach target";
              const nextAction = prospect.pipeline?.nextAction;
              const lifecycle = prospect.pipeline?.lifecycle ?? "untouched";

              return (
                <ListRow
                  actions={[
                    {
                      href: `/contacts?edit=${prospect.id}`,
                      icon: Pencil,
                      label: `Edit ${prospect.name}`,
                    },
                    {
                      destructive: true,
                      icon: Trash2,
                      label: `Delete ${prospect.name} from Outreach`,
                      onSelect: () => setDeleteTarget(prospect),
                    },
                  ]}
                  badge={
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={PROSPECT_STATUS_CONFIG[prospect.status].variant}>
                        {PROSPECT_STATUS_CONFIG[prospect.status].label}
                      </Badge>
                      <Badge variant={lifecycle === "replied" || lifecycle === "contacted" ? "default" : lifecycle === "untouched" ? "outline" : "secondary"}>
                        {lifecycle === "draft_ready" ? <FileCheck2 className="size-3" /> : null}
                        {LIFECYCLE_LABELS[lifecycle]}
                      </Badge>
                      {prospect.qualificationStatus ? (
                        <Badge variant={QUALIFICATION_BADGES[prospect.qualificationStatus].variant}>
                          {QUALIFICATION_BADGES[prospect.qualificationStatus].label}
                        </Badge>
                      ) : null}
                      {prospect.catalogItemName ? <Badge variant="outline">{prospect.catalogItemName}</Badge> : null}
                      {nextAction ? <span className="inline-flex items-center gap-1" title={nextAction.title}><AlarmClock className="size-3.5 text-amber-500" /><DueBadge dueAt={nextAction.dueAt} /></span> : null}
                    </span>
                  }
                  href={`/outreach/prospects/${prospect.id}`}
                  key={prospect.id}
                  leading={
                    <Avatar className="size-10 shrink-0">
                      <AvatarImage alt={prospect.name} src={prospect.photoUrl} />
                      <AvatarFallback className="bg-primary/10 text-primary">
                        <User className="size-4" />
                      </AvatarFallback>
                    </Avatar>
                  }
                  meta={[
                    personContext,
                    ...(prospect.email && personContext !== prospect.email ? [prospect.email] : []),
                    PROSPECT_SOURCE_CONFIG[prospect.source].label,
                    PROSPECT_PRIORITY_CONFIG[prospect.priority].label,
                    <span key="activity" title={new Date(lastActivity).toLocaleString()}>
                      {formatDistanceToNow(new Date(lastActivity), { addSuffix: true })}
                    </span>,
                  ]}
                  title={prospect.name}
                />
              );
            })}
          </ListRows>
        ) : null}
      </ListSurface>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove from Outreach?</DialogTitle>
            <DialogDescription>
              {deleteTarget?.name} will leave the Outreach pipeline. Their
              shared People record and any other service history will remain.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={deleting}
              onClick={() => void removeFromOutreach()}
              variant="destructive"
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
