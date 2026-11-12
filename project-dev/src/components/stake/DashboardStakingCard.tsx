'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useGenesisBalance } from '@/context/GenesisContext';
import { formatTokenDisplay, formatUsd } from '@/lib/stake/format';
import { ArrowUpRight, Check, ChevronDown, ChevronUp, RefreshCw, Send, Sparkles } from 'lucide-react';
import { StakePointPool } from '@/lib/stakepoint/types';
import { formatTvlDisplay, formatLockPeriodDisplay } from '@/components/staking/StakePointCard';
import { useTelegramLink } from '@/components/dashboard/TelegramAlerts';

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
  };
  eligible_for_pro: boolean;
  gap_to_pro_usd: number;
}

export function TelegramVerificationCard({
  connected,
  isPro,
}: {
  connected: boolean;
  isPro: boolean;
}) {
  const { status, message, start, stop, publicKeyBase58 } = useTelegramLink();

  return (
    <div className="rounded-xl bg-surface border border-toxic/40 hover:border-toxic p-5 sm:p-6 transition-all duration-200 flex flex-col justify-between h-full">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-toxic/15 text-toxic border border-toxic/30 font-sans text-xs font-black uppercase">
            <Send className="w-3 h-3 text-toxic" />
            <span>TELEGRAM ALERTS</span>
          </span>
          <span className="text-2xs font-mono text-muted uppercase">
            FAST SIGNALS
          </span>
        </div>

        <h3 className="font-sans text-base sm:text-lg font-extrabold text-white uppercase tracking-tight">
          GET CALL NOTIFICATIONS
        </h3>

        <p className="font-sans text-xs sm:text-sm text-muted leading-relaxed">
          After buying GENESIS on your preferred tier get instant notifications on all calls fast on Telegram. More call Details remain here on dashboard
        </p>
      </div>

      <div className="pt-5 mt-auto space-y-3">
        {status === 'linked' ? (
          <div className="flex items-center justify-between w-full px-4 py-2.5 rounded-lg bg-toxic-bg border border-toxic-border font-mono text-xs">
            <span className="inline-flex items-center gap-1.5 text-toxic font-bold uppercase text-[11px]">
              <Check className="w-4 h-4 stroke-[2.5]" /> Telegram alerts on
            </span>
            <button
              type="button"
              onClick={stop}
              className="text-muted hover:text-danger text-xs font-sans font-bold underline cursor-pointer"
            >
              Turn off
            </button>
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={start}
              disabled={!connected || !publicKeyBase58 || status === 'working' || status === 'waiting'}
              className="w-full sm:w-auto h-10 sm:h-11 px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-none disabled:opacity-60 disabled:cursor-default"
            >
              <Send className="w-3.5 h-3.5 fill-current" />
              <span>
                {status === 'waiting'
                  ? 'Press Start in Telegram…'
                  : status === 'working'
                    ? 'CONNECTING...'
                    : 'GET VERIFIED'}
              </span>
              <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        )}

        {message && (
          <p className="font-sans text-xs text-danger font-semibold">{message}</p>
        )}

        <p className="font-sans text-2xs text-dim pt-2.5 border-t border-border-default/40">
          Direct bot verification via @Trenchlabs_bot • Member &amp; Pro channels
        </p>
      </div>
    </div>
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
      <div className="rounded-lg bg-surface-card border border-border-default p-3.5 space-y-2 animate-pulse">
        <div className="h-3 w-28 bg-surface rounded" />
        <div className="h-7 w-24 bg-surface rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-surface-card border border-danger/30 p-3 flex items-center justify-between text-xs">
        <span className="text-muted">Couldn&apos;t load staking data.</span>
        <button
          type="button"
          onClick={onRetry}
          className="text-toxic hover:text-toxic-bright underline font-bold cursor-pointer inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" />
          <span>[Retry]</span>
        </button>
      </div>
    );
  }

  if (!pools || pools.length === 0) {
    return (
      <div className="rounded-lg bg-surface-card border border-border-default p-3.5 space-y-1">
        <div className="font-sans text-xs font-bold text-white">
          No staking pool is currently active for $GENESIS.
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
        <span className="font-sans text-[11px] font-bold text-muted uppercase tracking-wider">
          LIVE STAKEPOINT APR
        </span>
        {pool.status && (
          <span className="font-sans text-[11px] font-bold text-toxic uppercase">
            ● {pool.status}
          </span>
        )}
      </div>

      <div
        className={`font-mono text-2xl sm:text-3xl font-extrabold leading-tight tnum ${
          aprIsPositive ? 'text-toxic' : 'text-muted'
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
  const { connected, tier, publicKeyBase58 } = useGenesisBalance();

  const [statusData, setStatusData] = useState<StakeStatusResponse | null>(null);
  const [expanded, setExpanded] = useState(false);
  const fetchGenRef = useRef(0);

  // Live StakePoint API pools
  const [pools, setPools] = useState<StakePointPool[] | null>(null);
  const [poolsLoading, setPoolsLoading] = useState(true);
  const [poolsError, setPoolsError] = useState(false);

  const loadPools = useCallback(async () => {
    try {
      setPoolsLoading(true);
      setPoolsError(false);
      const res = await fetch('/api/stakepoint/pools');
      if (res.ok) {
        const json = await res.json();
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
    if (!connected || !publicKeyBase58) {
      setStatusData(null);
      return;
    }
    const currentGen = ++fetchGenRef.current;
    try {
      const res = await fetch(`/api/stake/status?wallet=${encodeURIComponent(publicKeyBase58)}`);
      if (res.ok) {
        const json = await res.json();
        if (currentGen === fetchGenRef.current) {
          setStatusData(json);
        }
      }
    } catch {
      // ignore
    }
  }, [connected, publicKeyBase58]);

  useEffect(() => {
    // Immediately clear old wallet data when active wallet changes
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatusData(null);
    if (!connected || !publicKeyBase58) return;

    let active = true;
    const currentGen = ++fetchGenRef.current;
    fetch(`/api/stake/status?wallet=${encodeURIComponent(publicKeyBase58)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!active || currentGen !== fetchGenRef.current || !json) return;
        setStatusData(json);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [connected, publicKeyBase58]);

  const isPro = statusData?.current_tier === 'pro';
  const hasActiveStake = statusData?.stake?.status === 'active';
  const isFreeTier = statusData?.current_tier === 'free' || tier?.id === 'LOCKED';
  const gapToPro = statusData?.gap_to_pro_usd ?? 0;
  const currentStakedUsd = statusData?.stake?.amount_usd ?? 0;
  const isPartialStake = currentStakedUsd > 0 && gapToPro > 0;

  // StakePoint pool link
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
              Staking — $GENESIS
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-2xs font-mono text-muted uppercase">
                $20 $GENESIS
              </span>
              <a
                href={stakePointPoolUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted hover:text-toxic transition-colors"
                title="Open Pool on StakePoint"
              >
                <ArrowUpRight className="w-4 h-4" />
              </a>
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
              <span className="font-sans text-xs font-black text-toxic uppercase tracking-wider block">
                MEMBER ACCESS
              </span>
              <p className="font-sans text-xs text-muted leading-relaxed">
                Hold at least $20 worth of $GENESIS in your connected wallet to unlock Member access.
              </p>
            </div>

            <div className="space-y-1">
              <span className="font-sans text-xs font-black text-white uppercase tracking-wider block">
                PRO ACCESS
              </span>
              <p className="font-sans text-xs text-muted leading-relaxed">
                Stake at least $250 worth of $GENESIS through StakePoint to unlock Pro access. Qualifying stakes are verified independently of your liquid wallet balance.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <a
              href={stakePointPoolUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto h-10 sm:h-11 px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-none"
            >
              <span>STAKE ON STAKEPOINT</span>
              <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
            </a>
            <Link
              href="/#choose-your-access"
              className="w-full sm:w-auto h-10 sm:h-11 px-5 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default text-white font-sans text-xs font-bold uppercase tracking-wider inline-flex items-center justify-center transition-colors cursor-pointer"
            >
              <span>VIEW TIERS</span>
            </Link>
          </div>

          {/* Powered by StakePoint. */}
          <p className="font-sans text-2xs text-dim pt-2.5 border-t border-border-default/40">
            Your $GENESIS is locked for 90 days and cannot be withdrawn until unlock. • Powered by StakePoint
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
      <div className="rounded-xl bg-surface border border-toxic/40 hover:border-toxic p-5 sm:p-6 transition-colors flex flex-col justify-between h-full">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-sans text-base sm:text-lg font-extrabold text-white uppercase tracking-tight">
              Staking — $GENESIS
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-muted text-xs font-mono">
                ({daysLeft} days remaining)
              </span>
              <a
                href={stakePointPoolUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted hover:text-toxic transition-colors"
                title="Open Pool on StakePoint"
              >
                <ArrowUpRight className="w-4 h-4" />
              </a>
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

            <p className="font-sans text-xs sm:text-muted leading-relaxed">
              {formatUsd(Number(statusData?.stake?.amount_usd || 250))} staked ({formatTokenDisplay(statusData?.stake?.amount_genesis || 0)} $GENESIS)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <a
              href={stakePointPoolUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="h-10 sm:h-11 px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-none"
            >
              <span>STAKE ADDITIONAL</span>
              <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
            </a>

            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="h-10 sm:h-11 px-4 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default text-white font-sans text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <span>Details</span>
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
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
                  className="h-full bg-toxic rounded-full transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Powered by StakePoint. */}
          <p className="font-sans text-2xs text-dim pt-2.5 border-t border-border-default/40">
            Your $GENESIS is locked for 90 days and cannot be withdrawn until unlock. • Powered by StakePoint
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
    : 'Buy $250 worth of $GENESIS and Stake for 90 days to unlock real-time signals, push alerts, and full terminal access.';

  const memberCard = (
    <div className="rounded-xl bg-surface border border-toxic/40 hover:border-toxic p-5 sm:p-6 transition-all duration-200 flex flex-col justify-between h-full">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-sans text-base sm:text-lg font-extrabold text-white uppercase tracking-tight">
            Staking — $GENESIS
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-2xs font-mono text-muted uppercase">
              90-DAY LOCK
            </span>
            <a
              href={stakePointPoolUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-toxic transition-colors"
              title="Open Pool on StakePoint"
            >
              <ArrowUpRight className="w-4 h-4" />
            </a>
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
          <h4 className="font-sans text-base sm:text-lg font-extrabold text-white uppercase tracking-tight">
            {title}
          </h4>

          <p className="font-sans text-xs sm:text-sm text-muted leading-relaxed">
            {subtitle}
          </p>
        </div>

        <div>
          <a
            href={stakePointPoolUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto h-10 sm:h-11 px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-none"
          >
            <span>STAKE $GENESIS</span>
            <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
          </a>
        </div>

        {pools && pools.length > 1 && (
          <div className="pt-1.5 border-t border-border-default/40">
            <a
              href="https://stakepoint.app/pools"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-toxic hover:text-toxic-bright inline-flex items-center gap-1 transition-colors"
            >
              <span>View all pools →</span>
            </a>
          </div>
        )}

        {/* Powered by StakePoint. */}
        <p className="font-sans text-2xs text-dim pt-2.5 border-t border-border-default/40">
          Your $GENESIS is locked for 90 days and cannot be withdrawn until unlock. • Powered by StakePoint
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

