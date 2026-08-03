'use client';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton for the main Research section content (inline, no Card wrapper).
 * Use inside a CardContent.
 */
export function ResearchSectionSkeleton() {
  return (
    <div className="space-y-4">
      {/* Company Summary skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>

      {/* Outreach Angle skeleton */}
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>

      {/* Key talking points skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <Skeleton className="h-2 w-2 mt-1.5 rounded-full" />
            <Skeleton className="h-4 w-full" />
          </div>
          <div className="flex items-start gap-2">
            <Skeleton className="h-2 w-2 mt-1.5 rounded-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
      </div>

      {/* Show full research button skeleton */}
      <Skeleton className="h-8 w-full" />
    </div>
  );
}

/**
 * Skeleton for company insights grid.
 */
export function InsightsSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-28" />
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="border rounded-lg p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Skeleton for competitors section.
 */
export function CompetitorsSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-24" />
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="border rounded-lg p-2.5 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Skeleton for talking points list.
 */
export function TalkingPointsSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-28" />
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-start gap-2">
            <Skeleton className="h-2 w-2 mt-1.5 rounded-full" />
            <Skeleton className="h-4 w-full" style={{ width: `${85 - i * 10}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
