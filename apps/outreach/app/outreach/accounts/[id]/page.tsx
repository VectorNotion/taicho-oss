"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, apiGet } from "@content-automation/platform/network/api-client";
import { ListCard } from "@/components/ListCard";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { AccountProspectsSection } from "@/components/prospects/AccountProspectsSection";
import {
  DetailNavigation,
  type DetailNavigationData,
} from "@/components/prospects";
import { AccountResearchInsights } from "@/products/outreach/ui/components/prospects/AccountResearchInsights";
import { useDurableDimensionResearch } from "@/products/outreach/ui/components/research/useDurableDimensionResearch";
import { AccountOpportunitiesCard } from "@/products/outreach/ui/components/accounts/AccountOpportunitiesCard";
import type { AccountOpportunityCoverageResult } from "@/products/outreach/domain/account-opportunity";

type DimensionMatch = {
  dimensionKey: string;
  matchScore: number;
  effectiveMatch: number;
  classification: string;
  hardExclusion: boolean;
  confidence: number;
};
type TimingBreakdown = { dimensionKey: string; dimensionValue: number; signalCount: number };
type AccountObservation = {
  dimensionKey: string;
  observedValue?: string;
  evidence: string[];
  confidence: number;
  matchScore?: number;
  effectiveMatch?: number;
  classification?: string;
  hardExclusion?: boolean;
};
type AccountTimingSignals = {
  dimensionKey: string;
  signals: Array<{ signal: string; date: string; evidence: string[]; confidence: number }>;
  dimensionValue?: number;
  signalCount: number;
};
type AccountProspect = {
  id: string;
  name: string;
  title?: string;
  status: string;
  personaScore: number | null;
  qualificationStatus: string | null;
  lastContactedAt?: string;
  nextAction?: { id: string; title: string; dueAt: string } | null;
};
type AccountDetail = {
  id: string;
  name: string;
  createdAt: string;
  icpScore: number | null;
  timingScore: number | null;
  hardExcluded: boolean;
  reviewReason?: string;
  computedAt?: string;
  icpMatches: DimensionMatch[];
  icpObservations: AccountObservation[];
  timingBreakdown: TimingBreakdown[];
  timingSignals: AccountTimingSignals[];
  prospects: AccountProspect[];
  opportunityCoverage: AccountOpportunityCoverageResult;
};

function AccountDetailSkeleton() {
  return (
    <div className="w-full min-w-0 space-y-8">
      <div>
        <Skeleton className="mb-4 h-5 w-28" />
        <Skeleton className="h-9 w-64" />
      </div>
      <Skeleton className="h-24" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

export default function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [navigation, setNavigation] = useState<DetailNavigationData | null>(null);
  const [navigationLoading, setNavigationLoading] = useState(true);
  const [navigationError, setNavigationError] = useState(false);
  const researchWasActive = useRef(false);
  const research = useDurableDimensionResearch({
    action: "research_account",
    entityId: id,
    startApi: "/outreach/operations/account-research",
    body: { accountId: id },
    primaryScope: "account",
  });

  const loadAccount = useCallback(
    async (options?: { silent?: boolean; signal?: AbortSignal }) => {
      if (!options?.silent) setLoading(true);
      setNotFound(false);
      try {
        const { account: loaded } = await apiGet<{ account: AccountDetail }>(
          `/outreach/accounts/${id}`,
          undefined,
          { signal: options?.signal },
        );
        if (!options?.signal?.aborted) setAccount(loaded);
      } catch (error) {
        if (options?.signal?.aborted) return;
        if (error instanceof ApiError && error.status === 404) {
          setNotFound(true);
          return;
        }
        console.error("Error fetching account:", error);
        toast.error("Could not load this account — refresh to try again.");
      } finally {
        if (!options?.silent && !options?.signal?.aborted) setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadAccount({ signal: controller.signal });
    return () => controller.abort();
  }, [loadAccount]);

  useEffect(() => {
    const controller = new AbortController();
    setNavigationLoading(true);
    setNavigationError(false);
    setNavigation(null);
    void apiGet<{ navigation: DetailNavigationData }>(
      `/outreach/accounts/${id}/navigation`,
      undefined,
      { signal: controller.signal },
    )
      .then(({ navigation: data }) => {
        if (!controller.signal.aborted) setNavigation(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          if (error instanceof ApiError && error.status === 404) {
            setNavigationError(false);
            return;
          }
          console.error("Error fetching account navigation:", error);
          setNavigationError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setNavigationLoading(false);
      });
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    if (research.isStreaming) researchWasActive.current = true;
  }, [research.isStreaming]);

  useEffect(() => {
    if (!research.final) return;
    const controller = new AbortController();
    if (researchWasActive.current && account) toast.success(`Research complete for ${account.name}`);
    researchWasActive.current = false;
    void loadAccount({ silent: true, signal: controller.signal });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [research.final]);

  if (loading) return <AccountDetailSkeleton />;

  if (notFound || !account) {
    return (
      <div className="w-full min-w-0 space-y-8">
        <Link
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          href="/outreach/accounts"
        >
          <ArrowLeft className="size-4" /> All accounts
        </Link>
        <div className="grid justify-items-center gap-3 py-16 text-center">
          <Building2 className="size-9 text-muted-foreground" />
          <p className="font-medium">Account not found</p>
        </div>
      </div>
    );
  }

  const qualifiedCount = account.prospects.filter((p) => p.qualificationStatus === "QUALIFIED").length;
  return (
    <div className="w-full min-w-0 space-y-8">
      <div>
        <Link
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          href="/outreach/accounts"
        >
          <ArrowLeft className="size-4" /> All accounts
        </Link>
        <DetailNavigation
          entityLabel="Account"
          hasError={navigationError}
          hrefBase="/outreach/accounts"
          isLoading={navigationLoading}
          navigation={navigation}
        />
        <PageHeader
          description="Company fit and buying-window timing. Fit gates. Timing ranks."
          title={account.name}
        />
      </div>

      <ListCard
        description="What research found about this company, with evidence behind each score."
        title="Research insights"
      >
        <div className="p-6">
          <AccountResearchInsights
            account={account}
            accountLoading={false}
            execution={{
              completedAt: research.completedAt,
              dimensions: research.dimensions,
              error: research.error,
              isRetrying: research.isRetrying,
              isRunning: research.isStreaming,
              onRetry: () => void research.retry(),
              progress: research.progress,
              startedAt: research.startedAt,
              telemetry: research.telemetry,
            }}
            onResearch={() => void research.start()}
          />
        </div>
      </ListCard>

      {(account.reviewReason || account.prospects.length > 0) && (
        <p className="-mt-4 text-xs text-muted-foreground">
          {account.prospects.length > 0 && (
            <span>{qualifiedCount} of {account.prospects.length} {account.prospects.length === 1 ? "prospect" : "prospects"} qualified.</span>
          )}
          {account.reviewReason ? <span> {account.reviewReason}</span> : null}
        </p>
      )}

      <AccountOpportunitiesCard result={account.opportunityCoverage} />

      <AccountProspectsSection
        accountId={account.id}
        accountName={account.name}
        onRefresh={() => void loadAccount({ silent: true })}
        prospects={account.prospects}
      />
    </div>
  );
}
