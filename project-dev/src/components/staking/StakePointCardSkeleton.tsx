import React from 'react';

export function StakePointCardSkeleton() {
  return (
    <div
      data-testid="stakepoint-skeleton"
      className="rounded-xl bg-surface border border-line p-5 sm:p-6 flex flex-col justify-between h-full animate-pulse"
      aria-busy="true"
      aria-label="Loading staking data"
    >
      <div className="space-y-4">
        {/* Title Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-sans text-base font-extrabold text-white uppercase tracking-tight">
            Staking — $H42
          </h3>
          <span className="text-2xs font-mono text-muted uppercase">STAKEPOINT</span>
        </div>

        {/* APR Hero Box */}
        <div className="rounded-lg bg-surface-card border border-line p-4 space-y-2">
          <div className="h-3 w-12 bg-surface rounded" />
          <div className="h-9 w-28 bg-surface rounded" />
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3 pt-1">
          <div className="space-y-1.5">
            <div className="h-2.5 w-10 bg-surface-card rounded" />
            <div className="h-4 w-16 bg-surface-card rounded" />
          </div>
          <div className="space-y-1.5">
            <div className="h-2.5 w-16 bg-surface-card rounded" />
            <div className="h-4 w-14 bg-surface-card rounded" />
          </div>
          <div className="space-y-1.5">
            <div className="h-2.5 w-12 bg-surface-card rounded" />
            <div className="h-4 w-12 bg-surface-card rounded" />
          </div>
        </div>
      </div>

      {/* Button */}
      <div className="pt-5 mt-auto">
        <div className="h-11 w-full sm:w-48 bg-surface-card rounded-lg" />
      </div>
    </div>
  );
}
