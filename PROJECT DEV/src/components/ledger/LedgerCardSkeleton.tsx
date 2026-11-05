import React from 'react';

export function LedgerCardSkeleton() {
  return (
    <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-5 flex flex-col justify-between gap-4 animate-pulse min-h-[300px]">
      <div>
        {/* Top Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="h-5 w-16 bg-neutral-800 rounded" />
            <div className="h-4 w-12 bg-neutral-800 rounded" />
          </div>
          <div className="h-5 w-16 bg-neutral-800 rounded" />
        </div>

        {/* Multiplier Hero Block */}
        <div className="h-24 rounded-md bg-neutral-950 p-4 border border-neutral-800/80 mb-4 flex flex-col justify-center gap-2">
          <div className="h-8 w-24 bg-neutral-800 rounded" />
          <div className="h-3 w-16 bg-neutral-800 rounded" />
        </div>

        {/* Entry / Exit Skeleton */}
        <div className="flex items-center gap-4 mb-3">
          <div className="h-4 w-20 bg-neutral-800 rounded" />
          <div className="h-4 w-20 bg-neutral-800 rounded" />
        </div>

        {/* CA Skeleton */}
        <div className="h-8 w-full bg-neutral-950 rounded mb-3" />
      </div>

      {/* Footer Skeleton */}
      <div className="pt-3 border-t border-neutral-800/60 flex items-center justify-between">
        <div className="h-3 w-40 bg-neutral-800 rounded" />
        <div className="h-3 w-12 bg-neutral-800 rounded" />
      </div>
    </div>
  );
}

