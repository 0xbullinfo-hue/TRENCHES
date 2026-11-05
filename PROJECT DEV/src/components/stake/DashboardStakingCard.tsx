'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useGenesisBalance } from '@/context/GenesisContext';
import { useStreamflowStake } from '@/lib/stake/streamflow';
import { cleanNumericInput, formatTokenDisplay, formatUsd, getUnlockDate } from '@/lib/stake/format';
import { TOKEN_DECIMALS } from '@/lib/config';
import { ArrowUpRight, ChevronDown, ChevronUp, Lock, Loader2, Sparkles } from 'lucide-react';

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
  const { connected, tier, refreshAll } = useGenesisBalance();
  const { stake: streamflowStake } = useStreamflowStake();

  const [statusData, setStatusData] = useState<StakeStatusResponse | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Form states for Member
  const [usdInput, setUsdInput] = useState('250');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showTopupForm, setShowTopupForm] = useState(false);

  const refreshStakeStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/stake/status');
      if (res.ok) {
        const json = await res.json();
        setStatusData(json);
        if (json.gap_to_pro_usd > 0) {
          setUsdInput(json.gap_to_pro_usd.toString());
        }
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
        if (json.gap_to_pro_usd > 0) {
          setUsdInput(json.gap_to_pro_usd.toString());
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [connected]);

  // Derived calculations
  const genesisPrice = statusData?.thresholds?.pro?.genesis_usd_price || 0.0000164;
  const numUsd = Number(cleanNumericInput(usdInput)) || 0;
  const equivalentTokens = genesisPrice > 0 ? numUsd / genesisPrice : 0;
  const rawBigInt = BigInt(Math.floor(equivalentTokens * Math.pow(10, TOKEN_DECIMALS)));
  const unlockDateStr = useMemo(() => getUnlockDate(90), []);

  const isPro = statusData?.current_tier === 'pro';
  const hasActiveStake = statusData?.stake?.status === 'active';
  const isFreeTier = statusData?.current_tier === 'free' || tier?.id === 'LOCKED';
  const gapToPro = statusData?.gap_to_pro_usd ?? 0;
  const currentStakedUsd = statusData?.stake?.amount_usd ?? 0;
  const isPartialStake = currentStakedUsd > 0 && gapToPro > 0;

  // Progress percentage for Pro
  const progressPct = useMemo(() => {
    if (!statusData?.stake?.staked_at || !statusData?.stake?.unlocks_at) return 0;
    const daysLeft = statusData.stake.days_remaining ?? 90;
    return Math.min(100, Math.max(0, Math.round(((90 - daysLeft) / 90) * 100)));
  }, [statusData]);

  // 1. Not connected: do not render (§4)
  if (!connected) {
    return null;
  }

  // 2. Free Tier: Compact link to tier section (§4)
  if (isFreeTier && !hasActiveStake) {
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

  // 3. Pro Tier: Collapsed status pill, expands to show details (§4)
  if (isPro && hasActiveStake && !showTopupForm) {
    const daysLeft = statusData?.stake?.days_remaining ?? 90;
    const poolAddr = process.env.NEXT_PUBLIC_STREAMFLOW_POOL_ADDRESS || '';
    const streamflowUrl = poolAddr
      ? `https://app.streamflow.finance/stake/${poolAddr}`
      : 'https://app.streamflow.finance';

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

        {/* Expanded Details (§4) */}
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
              <button
                type="button"
                onClick={() => setShowTopupForm(true)}
                className="font-bold text-xs uppercase tracking-wider text-toxic hover:underline cursor-pointer"
              >
                Stake additional →
              </button>

              <a
                href={streamflowUrl}
                target="_blank"
                rel="noreferrer"
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

  // 4. Member Tier: Prominent Expanded Form (§4)
  const title = isPartialStake
    ? `Stake $${gapToPro.toFixed(0)} more to unlock Pro`
    : 'Upgrade to Pro';
  const subtitle = isPartialStake
    ? `You currently have ${formatUsd(currentStakedUsd)} staked. Complete your stake to reach the $250 requirement.`
    : 'Stake $250 of $GENESIS for 90 days to unlock real-time signals, push alerts, and full terminal access.';

  const handleStakeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (numUsd < (isPartialStake ? gapToPro : 250)) {
      setErrorMsg(`Minimum stake is $${isPartialStake ? gapToPro : 250}`);
      return;
    }

    setSubmitting(true);
    try {
      // 1. Trigger Streamflow stake transaction
      const { signature } = await streamflowStake(rawBigInt, 90);

      // 2. Confirm on server
      const confirmRes = await fetch('/api/stake/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx_signature: signature,
          amount_raw: rawBigInt.toString(),
          lock_days: 90,
        }),
      });

      if (!confirmRes.ok) {
        const errData = await confirmRes.json().catch(() => ({}));
        throw new Error(errData.message || 'We could not verify the stake on-chain.');
      }

      setSuccessMsg('Stake confirmed. Pro access unlocked.');
      setShowTopupForm(false);
      await refreshStakeStatus();
      await refreshAll();
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Transaction failed';
      if (msg.includes('User rejected') || msg.includes('cancelled')) {
        setErrorMsg('Transaction cancelled.');
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-6 sm:p-8 space-y-6">
      {/* Title & Subtitle */}
      <div className="space-y-1">
        <h3 className="font-sans text-lg sm:text-xl font-semibold text-white tracking-tight">
          {title}
        </h3>
        <p className="font-sans text-xs sm:text-sm text-muted leading-relaxed max-w-2xl">
          {subtitle}
        </p>
      </div>

      {/* Inner Card (Amount Input, Equivalent, Lock, Button) */}
      <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-5 sm:p-6 space-y-5">
        <div>
          <label className="block font-sans text-xs font-bold uppercase tracking-wider text-muted mb-2">
            Amount to stake
          </label>

          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm text-white select-none">
              $
            </span>
            <input
              type="number"
              min={isPartialStake ? gapToPro : 250}
              step="1"
              value={usdInput}
              onChange={(e) => setUsdInput(e.target.value)}
              disabled={submitting}
              className="w-full h-11 pl-8 pr-16 rounded-md bg-neutral-900 border border-neutral-800 text-white font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-toxic tnum"
            />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-xs text-muted select-none">
              USD
            </span>
          </div>

          {/* Live Token Equivalent */}
          <div className="font-mono text-xs text-toxic font-semibold pt-2 tnum">
            ≈ {formatTokenDisplay(equivalentTokens)} $GENESIS
          </div>

          {isPartialStake && (
            <div className="font-sans text-xs text-muted pt-1">
              New total: <strong className="text-white tnum">${(currentStakedUsd + numUsd).toFixed(2)}</strong>
            </div>
          )}
        </div>

        {/* Lock Line */}
        <div className="flex items-center gap-2 font-sans text-xs text-muted pt-1">
          <Lock className="w-3.5 h-3.5 text-toxic shrink-0" />
          <span>90-day lock · Unlocks {unlockDateStr}</span>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-400 font-mono text-xs">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-sans text-xs font-bold">
            {successMsg}
          </div>
        )}

        {/* Stake Button */}
        <button
          type="button"
          onClick={handleStakeSubmit}
          disabled={submitting || numUsd < (isPartialStake ? gapToPro : 250)}
          className="w-full h-12 rounded-md bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-sm uppercase tracking-wide flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Confirming Stake...</span>
            </>
          ) : (
            <span>Stake $GENESIS</span>
          )}
        </button>
      </div>

      {/* Non-negotiable Disclaimer per §4 and AC 28 */}
      <p className="font-sans text-xs text-muted leading-relaxed">
        Your $GENESIS is locked for 90 days and cannot be withdrawn until unlock. Powered by Streamflow.
      </p>
    </div>
  );
}
