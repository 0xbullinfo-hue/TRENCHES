import React from 'react';

export function LedgerCardSkeleton() {
  return (
    <div className="rounded-xl bg-surface-card border border-toxic-border/40 p-5 sm:p-6 flex flex-col justify-between gap-4 animate-pulse min-h-[350px]">
      <div className="space-y-4">
        {/* Top Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-5 w-16 bg-surface rounded" />
            <div className="h-4 w-12 bg-surface rounded" />
          </div>
          <div className="h-5 w-16 bg-surface rounded" />
        </div>

        {/* Multiplier Hero Block */}
        <div className="h-20 rounded-lg bg-surface p-3.5 border border-toxic-border/20 flex flex-col justify-center gap-2">
          <div className="h-7 w-20 bg-surface-elevated rounded" />
          <div className="h-3 w-16 bg-surface-elevated rounded" />
        </div>

        {/* Entry / Exit Skeleton */}
        <div className="h-14 rounded-lg bg-surface border border-toxic-border/20 p-3" />

        {/* CA Skeleton */}
        <div className="h-10 w-full bg-surface rounded-lg" />

        {/* Share to X Skeleton */}
        <div className="h-10 w-full bg-surface rounded-lg" />
      </div>

      {/* Footer Skeleton */}
      <div className="pt-4 mt-4 border-t border-toxic-border/20 flex items-center justify-between">
        <div className="h-3 w-40 bg-surface rounded" />
        <div className="h-3 w-12 bg-surface rounded" />
      </div>
    </div>
  );
}
