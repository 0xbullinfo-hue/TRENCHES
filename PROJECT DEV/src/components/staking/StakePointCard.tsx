import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { fetchGenesisPools } from '@/lib/stakepoint/fetchPools';
import { StakePointPool } from '@/lib/stakepoint/types';
import { StakePointCardError } from './StakePointCardError';

export function formatTvlDisplay(tvl: number | null): string | null {
  if (tvl === null || tvl === undefined || isNaN(tvl)) return null;
  if (tvl >= 1_000_000) {
    return `$${(tvl / 1_000_000).toFixed(1)}M`;
  }
  if (tvl >= 1_000) {
    return `$${(tvl / 1_000).toFixed(1)}K`;
  }
  return `$${tvl.toLocaleString()}`;
}

export function formatLockPeriodDisplay(lock: string | number | null): string | null {
  if (lock === null || lock === undefined) return null;
  const str = String(lock).trim();
  if (!str) return null;
  if (typeof lock === 'number') {
    return lock > 365 ? `${Math.round(lock / 86400)} days` : `${lock} days`;
  }
  return str;
}

interface StakePointCardViewProps {
  pools: StakePointPool[];
}

export function StakePointCardView({ pools }: StakePointCardViewProps) {
  // 1. Zero pools: Informative muted state per §4
  if (!pools || pools.length === 0) {
    return (
      <div
        data-testid="stakepoint-card-empty"
        className="rounded-xl bg-surface border border-line p-5 sm:p-6 flex flex-col justify-between h-full"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-sans text-base font-extrabold text-white uppercase tracking-tight">
              Staking — $GENESIS
            </h3>
            <a
              href="https://stakepoint.app/pools"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-white transition-colors"
              title="Open StakePoint"
            >
              <ArrowUpRight className="w-4 h-4" />
            </a>
          </div>

          <div className="rounded-lg bg-surface-card border border-line p-4 space-y-2">
            <p className="font-sans text-xs sm:text-sm font-semibold text-white">
              No staking pool is currently active for $GENESIS.
            </p>
            <p className="font-sans text-xs text-muted leading-relaxed">
              Check back soon or follow us for updates.
            </p>
          </div>
        </div>

        <div className="pt-5 mt-auto">
          <a
            href="https://stakepoint.app/pools"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto h-11 px-6 rounded-lg bg-surface-card hover:bg-surface-3 border border-line text-white font-sans text-xs font-bold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <span>Explore StakePoint Pools</span>
            <ArrowUpRight className="w-4 h-4 text-pump" />
          </a>
        </div>
      </div>
    );
  }

  // 2. Multiple or single pools: Pick highest APR pool
  const pool = pools[0];
  const hasMultiple = pools.length > 1;

  const aprValue = pool.apr;
  const aprIsPositive = aprValue !== null && aprValue > 0;
  const aprDisplay = aprValue !== null ? `${aprValue.toFixed(1)}%` : '0.0%';

  const tvlDisplay = formatTvlDisplay(pool.tvl);
  const lockDisplay = formatLockPeriodDisplay(pool.lockPeriod);
  const statusDisplay = pool.status || 'Active';

  const hasStats = Boolean(tvlDisplay || lockDisplay || statusDisplay);

  return (
    <div
      data-testid="stakepoint-card"
      className="rounded-xl bg-surface border border-line p-5 sm:p-6 flex flex-col justify-between h-full transition-all"
    >
      <div className="space-y-4">
        {/* Title Header with external link */}
        <div className="flex items-center justify-between">
          <h3 className="font-sans text-base font-extrabold text-white uppercase tracking-tight">
            Staking — $GENESIS
          </h3>
          <a
            href={pool.poolUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted hover:text-pump transition-colors"
            title="Open Pool on StakePoint"
          >
            <ArrowUpRight className="w-4 h-4" />
          </a>
        </div>

        {/* APR Hero Box */}
        <div className="rounded-lg bg-surface-card border border-line p-4 space-y-1">
          <span className="font-sans text-[11px] font-bold text-muted uppercase tracking-wider">
            APR
          </span>
          <div
            className={`font-mono text-[32px] font-bold leading-tight tnum ${
              aprIsPositive ? 'text-pump' : 'text-muted'
            }`}
          >
            {aprDisplay}
          </div>
        </div>

        {/* Stats Row: TVL, Lock Period, Status (Omit entire row if TVL is null and no stats, per §4) */}
        {hasStats && (
          <div className="grid grid-cols-3 gap-3 pt-1">
            {tvlDisplay && (
              <div className="space-y-0.5">
                <span className="block font-sans text-xs uppercase text-muted font-bold tracking-wider">
                  TVL
                </span>
                <span className="font-sans text-base font-semibold text-white tnum">
                  {tvlDisplay}
                </span>
              </div>
            )}

            {lockDisplay && (
              <div className="space-y-0.5">
                <span className="block font-sans text-xs uppercase text-muted font-bold tracking-wider">
                  Lock period
                </span>
                <span className="font-sans text-base font-semibold text-white">
                  {lockDisplay}
                </span>
              </div>
            )}

            {statusDisplay && (
              <div className="space-y-0.5">
                <span className="block font-sans text-xs uppercase text-muted font-bold tracking-wider">
                  Status
                </span>
                <span
                  className={`font-sans text-base font-semibold ${
                    statusDisplay.toLowerCase() === 'active' ? 'text-white' : 'text-muted'
                  }`}
                >
                  {statusDisplay}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* CTA Button */}
      <div className="pt-5 mt-auto space-y-3">
        <div>
          <a
            href={pool.poolUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto h-11 px-6 rounded-lg bg-pump hover:bg-pump-hover text-canvas font-sans font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm"
          >
            <span>Stake on StakePoint →</span>
          </a>
        </div>

        {hasMultiple && (
          <div className="pt-2 border-t border-line/40">
            <a
              href="https://stakepoint.app/pools"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-pump hover:text-pump-hover inline-flex items-center gap-1 transition-colors"
            >
              <span>View all pools →</span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// Server Component implementation per §5
export async function StakePointCard() {
  const mint = process.env.NEXT_PUBLIC_GENESIS_MINT;
  let pools: StakePointPool[] = [];
  let hasError = false;

  try {
    pools = await fetchGenesisPools();
  } catch (error) {
    console.error(`[StakePointCard] Failed to fetch pools for mint ${mint}:`, error);
    hasError = true;
  }

  if (hasError) {
    return <StakePointCardError />;
  }

  return <StakePointCardView pools={pools} />;
}
