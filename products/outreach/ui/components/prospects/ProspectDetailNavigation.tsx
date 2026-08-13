"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export interface DetailNavigationItem {
  id: string;
  name: string;
  company?: string;
  title?: string;
}

export interface DetailNavigationData {
  previous: DetailNavigationItem | null;
  next: DetailNavigationItem | null;
  position: number;
  total: number;
}

interface DetailNavigationProps {
  entityLabel: string;
  hrefBase: string;
  navigation: DetailNavigationData | null;
  isLoading?: boolean;
  hasError?: boolean;
}

export type ProspectNavigationItem = DetailNavigationItem;
export type ProspectNavigation = DetailNavigationData;

type ProspectDetailNavigationProps = Omit<
  DetailNavigationProps,
  "entityLabel" | "hrefBase"
>;

function SiblingControl({
  direction,
  entityLabel,
  hrefBase,
  item,
}: {
  direction: "previous" | "next";
  entityLabel: string;
  hrefBase: string;
  item: DetailNavigationItem | null;
}) {
  const isPrevious = direction === "previous";
  const label = isPrevious ? "Previous" : "Next";
  const entityLabelLower = entityLabel.toLowerCase();
  const boundaryLabel = isPrevious ? "Start of list" : "End of list";
  const icon = isPrevious
    ? <ChevronLeft aria-hidden className="size-4" />
    : <ChevronRight aria-hidden className="size-4" />;
  const controlClassName = isPrevious
    ? "h-auto min-w-0 justify-start gap-2 px-2 py-2 sm:px-3"
    : "h-auto min-w-0 justify-end gap-2 px-2 py-2 sm:px-3";
  const textClassName = isPrevious
    ? "min-w-0 text-left"
    : "min-w-0 text-right";

  if (!item) {
    return (
      <Button
        aria-label={`No ${direction} ${entityLabelLower}`}
        className={controlClassName}
        disabled
        size="sm"
        variant="ghost"
      >
        {isPrevious && icon}
        <span className={textClassName}>
          <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span className="block truncate text-xs font-medium sm:text-sm">{boundaryLabel}</span>
        </span>
        {!isPrevious && icon}
      </Button>
    );
  }

  return (
    <Button asChild className={controlClassName} size="sm" variant="ghost">
      <Link
        aria-label={`${label} ${entityLabelLower}: ${item.name}`}
        href={`${hrefBase}/${item.id}`}
        title={`${label}: ${item.name}`}
      >
        {isPrevious && icon}
        <span className={textClassName}>
          <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span className="block max-w-[24vw] truncate text-xs font-semibold text-foreground sm:max-w-48 sm:text-sm lg:max-w-64">
            {item.name}
          </span>
        </span>
        {!isPrevious && icon}
      </Link>
    </Button>
  );
}

export function DetailNavigation({
  entityLabel,
  hrefBase,
  navigation,
  isLoading = false,
  hasError = false,
}: DetailNavigationProps) {
  return (
    <nav
      aria-label={`${entityLabel} navigation`}
      className="mb-3 grid min-h-16 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center rounded-lg border bg-card px-1.5 py-1 shadow-xs sm:px-2"
    >
      {isLoading ? (
        <>
          <Skeleton className="h-10 w-24 justify-self-start sm:w-40" />
          <div aria-label={`Loading ${entityLabel.toLowerCase()} navigation`} className="space-y-1 px-3 text-center">
            <Skeleton className="mx-auto h-2.5 w-12" />
            <Skeleton className="mx-auto h-4 w-10" />
          </div>
          <Skeleton className="h-10 w-24 justify-self-end sm:w-40" />
        </>
      ) : hasError ? (
        <p className="col-span-3 px-4 text-center text-sm text-destructive">
          {entityLabel} navigation could not be loaded. Refresh to try again.
        </p>
      ) : (
        <>
          <SiblingControl
            direction="previous"
            entityLabel={entityLabel}
            hrefBase={hrefBase}
            item={navigation?.previous ?? null}
          />
          <div
            aria-label={navigation ? `${entityLabel} ${navigation.position} of ${navigation.total}` : `${entityLabel} position unavailable`}
            className="border-x px-3 text-center sm:px-6"
          >
            <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {entityLabel}
            </span>
            <span className="block whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">
              {navigation ? `${navigation.position} of ${navigation.total}` : "—"}
            </span>
          </div>
          <SiblingControl
            direction="next"
            entityLabel={entityLabel}
            hrefBase={hrefBase}
            item={navigation?.next ?? null}
          />
        </>
      )}
    </nav>
  );
}

export function ProspectDetailNavigation(props: ProspectDetailNavigationProps) {
  return (
    <DetailNavigation
      {...props}
      entityLabel="Prospect"
      hrefBase="/outreach/prospects"
    />
  );
}
