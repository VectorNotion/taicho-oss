"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { Building2, Target, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

type Segment = "all" | "targets" | "qualified" | "warm";

type AccountListItem = {
  id: string;
  name: string;
  prospectCount: number;
  qualifiedCount: number;
  icpScore: number | null;
  timingScore: number | null;
  isTarget: boolean;
};

type AccountListResponse = {
  accounts: AccountListItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: { total: number; targets: number; qualified: number; warm: number };
};

async function fetchAccounts(
  filters: { search: string; segment: Segment; page: number; pageSize: number },
  signal?: AbortSignal,
): Promise<AccountListResponse> {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.segment !== "all") params.set("segment", filters.segment);
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  const response = await fetch(`/api/outreach/accounts?${params.toString()}`, { signal });
  if (!response.ok) throw new Error("Failed to fetch accounts.");
  return response.json();
}

function scoreLabel(value: number | null): string {
  return value == null ? "not scored" : String(Math.round(value));
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [segment, setSegment] = useState<Segment>("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ total: 0, targets: 0, qualified: 0, warm: 0 });
  const loadMoreController = useRef<AbortController | null>(null);
  const pageSize = 50;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    loadMoreController.current?.abort();
    loadMoreController.current = null;
    setLoading(true);
    setLoadingMore(false);
    void fetchAccounts(
      { search: deferredSearchQuery, segment, page: 1, pageSize },
      controller.signal,
    )
      .then((data) => {
        if (cancelled) return;
        setAccounts(data.accounts);
        setPage(1);
        setTotal(data.total);
        setCounts(data.counts);
      })
      .catch((error) => {
        if (cancelled || controller.signal.aborted) return;
        console.error("Error fetching accounts:", error);
        toast.error("Could not load accounts. Refresh to try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [deferredSearchQuery, segment]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || accounts.length >= total) return;
    const nextPage = page + 1;
    const controller = new AbortController();
    loadMoreController.current?.abort();
    loadMoreController.current = controller;
    setLoadingMore(true);
    try {
      const data = await fetchAccounts(
        { search: deferredSearchQuery, segment, page: nextPage, pageSize },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setAccounts((current) => {
        const existing = new Set(current.map((account) => account.id));
        return [...current, ...data.accounts.filter((account) => !existing.has(account.id))];
      });
      setPage(nextPage);
      setTotal(data.total);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("Error loading more accounts:", error);
      toast.error("Could not load more accounts. Try again.");
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
        setLoadingMore(false);
      }
    }
  }, [accounts.length, deferredSearchQuery, loading, loadingMore, page, segment, total]);

  const statCards = [
    {
      featured: true,
      label: "Accounts",
      value: counts.total.toLocaleString(),
      description: "Companies discovered from your prospects",
    },
    {
      label: "Target accounts",
      value: counts.targets.toLocaleString(),
      description: "ICP score strong enough to pursue",
    },
    {
      label: "With a qualified prospect",
      value: counts.qualified.toLocaleString(),
      description: "Right company, right person found",
    },
    {
      label: "In a buying window",
      value: counts.warm.toLocaleString(),
      description: "Timing signals firing now",
    },
  ];
  const filtersActive = Boolean(deferredSearchQuery) || segment !== "all";

  return (
    <div className="w-full min-w-0 space-y-8">
      <PageHeader
        description="Companies behind your prospects, scored on ICP fit and buying-window timing. Fit gates. Timing ranks."
        title="Accounts"
      />

      <StatRow isLoading={loading} stats={statCards} />

      <ListSurface
        count={total}
        description={`${total.toLocaleString()} ${total === 1 ? "account matches" : "accounts match"} the current filters.`}
        emptyState={
          <div className="grid justify-items-center gap-3 px-6 py-16 text-center">
            <Building2 className="size-9 text-muted-foreground" />
            <div>
              <p className="font-medium">
                {deferredSearchQuery
                  ? `No accounts match “${deferredSearchQuery}”`
                  : filtersActive
                    ? "No accounts match this filter"
                    : "No accounts yet"}
              </p>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                {filtersActive
                  ? "Try another search term or clear the filter."
                  : "Accounts are created automatically when a prospect with a company is researched."}
              </p>
            </div>
            {filtersActive ? (
              <Button
                className="mt-2"
                onClick={() => {
                  setSearchQuery("");
                  setSegment("all");
                }}
                variant="outline"
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        }
        filters={
          <Select onValueChange={(value) => setSegment(value as Segment)} value={segment}>
            <SelectTrigger aria-label="Filter accounts" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              <SelectItem value="targets">Target accounts</SelectItem>
              <SelectItem value="qualified">With qualified prospect</SelectItem>
              <SelectItem value="warm">In a buying window</SelectItem>
            </SelectContent>
          </Select>
        }
        hasMore={!loading && accounts.length < total}
        isLoading={loading}
        isLoadingMore={loadingMore}
        onLoadMore={() => void loadMore()}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search accounts…"
        searchValue={searchQuery}
        title="Accounts"
      >
        {!loading && accounts.length > 0 ? (
          <ListRows>
            {accounts.map((account) => (
              <ListRow
                badge={
                  account.isTarget ? (
                    <Badge variant="default">Target</Badge>
                  ) : account.icpScore == null ? (
                    <Badge variant="secondary">Not scored</Badge>
                  ) : (
                    <Badge variant="outline">ICP {Math.round(account.icpScore)}</Badge>
                  )
                }
                href={`/outreach/accounts/${account.id}`}
                key={account.id}
                leading={
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Building2 className="size-4" />
                  </span>
                }
                meta={[
                  `${account.prospectCount} ${account.prospectCount === 1 ? "prospect" : "prospects"}`,
                  `${account.qualifiedCount} qualified`,
                  `ICP ${scoreLabel(account.icpScore)}`,
                  `Timing ${scoreLabel(account.timingScore)}`,
                ]}
                title={account.name}
              />
            ))}
          </ListRows>
        ) : null}
      </ListSurface>
    </div>
  );
}
