"use client";

import { useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Skeleton } from "./ui/skeleton";
import { cn } from "../lib/utils";

/**
 * A dimension filter for the ListSurface filter row: a compact label-prefixed
 * select. Chips suit ONE low-cardinality dimension; every further dimension
 * (status, source, priority, sort…) is a FilterSelect.
 */
export function FilterSelect({
  label,
  value,
  onValueChange,
  options,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Select onValueChange={onValueChange} value={value}>
      <SelectTrigger aria-label={`Filter by ${label}`} className="text-xs" size="sm">
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem className="text-xs" key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The §8 integrated list surface: one component owns the whole browse loop —
 * search in the header band ("/" focuses it), an optional filter row, rows,
 * and infinite scroll via a sentinel (record collections never paginate).
 *
 * The wrapper never changes between states:
 * - `isLoading`: skeleton rows in place of children
 * - no children while a search is active: the caller's `emptyState`
 * - `hasMore` + `onLoadMore`: sentinel triggers the next page; loading-more
 *   renders skeleton rows below the real ones
 * - end of list: a quiet "All caught up" terminal line
 */
export function ListSurface({
  title,
  description,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search…",
  filters,
  count,
  isLoading = false,
  isLoadingMore = false,
  hasMore = false,
  onLoadMore,
  emptyState,
  maxHeightClassName,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** One row of filter controls (chips, selects) rendered under the header band. */
  filters?: React.ReactNode;
  /** Total items currently browsable (drives the terminal line). */
  count?: number;
  isLoading?: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  emptyState?: React.ReactNode;
  /** Constrain the rows region (e.g. "max-h-96") — the sentinel then observes this scroll container instead of the viewport. */
  maxHeightClassName?: string;
  children?: React.ReactNode;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onSearchChange) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSearchChange]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !onLoadMore || !hasMore || isLoadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { root: maxHeightClassName ? viewportRef.current : null, rootMargin: "120px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onLoadMore, hasMore, isLoadingMore, maxHeightClassName]);

  const empty = !isLoading && !children;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-none">{title}</h3>
          {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {onSearchChange && (
          <div className="relative w-full sm:w-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={`Search ${title}`}
              className="h-9 w-full pl-8 pr-8 sm:w-64"
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              ref={searchRef}
              value={searchValue ?? ""}
            />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border px-1 font-mono text-[10px] text-muted-foreground">/</kbd>
          </div>
        )}
      </div>

      {filters && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3">
          <div className="flex flex-wrap items-center gap-2">{filters}</div>
          {count != null && (
            <p className="ml-auto text-xs tabular-nums text-muted-foreground">
              {count.toLocaleString()} {count === 1 ? "item" : "items"}
            </p>
          )}
        </div>
      )}

      <div
        className={cn(maxHeightClassName && "overflow-y-auto", maxHeightClassName)}
        ref={viewportRef}
      >
        {isLoading ? (
          <div className="divide-y">
            {[0, 1, 2, 3, 4].map((index) => (
              <div className="px-6 py-3" key={index}>
                <Skeleton className="h-10" />
              </div>
            ))}
          </div>
        ) : empty ? (
          emptyState
        ) : (
          children
        )}

        {!isLoading && !empty && (hasMore || isLoadingMore) && (
          <div className={cn(!isLoadingMore && "h-px")} ref={sentinelRef}>
            {isLoadingMore && (
              <div className="divide-y border-t">
                {[0, 1].map((index) => (
                  <div className="px-6 py-3" key={index}>
                    <Skeleton className="h-10" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!isLoading && !empty && !hasMore && count != null && count > 0 && (
          <p className="border-t px-6 py-3 text-center text-xs text-muted-foreground">
            All caught up · {count.toLocaleString()} {count === 1 ? "item" : "items"}
          </p>
        )}
      </div>
    </Card>
  );
}
