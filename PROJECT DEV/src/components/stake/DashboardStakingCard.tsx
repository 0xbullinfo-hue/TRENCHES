'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useGenesisBalance } from '@/context/GenesisContext';
import { formatTokenDisplay, formatUsd } from '@/lib/stake/format';
import { ArrowUpRight, ChevronDown, ChevronUp, Send, Sparkles } from 'lucide-react';

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

function TelegramVerificationCard({
  connected,
  isPro,
}: {
  connected: boolean;
  isPro: boolean;
}) {
  const [openingTg, setOpeningTg] = useState(false);

  const handleTelegramVerify = async (e: React.MouseEvent) => {
    if (!connected) return;
    try {
      e.preventDefault();
      setOpeningTg(true);
      const targetTier = isPro ? 'pro' : 'member';
      const res = await fetch('/api/verification/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_tier: targetTier }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.deep_link) {
          window.open(json.deep_link, '_blank', 'noopener,noreferrer');
          return;
        }
      }
      window.open('https://t.me/Trenchlabs_bot', '_blank', 'noopener,noreferrer');
    } catch {
      window.open('https://t.me/Trenchlabs_bot', '_blank', 'noopener,noreferrer');
    } finally {
      setOpeningTg(false);
    }
  };

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
        <div>
          <a
            href="https://t.me/Trenchlabs_bot"
            onClick={handleTelegramVerify}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto h-10 sm:h-11 px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm"
          >
            <Send className="w-3.5 h-3.5 fill-current" />
            <span>{openingTg ? 'CONNECTING...' : 'GET VERIFIED'}</span>
            <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
          </a>
        </div>

        <p className="font-sans text-2xs text-dim pt-2.5 border-t border-line/40">
          Direct bot verification via @Trenchlabs_bot • Member &amp; Pro channels
        </p>
      </div>
    </div>
  );
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

  // 1. Free Tier / Not Connected: Split 2-column grid
  if (!connected || (isFreeTier && !hasActiveStake)) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-stretch">
        {/* LEFT: Telegram Get Verified Card */}
        <TelegramVerificationCard connected={connected} isPro={false} />

        {/* RIGHT: Upgrade Requirement Card */}
        <div className="rounded-xl bg-surface border border-line p-5 sm:p-6 transition-all flex flex-col justify-between h-full">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-surface-card text-muted border border-line font-sans text-xs font-bold uppercase">
                <Sparkles className="w-3 h-3 text-toxic" />
                <span>MEMBER REQUIREMENT</span>
              </span>
              <span className="text-2xs font-mono text-muted uppercase">
                $20 $GENESIS
              </span>
            </div>

            <h3 className="font-sans text-base sm:text-lg font-extrabold text-white uppercase tracking-tight">
              HOLD $GENESIS TO UNLOCK STAKING
            </h3>

            <p className="font-sans text-xs sm:text-sm text-muted leading-relaxed">
              Hold at least $20 in $GENESIS to unlock Member tier access before staking for Pro 90-day locks.
            </p>
          </div>

          <div className="pt-5 mt-auto space-y-3">
            <div>
              <Link
                href="/#choose-your-access"
                className="w-full sm:w-auto h-10 sm:h-11 px-6 rounded-lg bg-surface-card hover:bg-surface-3 border border-toxic/40 hover:border-toxic text-toxic hover:text-white font-sans text-xs font-black uppercase tracking-wider inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Upgrade to Member to stake →</span>
              </Link>
            </div>

            <p className="font-sans text-2xs text-dim pt-2.5 border-t border-line/40">
              Powered by Streamflow.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 2. Pro Tier: Split 2-column grid with Active Status on right
  if (isPro && hasActiveStake) {
    const daysLeft = statusData?.stake?.days_remaining ?? 90;

    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-stretch">
        {/* LEFT: Telegram Get Verified Card */}
        <TelegramVerificationCard connected={connected} isPro={true} />

        {/* RIGHT: Pro Active Status Card */}
        <div className="rounded-xl bg-surface border border-toxic/40 hover:border-toxic p-5 sm:p-6 transition-colors flex flex-col justify-between h-full">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-toxic/15 text-toxic border border-toxic/30 font-sans text-xs font-black uppercase">
                💎 PRO MEMBERSHIP ACTIVE
              </span>
              <span className="text-muted text-xs font-mono">
                ({daysLeft} days remaining)
              </span>
            </div>

            <h3 className="font-sans text-base sm:text-lg font-extrabold text-white uppercase tracking-tight">
              PRO STAKE LOCK ACTIVE
            </h3>

            <p className="font-sans text-xs sm:text-muted leading-relaxed">
              {formatUsd(Number(statusData?.stake?.amount_usd || 250))} staked ({formatTokenDisplay(statusData?.stake?.amount_genesis || 0)} $GENESIS) • Powered by Streamflow.
            </p>
          </div>

          <div className="pt-5 mt-auto space-y-3">
            <div className="flex items-center gap-2.5">
              <a
                href={streamflowUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="h-10 sm:h-11 px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm"
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

            {/* Expanded Progress / Details */}
            {expanded && (
              <div className="pt-3 border-t border-line space-y-2 font-sans text-xs">
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
            )}

            <p className="font-sans text-2xs text-dim pt-2.5 border-t border-line/40">
              Your $GENESIS is locked for 90 days and cannot be withdrawn until unlock. • Powered by Streamflow.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 3. Member Tier: Split 2-column grid (Telegram on Left, Stake on Right)
  const title = isPartialStake
    ? `Stake $${gapToPro.toFixed(0)} more to unlock Pro`
    : 'Upgrade to Pro';
  const subtitle = isPartialStake
    ? `You currently have ${formatUsd(currentStakedUsd)} staked. Buy and stake the remaining to reach $250.`
    : 'Buy $250 worth of $GENESIS and Stake for 90 days to unlock real-time signals, push alerts, and full terminal access.';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-stretch">
      {/* 1. LEFT CARD: Telegram Call Alerts & Get Verified Button */}
      <TelegramVerificationCard connected={connected} isPro={false} />

      {/* 2. RIGHT CARD: Staking Card */}
      <div className="rounded-xl bg-surface border border-toxic/40 hover:border-toxic p-5 sm:p-6 transition-all duration-200 flex flex-col justify-between h-full">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-toxic/15 text-toxic border border-toxic/30 font-sans text-xs font-black uppercase">
              <Sparkles className="w-3 h-3" />
              <span>PRO TIER ACCESS</span>
            </span>
            <span className="text-2xs font-mono text-muted uppercase">
              90-DAY LOCK
            </span>
          </div>

          <h3 className="font-sans text-base sm:text-lg font-extrabold text-white uppercase tracking-tight">
            {title}
          </h3>

          <p className="font-sans text-xs sm:text-sm text-muted leading-relaxed">
            {subtitle}
          </p>
        </div>

        <div className="pt-5 mt-auto space-y-3">
          <div>
            <a
              href={streamflowUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto h-10 sm:h-11 px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm"
            >
              <span>STAKE $GENESIS</span>
              <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
            </a>
          </div>

          {/* Non-negotiable Disclaimer per §4 and AC 28 */}
          <p className="font-sans text-2xs text-dim pt-2.5 border-t border-line/40">
            Your $GENESIS is locked for 90 days and cannot be withdrawn until unlock. • Powered by Streamflow.
          </p>
        </div>
      </div>
    </div>
  );
}
