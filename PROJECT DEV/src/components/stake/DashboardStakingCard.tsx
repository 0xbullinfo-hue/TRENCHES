'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useGenesisBalance } from '@/context/GenesisContext';
import { formatTokenDisplay, formatUsd, getUnlockDate } from '@/lib/stake/format';
import { ArrowUpRight, ChevronDown, ChevronUp, Lock, Sparkles } from 'lucide-react';

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

export function DashboardStakingCard() {
  const { connected, tier } = useGenesisBalance();

  const [statusData, setStatusData] = useState<StakeStatusResponse | null>(null);
  const [expanded, setExpanded] = useState(false);

  const refreshStakeStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/stake/status');
      if (res.ok) {
        const json = await res.json();
        setStatusData(json);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!connected) return;
    let active = true;
    fetch('/api/stake/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!active || !json) return;
        setStatusData(json);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [connected]);

  const unlockDateStr = useMemo(() => getUnlockDate(90), []);

  const isPro = statusData?.current_tier === 'pro';
  const hasActiveStake = statusData?.stake?.status === 'active';
  const isFreeTier = statusData?.current_tier === 'free' || tier?.id === 'LOCKED';
  const gapToPro = statusData?.gap_to_pro_usd ?? 0;
  const currentStakedUsd = statusData?.stake?.amount_usd ?? 0;
  const isPartialStake = currentStakedUsd > 0 && gapToPro > 0;

  // Streamflow pool link
  const poolAddr = process.env.NEXT_PUBLIC_STREAMFLOW_POOL_ADDRESS || '';
  const streamflowUrl = poolAddr
    ? `https://app.streamflow.finance/stake/${poolAddr}`
    : 'https://app.streamflow.finance';

  // Progress percentage for Pro
  const progressPct = useMemo(() => {
    if (!statusData?.stake?.staked_at || !statusData?.stake?.unlocks_at) return 0;
    const daysLeft = statusData.stake.days_remaining ?? 90;
    return Math.min(100, Math.max(0, Math.round(((90 - daysLeft) / 90) * 100)));
  }, [statusData]);

  // 1. Free Tier / Not Connected: Compact link to tier section (§4)
  if (!connected || (isFreeTier && !hasActiveStake)) {
    return (
      <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-sans text-muted">
          <Sparkles className="w-4 h-4 text-toxic shrink-0" />
          <span>Hold $20 in $GENESIS to unlock Member tier before staking for Pro.</span>
        </div>
        <Link
          href="/#choose-your-access"
          className="text-xs font-bold uppercase tracking-wider text-toxic hover:text-white inline-flex items-center gap-1 shrink-0 transition-colors"
        >
          <span>Upgrade to Member to stake →</span>
        </Link>
      </div>
    );
  }

  // 2. Pro Tier: Collapsed status pill, expands to show details (§4)
  if (isPro && hasActiveStake) {
    const daysLeft = statusData?.stake?.days_remaining ?? 90;

    return (
      <div className="rounded-lg bg-neutral-900 border border-neutral-800 transition-colors">
        {/* Collapsed Header / Pill */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full p-4 sm:px-6 flex items-center justify-between text-left cursor-pointer hover:bg-neutral-800/40 transition-colors rounded-lg"
        >
          <div className="flex items-center gap-2">
            <span className="text-base select-none">💎</span>
            <span className="font-sans text-sm font-bold text-white uppercase tracking-wider">
              Pro active
            </span>
            <span className="text-muted text-xs font-mono">
              · {daysLeft} days remaining
            </span>
          </div>

          <div className="p-1 rounded bg-neutral-800 text-muted hover:text-white">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {/* Expanded Details */}
        {expanded && (
          <div className="p-4 sm:p-6 pt-0 space-y-4 border-t border-neutral-800/60 font-sans text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4">
              <div>
                <span className="text-muted uppercase text-2xs block mb-0.5">Staked</span>
                <span className="text-white font-bold text-sm tnum">
                  {formatUsd(Number(statusData?.stake?.amount_usd || 250))}
                </span>{' '}
                <span className="text-muted font-mono">
                  ({formatTokenDisplay(statusData?.stake?.amount_genesis || 0)} $GENESIS)
                </span>
              </div>

              <div>
                <span className="text-muted uppercase text-2xs block mb-0.5">Locked until</span>
                <span className="text-white font-medium text-xs">
                  {statusData?.stake?.unlocks_at ? new Date(statusData.stake.unlocks_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '90 days'}{' '}
                  <span className="text-muted font-mono">({daysLeft} days remaining)</span>
                </span>
              </div>
            </div>

            {/* Progress Bar (8px height, rounded-full) */}
            <div className="space-y-1">
              <div className="flex justify-between text-2xs font-mono text-muted">
                <span>Lock Duration</span>
                <span>{progressPct}% elapsed</span>
              </div>
              <div className="w-full h-2 bg-neutral-950 rounded-full overflow-hidden border border-neutral-800">
                <div
                  className="h-full bg-toxic rounded-full transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <a
                href={streamflowUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-xs uppercase tracking-wider text-toxic hover:text-toxic-bright inline-flex items-center gap-1 transition-colors"
              >
                <span>Stake additional on Streamflow</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>

              <a
                href={streamflowUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted hover:text-white inline-flex items-center gap-1 font-mono text-xs transition-colors"
              >
                <span>View on Streamflow</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 3. Member Tier: Clean Staking Card with Streamflow platform button
  const title = isPartialStake
    ? `Stake $${gapToPro.toFixed(0)} more to unlock Pro`
    : 'Upgrade to Pro';
  const subtitle = isPartialStake
    ? `You currently have ${formatUsd(currentStakedUsd)} staked. Complete your stake on Streamflow to reach the $250 requirement.`
    : 'Stake $250 of $GENESIS for 90 days on Streamflow to unlock real-time signals, push alerts, and full terminal access.';

  return (
    <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-6 sm:p-8 space-y-5">
      {/* Title & Subtitle */}
      <div className="space-y-1">
        <h3 className="font-sans text-lg sm:text-xl font-semibold text-white tracking-tight">
          {title}
        </h3>
        <p className="font-sans text-xs sm:text-sm text-muted leading-relaxed max-w-2xl">
          {subtitle}
        </p>
      </div>

      {/* Lock Line */}
      <div className="flex items-center gap-2 font-sans text-xs text-muted">
        <Lock className="w-3.5 h-3.5 text-toxic shrink-0" />
        <span>90-day lock · Unlocks {unlockDateStr}</span>
      </div>

      {/* Direct Stake Button to Streamflow Platform */}
      <div className="pt-2">
        <a
          href={streamflowUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full sm:w-auto h-12 px-6 rounded-md bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-sm uppercase tracking-wide inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <span>Stake $GENESIS on Streamflow</span>
          <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
        </a>
      </div>

      {/* Non-negotiable Disclaimer per §4 and AC 28 */}
      <p className="font-sans text-xs text-muted leading-relaxed pt-1">
        Your $GENESIS is locked for 90 days and cannot be withdrawn until unlock. Powered by Streamflow.
      </p>
    </div>
  );
}
