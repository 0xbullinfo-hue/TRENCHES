'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useGenesisBalance } from '@/context/GenesisContext';
import { canFetchSessionEndpoints } from '@/lib/auth/sessionGate';
import { formatTokenDisplay, formatUsd } from '@/lib/stake/format';
import { ArrowUpRight, ChevronDown, ChevronUp, Lock, RefreshCw, Sparkles } from 'lucide-react';
import { StakePointPool } from '@/lib/stakepoint/types';
import { formatTvlDisplay, formatLockPeriodDisplay } from '@/components/staking/StakePointCard';
import { TelegramVerificationCard } from '@/components/telegram/TelegramVerificationCard';
import { MarketDataBadge } from '@/components/dashboard/MarketDataBadge';
import { toGenesisProvenanceItem } from '@/lib/stake/provenance';

export { TelegramVerificationCard };

interface StakeStatusResponse {
  wallet: string;
  current_tier: 'free' | 'member' | 'pro';
  stake: {
    amount_raw: string;
    amount_genesis: number;
    amount_usd: number;
    staked_at: string | null;
    unlocks_at: string | null;
    days_remaining: number;
    status: 'active' | 'expired' | 'none';
  };
  thresholds: {
    pro: {
      usd_target: number;
      token_amount: string;
      genesis_usd_price: number;
      lock_days: number;
    };
    twap_source?: string;
    recalculated_at?: string;
    stale?: boolean;
  };
  eligible_for_pro: boolean;
  gap_to_pro_usd: number;
  stakepoint?: {
    configured: boolean;
    program_configured: boolean;
    pool_configured: boolean;
  };
}

function StakePointActionButton({
  ready,
  href,
  label,
  className,
}: {
  ready: boolean;
  href: string;
  label: string;
  className: string;
}) {
  if (ready) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`h-10 sm:h-11 px-6 rounded-lg bg-brand hover:bg-brand-bright text-canvas font-sans font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-none ${className}`}
      >
        <span>{label}</span>
        <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
      </a>
    );
  }

  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title="StakePoint pool and program will be configured after token launch"
      className={`h-10 sm:h-11 px-6 rounded-lg bg-surface-card border border-line text-muted font-sans font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 opacity-60 cursor-not-allowed shadow-none ${className}`}
    >
      <Lock className="w-3.5 h-3.5" />
      <span>{label}</span>
    </button>
  );
}

