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
  Loader2,
  Pencil,
  Trash2,
  User,
  Users,
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
  LEAD_PRIORITY_CONFIG,
  LEAD_SOURCE_CONFIG,
  LEAD_STATUS_CONFIG,
  type Lead,
  type LeadPriority,
  type LeadSource,
  type LeadStatus,
} from "@/products/outreach/domain/types";

type LeadListResponse = {
  leads: Lead[];
  total: number;
  page: number;
  pageSize: number;
  counts: {
    total: number;
    byStatus: Record<string, number>;
  };
};

async function fetchLeadList(filters: {
  status: LeadStatus | "all";
  source: LeadSource | "all";
  priority: LeadPriority | "all";
  search: string;
  page: number;
  pageSize: number;
}, signal?: AbortSignal): Promise<LeadListResponse> {
  const params = new URLSearchParams();
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.source !== "all") params.set("source", filters.source);
  if (filters.priority !== "all") params.set("priority", filters.priority);
  if (filters.search) params.set("search", filters.search);
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  const response = await fetch(
    `/api/outreach/leads?${params.toString()}`,
    { signal },
  );
  if (!response.ok) throw new Error("Failed to fetch the Outreach pipeline.");
  return response.json();
}

export default function PipelinePage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<LeadSource | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<LeadPriority | "all">(
    "all",
  );
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [serverCounts, setServerCounts] = useState<Record<string, number>>({});
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState(false);
  const loadMoreController = useRef<AbortController | null>(null);
  const pageSize = 50;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    loadMoreController.current?.abort();
    loadMoreController.current = null;
    setLoading(true);
    setLoadingMore(false);
    void fetchLeadList({
      status: statusFilter,
      source: sourceFilter,
      priority: priorityFilter,
      search: deferredSearchQuery,
      page: 1,
      pageSize,
    }, controller.signal)
      .then((data) => {
        if (cancelled) return;
        setLeads(data.leads);
        setPage(1);
        setTotal(data.total);
        setServerCounts(data.counts.byStatus);
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
  ]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || leads.length >= total) return;
    const nextPage = page + 1;
    const controller = new AbortController();
    loadMoreController.current?.abort();
    loadMoreController.current = controller;
    setLoadingMore(true);
    try {
      const data = await fetchLeadList({
        status: statusFilter,
        source: sourceFilter,
        priority: priorityFilter,
        search: deferredSearchQuery,
        page: nextPage,
        pageSize,
      }, controller.signal);
      if (controller.signal.aborted) return;
      setLeads((current) => {
        const existingIds = new Set(current.map((lead) => lead.id));
        return [
          ...current,
          ...data.leads.filter((lead) => !existingIds.has(lead.id)),
        ];
      });
      setPage(nextPage);
      setTotal(data.total);
      setServerCounts(data.counts.byStatus);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("Error loading more Outreach people:", error);
      toast.error("Could not load more people. Try again.");
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
        setLoadingMore(false);
      }
    }
  }, [
    deferredSearchQuery,
    leads.length,
    loading,
    loadingMore,
    page,
    priorityFilter,
    sourceFilter,
    statusFilter,
    total,
  ]);

  async function removeFromOutreach() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/outreach/leads/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error ?? "Person could not be removed.");
      }
      toast.success(`${deleteTarget.name} removed from Outreach`);
      setDeleteTarget(null);
      const refreshed = await fetchLeadList({
        status: statusFilter,
        source: sourceFilter,
        priority: priorityFilter,
        search: deferredSearchQuery,
        page: 1,
        pageSize,
      });
      setLeads(refreshed.leads);
      setPage(1);
      setTotal(refreshed.total);
      setServerCounts(refreshed.counts.byStatus);
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
      label: "Pipeline",
      value: total.toLocaleString(),
      description: "People matching the current filters",
    },
    {
      label: "New",
      value: (serverCounts.new ?? 0).toLocaleString(),
      description: "Waiting for research",
    },
    {
      label: "Ready for a next step",
      value: ((serverCounts.researched ?? 0) + (serverCounts.qualified ?? 0)).toLocaleString(),
      description: `${(serverCounts.qualified ?? 0).toLocaleString()} qualified`,
    },
    {
      label: "Active conversations",
      value: ((serverCounts.contacted ?? 0) + (serverCounts.replied ?? 0)).toLocaleString(),
      description: `${(serverCounts.replied ?? 0).toLocaleString()} replied`,
    },
  ];
  const filtersActive = Boolean(deferredSearchQuery)
    || statusFilter !== "all"
    || sourceFilter !== "all"
    || priorityFilter !== "all";

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
        title="Pipeline"
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
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                  setPriorityFilter("all");
                  setSourceFilter("all");
                }}
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
            <Select
              onValueChange={(value) =>
                setStatusFilter(value as LeadStatus | "all")
              }
              value={statusFilter}
            >
              <SelectTrigger aria-label="Filter by status" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.entries(LEAD_STATUS_CONFIG).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              onValueChange={(value) =>
                setPriorityFilter(value as LeadPriority | "all")
              }
              value={priorityFilter}
            >
              <SelectTrigger aria-label="Filter by priority" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                {Object.entries(LEAD_PRIORITY_CONFIG).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              onValueChange={(value) =>
                setSourceFilter(value as LeadSource | "all")
              }
              value={sourceFilter}
            >
              <SelectTrigger aria-label="Filter by source" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {Object.entries(LEAD_SOURCE_CONFIG).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        hasMore={!loading && leads.length < total}
        isLoading={loading}
        isLoadingMore={loadingMore}
        onLoadMore={() => void loadMore()}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search people…"
        searchValue={searchQuery}
        title="Outreach pipeline"
      >
        {!loading && leads.length > 0 ? (
          <ListRows>
            {leads.map((lead) => {
              const lastActivity = lead.lastContactedAt ?? lead.createdAt;
              const personContext =
                [lead.title, lead.company].filter(Boolean).join(" · ")
                || lead.email
                || "Outreach target";

              return (
                <ListRow
                  actions={[
                    {
                      href: `/contacts?edit=${lead.id}`,
                      icon: Pencil,
                      label: `Edit ${lead.name}`,
                    },
                    {
                      destructive: true,
                      icon: Trash2,
                      label: `Delete ${lead.name} from Outreach`,
                      onSelect: () => setDeleteTarget(lead),
                    },
                  ]}
                  badge={
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={LEAD_STATUS_CONFIG[lead.status].variant}>
                        {LEAD_STATUS_CONFIG[lead.status].label}
                      </Badge>
                      <Badge variant={LEAD_PRIORITY_CONFIG[lead.priority].variant}>
                        {LEAD_PRIORITY_CONFIG[lead.priority].label}
                      </Badge>
                    </span>
                  }
                  href={`/outreach/pipeline/${lead.id}`}
                  key={lead.id}
                  leading={
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                      <User className="size-4" />
                    </span>
                  }
                  meta={[
                    personContext,
                    ...(lead.email && personContext !== lead.email ? [lead.email] : []),
                    LEAD_SOURCE_CONFIG[lead.source].label,
                    <span key="activity" title={new Date(lastActivity).toLocaleString()}>
                      {formatDistanceToNow(new Date(lastActivity), { addSuffix: true })}
                    </span>,
                  ]}
                  title={lead.name}
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
