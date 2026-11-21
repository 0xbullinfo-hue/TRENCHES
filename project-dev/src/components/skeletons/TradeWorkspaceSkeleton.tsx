import React from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/components/ui/cn';

export interface TradeWorkspaceSkeletonProps {
  rows?: number;
  className?: string;
}

/**
 * Loading skeleton matching the TrenchLabs surface/border design tokens
 * for the Incubator Hub intelligence table workspace.
 */
export function TradeWorkspaceSkeleton({
  rows = 6,
  className,
}: TradeWorkspaceSkeletonProps) {
  const rowCount = Math.max(1, Math.min(20, Math.trunc(rows)));

  return (
    <div
      aria-busy="true"
      aria-label="Loading incubator workspace"
      className={cn(
        'w-full rounded-xl border border-border-default bg-surface p-4 space-y-3',
        className
      )}
    >
      <div className="flex items-center justify-between gap-4 pb-2 border-b border-border-default/60">
        <Skeleton className="h-4 w-36" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>

      {Array.from({ length: rowCount }).map((_, idx) => (
        <div
          key={idx}
          className="grid grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] items-center gap-3 py-2 border-b border-border-default/40 last:border-b-0"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="space-y-1.5 min-w-0 flex-1">
              <Skeleton className="h-3.5 w-28 max-w-full" />
              <Skeleton className="h-2.5 w-20 max-w-full" />
            </div>
          </div>
          <Skeleton className="h-4 w-16 justify-self-end" />
          <Skeleton className="h-4 w-14 justify-self-end" />
          <Skeleton className="h-4 w-16 justify-self-end" />
          <Skeleton className="h-7 w-20 justify-self-end rounded-lg" />
        </div>
      ))}
    </div>
  );
}