function StakePointLiveSection({
  pools,
  loading,
  error,
  onRetry,
}: {
  pools: StakePointPool[] | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="rounded-lg bg-surface-card border border-border-default p-3.5 space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-7 w-24" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-surface-card border border-danger/30 p-3 flex items-center justify-between text-xs">
        <span className="text-muted">Couldn&apos;t load staking data.</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          className="h-auto p-0 text-brand hover:text-brand-bright underline font-bold gap-1"
        >
          <RefreshCw className="w-3 h-3" />
          <span>[Retry]</span>
        </Button>
      </div>
    );
  }

  if (!pools || pools.length === 0) {
    return (
      <div className="rounded-lg bg-surface-card border border-border-default p-3.5 space-y-1">
        <div className="font-sans text-xs font-bold text-white">
          No staking pool is currently active for $H42.
        </div>
        <div className="font-sans text-2xs text-muted">
          Check back soon or follow us for updates.
        </div>
      </div>
    );
  }

  const pool = pools[0];
  const aprValue = pool.apr;
  const aprIsPositive = aprValue !== null && aprValue > 0;
  const tvl = formatTvlDisplay(pool.tvl);
  const lock = formatLockPeriodDisplay(pool.lockPeriod);

  return (
    <div className="rounded-lg bg-surface-card border border-border-default p-3.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-sans text-xs font-bold text-muted uppercase tracking-wider">
          LIVE STAKEPOINT APR
        </span>
        {pool.status && (
          <span className="font-sans text-xs font-bold text-brand uppercase">
            ● {pool.status}
          </span>
        )}
      </div>

      <div
        className={`font-mono text-2xl sm:text-3xl font-extrabold leading-tight tnum ${aprIsPositive ? 'text-brand' : 'text-muted'
          }`}
      >
        {aprValue !== null ? `${aprValue.toFixed(1)}%` : '0.0%'}
      </div>

      {(tvl || lock) && (
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border-default/60">
          {tvl && (
            <div>
              <span className="block font-sans text-2xs uppercase text-muted font-bold tracking-wider">
                TVL
              </span>
              <span className="font-sans text-xs sm:text-sm font-semibold text-white tnum">
                {tvl}
              </span>
            </div>
          )}
          {lock && (
            <div>
              <span className="block font-sans text-2xs uppercase text-muted font-bold tracking-wider">
                Lock Period
              </span>
              <span className="font-sans text-xs sm:text-sm font-semibold text-white">
                {lock}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DashboardStakingCard({
  showTelegram = true,
}: {
  showTelegram?: boolean;
} = {}) {
  const {
    connected,
    tier,
    publicKeyBase58,
    needsSignature,
    verificationState,
    demoPreset,
    demoEnabled,
  } = useGenesisBalance();

  const canFetchStakeStatus = canFetchSessionEndpoints(
    {
      connected,
      publicKeyBase58,
      needsSignature,
      verificationState,
      demoEnabled,
      demoPreset,
    },
    false
  );

  const [statusData, setStatusData] = useState<StakeStatusResponse | null>(null);
  const [expanded, setExpanded] = useState(false);
  const fetchGenRef = useRef(0);

  // Live StakePoint API pools
  const [pools, setPools] = useState<StakePointPool[] | null>(null);
  const [poolsLoading, setPoolsLoading] = useState(true);
  const [poolsError, setPoolsError] = useState(false);
  const [poolsConfigured, setPoolsConfigured] = useState<boolean>(
    Boolean(
      process.env.NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID?.trim() &&
        process.env.NEXT_PUBLIC_STAKEPOINT_POOL_ID?.trim()
    )
  );

  const loadPools = useCallback(async () => {
    try {
      setPoolsLoading(true);
      setPoolsError(false);
      const res = await fetch('/api/stakepoint/pools');
      const json = await res.json().catch(() => null);
      if (json && typeof json.configured === 'boolean') {
        setPoolsConfigured(json.configured);
      }
      if (res.ok && json) {
        setPools(json.pools || []);
      } else {
        setPoolsError(true);
      }
    } catch {
      setPoolsError(true);
    } finally {
      setPoolsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPools();
  }, [loadPools]);

  const refreshStakeStatus = useCallback(async () => {
    if (!canFetchStakeStatus || !publicKeyBase58) {
      setStatusData(null);
      return;
    }
    const currentGen = ++fetchGenRef.current;
    try {
      const res = await fetch(`/api/stake/status?wallet=${encodeURIComponent(publicKeyBase58)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        if (currentGen === fetchGenRef.current) {
          setStatusData(json);
        }
      }
    } catch {
      // ignore
    }
  }, [canFetchStakeStatus, publicKeyBase58]);

  useEffect(() => {
    // Immediately clear old wallet data when active wallet or verification state changes
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatusData(null);
    if (!canFetchStakeStatus || !publicKeyBase58) return;

    let active = true;
    const currentGen = ++fetchGenRef.current;
    fetch(`/api/stake/status?wallet=${encodeURIComponent(publicKeyBase58)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!active || currentGen !== fetchGenRef.current || !json) return;
        setStatusData(json);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [canFetchStakeStatus, publicKeyBase58]);

  const isPro = statusData?.current_tier === 'pro';
  const hasActiveStake = statusData?.stake?.status === 'active';
  const isFreeTier = statusData?.current_tier === 'free' || tier?.id === 'LOCKED';
  const gapToPro = statusData?.gap_to_pro_usd ?? 0;
  const currentStakedUsd = statusData?.stake?.amount_usd ?? 0;
  const isPartialStake = currentStakedUsd > 0 && gapToPro > 0;

  // StakePoint pool link & readiness
  const stakePointConfigured = statusData?.stakepoint?.configured ?? poolsConfigured;
  const hasPoolTarget = Boolean(
    process.env.NEXT_PUBLIC_STAKEPOINT_POOL_ID?.trim() || (pools && pools.length > 0)
  );
  const stakePointReady = Boolean(stakePointConfigured && hasPoolTarget);
  const stakePointPoolUrl =
    process.env.NEXT_PUBLIC_STAKEPOINT_POOL_ID
      ? `https://stakepoint.app/pool/${process.env.NEXT_PUBLIC_STAKEPOINT_POOL_ID}`
      : pools?.[0]?.poolUrl || 'https://stakepoint.app/pools';

  // Progress percentage for Pro
  const progressPct = useMemo(() => {
    if (!statusData?.stake?.staked_at || !statusData?.stake?.unlocks_at) return 0;
    const daysLeft = statusData.stake.days_remaining ?? 90;
    return Math.min(100, Math.max(0, Math.round(((90 - daysLeft) / 90) * 100)));
  }, [statusData]);

  // 1. Free Tier / Not Connected: Combined Staking & Requirement Card
  if (!connected || (isFreeTier && !hasActiveStake)) {
    const freeCard = (
      <div className="rounded-xl bg-surface border border-border-default p-5 sm:p-6 transition-all flex flex-col justify-between h-full">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-sans text-base sm:text-lg font-extrabold text-white uppercase tracking-tight">
              Staking — $H42
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-2xs font-mono text-muted uppercase">
                $20 $H42
              </span>
              {stakePointReady && (
                <a
                  href={stakePointPoolUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted hover:text-brand transition-colors"
                  title="Open Pool on StakePoint"
                >
                  <ArrowUpRight className="w-4 h-4" />
                </a>
              )}
            </div>
          </div>

          {/* Live StakePoint Pool Data */}
          <StakePointLiveSection
            pools={pools}
            loading={poolsLoading}
            error={poolsError}
            onRetry={loadPools}
          />
        </div>

        <div className="pt-5 mt-auto space-y-4">
          {/* Access Tier Requirements */}
          <div className="space-y-3">
            <div className="space-y-1">
              <span className="font-sans text-xs font-black text-brand uppercase tracking-wider block">
                MEMBER ACCESS
              </span>
              <p className="font-sans text-xs text-muted leading-relaxed">
                Hold at least $20 worth of $H42 in your connected wallet to unlock Member access.
              </p>
            </div>

            <div className="space-y-1">
              <span className="font-sans text-xs font-black text-white uppercase tracking-wider block">
                PRO ACCESS
              </span>
              <p className="font-sans text-xs text-muted leading-relaxed">
                Stake at least $250 worth of $H42 through StakePoint to unlock Pro access. Qualifying stakes are verified independently of your liquid wallet balance.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <StakePointActionButton
              ready={stakePointReady}
              href={stakePointPoolUrl}
              label="STAKE ON STAKEPOINT"
              className="w-full sm:w-auto"
            />
            <Link
              href="/#choose-your-access"
              className="w-full sm:w-auto h-10 sm:h-11 px-5 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default text-white font-sans text-xs font-bold uppercase tracking-wider inline-flex items-center justify-center transition-colors cursor-pointer"
            >
              <span>VIEW TIERS</span>
            </Link>
          </div>

          {!stakePointReady && (
            <p className="font-sans text-2xs text-muted leading-relaxed">
              Official $H42 StakePoint pool and verification program will be configured after token launch and pool creation.
            </p>
          )}

          {/* Powered by StakePoint. */}
          <p className="font-sans text-2xs text-dim pt-2.5 border-t border-border-default/40">
            Your $H42 is locked for 90 days and cannot be withdrawn until unlock. • Powered by StakePoint
          </p>
        </div>
      </div>
    );

    if (!showTelegram) {
      return freeCard;
    }

    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-stretch">
        <TelegramVerificationCard connected={connected} isPro={false} />
        {freeCard}
      </div>
    );
  }

  // 2. Pro Tier: Combined Active Status & Live Staking Card
  if (isPro && hasActiveStake) {
    const daysLeft = statusData?.stake?.days_remaining ?? 90;

    const proCard = (
      <div className="rounded-xl bg-surface border border-brand/40 hover:border-brand p-5 sm:p-6 transition-colors flex flex-col justify-between h-full">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-sans text-base sm:text-lg font-extrabold text-white uppercase tracking-tight">
              Staking — $H42
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-muted text-xs font-mono">
                ({daysLeft} days remaining)
              </span>
              {stakePointReady && (
                <a
                  href={stakePointPoolUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted hover:text-brand transition-colors"
                  title="Open Pool on StakePoint"
                >
                  <ArrowUpRight className="w-4 h-4" />
                </a>
              )}
            </div>
          </div>

          {/* Live StakePoint Pool Data */}
          <StakePointLiveSection
            pools={pools}
            loading={poolsLoading}
            error={poolsError}
            onRetry={loadPools}
          />
        </div>

        <div className="pt-5 mt-auto space-y-3">
          {/* On top of buttons */}
          <div className="space-y-1.5">
            <h4 className="font-sans text-base font-extrabold text-white uppercase tracking-tight">
              PRO STAKE LOCK ACTIVE
            </h4>

            <p className="font-sans text-xs sm:text-muted leading-relaxed flex items-center gap-2 flex-wrap">
              <span>
                {formatUsd(Number(statusData?.stake?.amount_usd || 250))} staked ({formatTokenDisplay(statusData?.stake?.amount_genesis || 0)} $H42)
              </span>
              <MarketDataBadge item={toGenesisProvenanceItem(statusData?.thresholds)} />
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <StakePointActionButton
              ready={stakePointReady}
              href={stakePointPoolUrl}
              label="STAKE ADDITIONAL"
              className=""
            />

            <Button
              variant="secondary"
              size="md"
              onClick={() => setExpanded(!expanded)}
              className="h-10 sm:h-11 px-4 text-white text-xs font-bold gap-1.5"
            >
              <span>Details</span>
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </Button>
          </div>

          {/* Expanded Progress / Details */}
          {expanded && (
            <div className="pt-3 border-t border-border-default space-y-2 font-sans text-xs">
              <div className="flex justify-between text-2xs font-mono text-muted">
                <span>Lock Duration</span>
                <span>{progressPct}% elapsed</span>
              </div>
              <div className="w-full h-2 bg-canvas rounded-full overflow-hidden border border-border-default">
                <div
                  className="h-full bg-brand rounded-full transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Powered by StakePoint. */}
          <p className="font-sans text-2xs text-dim pt-2.5 border-t border-border-default/40">
            Your $H42 is locked for 90 days and cannot be withdrawn until unlock. • Powered by StakePoint
          </p>
        </div>
      </div>
    );

    if (!showTelegram) {
      return proCard;
    }

    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-stretch">
        <TelegramVerificationCard connected={connected} isPro={true} />
        {proCard}
      </div>
    );
  }

  // 3. Member Tier: Combined Upgrade to Pro & Live Staking Card
  const title = isPartialStake
    ? `Stake $${gapToPro.toFixed(0)} more to unlock Pro`
    : 'Upgrade to Pro';
  const subtitle = isPartialStake
    ? `You currently have ${formatUsd(currentStakedUsd)} staked. Buy and stake the remaining to reach $250.`
    : 'Buy $250 worth of $H42 and Stake for 90 days to unlock real-time signals, push alerts, and full terminal access.';

  const memberCard = (
    <div className="rounded-xl bg-surface border border-brand/40 hover:border-brand p-5 sm:p-6 transition-all duration-150 flex flex-col justify-between h-full">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-sans text-base sm:text-lg font-extrabold text-white uppercase tracking-tight">
            Staking — $H42
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-2xs font-mono text-muted uppercase">
              90-DAY LOCK
            </span>
            {stakePointReady && (
              <a
                href={stakePointPoolUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted hover:text-brand transition-colors"
                title="Open Pool on StakePoint"
              >
                <ArrowUpRight className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>

        {/* Live StakePoint Pool Data */}
        <StakePointLiveSection
          pools={pools}
          loading={poolsLoading}
          error={poolsError}
          onRetry={loadPools}
        />
      </div>

      <div className="pt-5 mt-auto space-y-3">
        {/* On top of the buttons */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-sans text-base sm:text-lg font-extrabold text-white uppercase tracking-tight">
              {title}
            </h4>
            <MarketDataBadge item={toGenesisProvenanceItem(statusData?.thresholds)} />
          </div>

          <p className="font-sans text-xs sm:text-sm text-muted leading-relaxed">
            {subtitle}
          </p>
        </div>

        <div>
          <StakePointActionButton
            ready={stakePointReady}
            href={stakePointPoolUrl}
            label="STAKE $H42"
            className="w-full sm:w-auto"
          />
        </div>

        {!stakePointReady && (
          <p className="font-sans text-2xs text-muted leading-relaxed">
            Official $H42 StakePoint pool and verification program will be configured after token launch and pool creation.
          </p>
        )}

        {pools && pools.length > 1 && (
          <div className="pt-1.5 border-t border-border-default/40">
            <a
              href="https://stakepoint.app/pools"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-brand hover:text-brand-bright inline-flex items-center gap-1 transition-colors"
            >
              <span>View all pools →</span>
            </a>
          </div>
        )}

        {/* Powered by StakePoint. */}
        <p className="font-sans text-2xs text-dim pt-2.5 border-t border-border-default/40">
          Your $H42 is locked for 90 days and cannot be withdrawn until unlock. • Powered by StakePoint
        </p>
      </div>
    </div>
  );

  if (!showTelegram) {
    return memberCard;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-stretch">
      {/* 1. LEFT CARD: Telegram Call Alerts & Get Verified Button */}
      <TelegramVerificationCard connected={connected} isPro={false} />

      {/* 2. RIGHT CARD: Staking Card */}
      {memberCard}
    </div>
  );
}

