'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useGenesisBalance } from '@/context/GenesisContext';
import { formatTokenDisplay, formatUsd } from '@/lib/stake/format';
import { ArrowUpRight, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

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

  // 1. Free Tier / Not Connected: Compact banner (aligned with other cards, button left, text right)
  if (!connected || (isFreeTier && !hasActiveStake)) {
    return (
      <div className="rounded-xl bg-surface border border-line p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all">
        {/* LEFT: Button */}
        <div className="shrink-0 order-2 sm:order-1">
          <Link
            href="/#choose-your-access"
            className="h-10 sm:h-11 px-5 sm:px-6 rounded-lg bg-surface-card hover:bg-surface-3 border border-toxic/40 hover:border-toxic text-toxic hover:text-white font-sans text-xs font-black uppercase tracking-wider inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>Upgrade to Member to stake →</span>
          </Link>
        </div>

        {/* RIGHT: Text */}
        <div className="flex items-center sm:justify-end gap-2 text-xs font-sans text-muted order-1 sm:order-2 sm:text-right">
          <Sparkles className="w-4 h-4 text-toxic shrink-0" />
          <span>Hold $20 in $GENESIS to unlock Member tier before staking for Pro.</span>
        </div>
      </div>
    );
  }

  // 2. Pro Tier: Active status card (aligned with other cards, button left, text right)
  if (isPro && hasActiveStake) {
    const daysLeft = statusData?.stake?.days_remaining ?? 90;

    return (
      <div className="rounded-xl bg-surface border border-toxic/40 hover:border-toxic p-4 sm:p-5 transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* LEFT: Action Buttons (Proportional button) */}
          <div className="shrink-0 flex items-center gap-2.5 order-2 sm:order-1">
            <a
              href={streamflowUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="h-10 sm:h-11 px-5 sm:px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm"
            >
              <span>STAKE ADDITIONAL</span>
              <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
            </a>

            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="h-10 sm:h-11 px-4 rounded-lg bg-surface-card hover:bg-surface-3 border border-line text-white font-sans text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <span>Details</span>
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* RIGHT: Text Status */}
          <div className="space-y-1 sm:text-right order-1 sm:order-2">
            <div className="flex flex-wrap items-center sm:justify-end gap-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-toxic/15 text-toxic border border-toxic/30 font-sans text-xs font-black uppercase">
                💎 PRO MEMBERSHIP ACTIVE
              </span>
              <span className="text-muted text-xs font-mono">
                ({daysLeft} days remaining)
              </span>
            </div>
            <p className="font-sans text-xs text-muted">
              {formatUsd(Number(statusData?.stake?.amount_usd || 250))} staked ({formatTokenDisplay(statusData?.stake?.amount_genesis || 0)} $GENESIS) • Powered by Streamflow.
            </p>
          </div>
        </div>

        {/* Expanded Progress / Details */}
        {expanded && (
          <div className="pt-4 mt-4 border-t border-line space-y-3 font-sans text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <span className="text-muted uppercase text-2xs block mb-0.5">Staked Amount</span>
                <span className="text-white font-bold text-sm tnum">
                  {formatUsd(Number(statusData?.stake?.amount_usd || 250))}
                </span>{' '}
                <span className="text-muted font-mono">
                  ({formatTokenDisplay(statusData?.stake?.amount_genesis || 0)} $GENESIS)
                </span>
              </div>

              <div className="sm:text-right">
                <span className="text-muted uppercase text-2xs block mb-0.5">Locked until</span>
                <span className="text-white font-medium text-xs">
                  {statusData?.stake?.unlocks_at ? new Date(statusData.stake.unlocks_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '90 days'}{' '}
                  <span className="text-muted font-mono">({daysLeft} days remaining)</span>
                </span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-2xs font-mono text-muted">
                <span>Lock Duration</span>
                <span>{progressPct}% elapsed</span>
              </div>
              <div className="w-full h-2 bg-canvas rounded-full overflow-hidden border border-line">
                <div
                  className="h-full bg-toxic rounded-full transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 3. Member Tier: Prominent Staking Card (aligned with other cards, proportional button on left, text on right)
  const title = isPartialStake
    ? `Stake $${gapToPro.toFixed(0)} more to unlock Pro`
    : 'Upgrade to Pro';
  const subtitle = isPartialStake
    ? `You currently have ${formatUsd(currentStakedUsd)} staked. Buy and stake the remaining to reach $250.`
    : 'Buy $250 worth of $GENESIS and Stake for 90 days to unlock real-time signals, push alerts, and full terminal access.';

  return (
    <div className="rounded-xl bg-surface border border-toxic/40 hover:border-toxic p-4 sm:p-5 transition-all duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6">
        {/* LEFT: Stake Button (Proportional & cleanly aligned) */}
        <div className="shrink-0 order-2 sm:order-1">
          <a
            href={streamflowUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto h-10 sm:h-11 px-5 sm:px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm"
          >
            <span>STAKE $GENESIS</span>
            <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
          </a>
        </div>

        {/* RIGHT: Text (Title, 2-line Subtitle) */}
        <div className="flex-1 space-y-1 sm:text-right order-1 sm:order-2">
          <div className="flex flex-wrap items-center sm:justify-end gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-toxic/15 text-toxic border border-toxic/30 font-sans text-xs font-black uppercase">
              <Sparkles className="w-3 h-3" />
              <span>PRO TIER ACCESS</span>
            </span>
            <h3 className="font-sans text-base sm:text-lg font-extrabold text-white uppercase tracking-tight">
              {title}
            </h3>
          </div>

          <p className="font-sans text-xs sm:text-sm text-muted leading-relaxed sm:ml-auto">
            <span className="sm:block">Buy $250 worth of $GENESIS and Stake for 90 days</span>
            <span className="sm:block">to unlock real-time signals, push alerts, and full terminal access.</span>
          </p>
        </div>
      </div>

      {/* Non-negotiable Disclaimer per §4 and AC 28 */}
      <p className="font-sans text-2xs text-dim text-center sm:text-right pt-2.5 border-t border-line/40 mt-3">
        Your $GENESIS is locked for 90 days and cannot be withdrawn until unlock. • Powered by Streamflow.
      </p>
    </div>
  );
}
