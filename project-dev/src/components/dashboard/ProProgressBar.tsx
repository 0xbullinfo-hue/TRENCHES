'use client';

import React, { useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CheckCircle2, Lock, Sparkles } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { GenesisContext } from '@/context/GenesisContext';
import { canFetchSessionEndpoints } from '@/lib/auth/sessionGate';
import { TabularValue } from '@/components/primitives/TabularValue';
import { MarketDataBadge } from './MarketDataBadge';
import {
  toGenesisProvenanceItem,
  type GenesisThresholdProvenanceInput,
} from '@/lib/stake/provenance';

interface StakeStatusResponse {
  ok?: boolean;
  current_tier?: string;
  gap_to_pro_usd?: number;
  eligible_for_pro?: boolean;
  thresholds?: {
    pro?: {
      usd_target?: number;
    };
    twap_source?: string;
    recalculated_at?: string;
    stale?: boolean;
  };
}

interface ProProgressBarProps {
  className?: string;
  isPro?: boolean;
}

export const ProProgressBar: React.FC<ProProgressBarProps> = ({ className, isPro = false }) => {
  const genesis = useContext(GenesisContext);
  const canFetchStatus = canFetchSessionEndpoints(genesis, true);

  const [loading, setLoading] = useState<boolean>(true);
  const [gapToPro, setGapToPro] = useState<number | null>(null);
  const [targetUsd, setTargetUsd] = useState<number>(250);
  const [unlocked, setUnlocked] = useState<boolean>(isPro);
  const [provenance, setProvenance] = useState<GenesisThresholdProvenanceInput | null>(null);

  useEffect(() => {
    if (isPro || !canFetchStatus) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    let mounted = true;
    const controller = new AbortController();

    async function fetchStakeStatus() {
      try {
        setLoading(true);
        const res = await fetch('/api/stake/status', {
          signal: controller.signal,
          credentials: 'same-origin',
        });

        if (!res.ok) {
          if (mounted) setLoading(false);
          return;
        }

        const data: StakeStatusResponse = await res.json();
        if (mounted) {
          const proTarget = data.thresholds?.pro?.usd_target ?? 250;
          setTargetUsd(proTarget);
          setProvenance({
            twap_source: data.thresholds?.twap_source,
            recalculated_at: data.thresholds?.recalculated_at,
            stale: data.thresholds?.stale,
          });

          if (data.current_tier === 'pro' || data.eligible_for_pro || data.gap_to_pro_usd === 0) {
            setUnlocked(true);
            setGapToPro(0);
          } else if (typeof data.gap_to_pro_usd === 'number') {
            setGapToPro(data.gap_to_pro_usd);
            setUnlocked(data.gap_to_pro_usd <= 0);
          }
          setLoading(false);
        }
      } catch (err: unknown) {
        if ((err as Error)?.name !== 'AbortError' && mounted) {
          setLoading(false);
        }
      }
    }

    fetchStakeStatus();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [isPro, canFetchStatus]);

  // If loading and we don't have isPro, render subtle skeleton placeholder
  if (loading && gapToPro === null && !isPro) {
    return (
      <div className={cn('p-4 rounded-xl bg-surface-card border border-border-default animate-pulse space-y-2', className)}>
        <div className="h-4 w-48 bg-surface rounded" />
        <div className="h-2.5 w-full bg-surface rounded-full" />
      </div>
    );
  }

  const effectiveGap = isPro ? 0 : gapToPro ?? targetUsd;
  const currentStakedUsd = Math.max(0, targetUsd - effectiveGap);
  const percent = unlocked || isPro ? 100 : Math.min(100, Math.max(0, Math.round((currentStakedUsd / targetUsd) * 100)));

  return (
    <div
      data-testid="pro-progress-bar"
      className={cn(
        'p-4 sm:p-5 rounded-xl bg-surface-card border border-border-default space-y-3 transition-colors',
        unlocked || isPro ? 'border-brand/40 bg-brand-bg/20' : '',
        className
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {unlocked || isPro ? (
            <CheckCircle2 className="w-4 h-4 text-brand shrink-0" />
          ) : (
            <Lock className="w-4 h-4 text-muted shrink-0" />
          )}
          <span className="font-sans text-xs font-bold uppercase tracking-wider text-white">
            {unlocked || isPro ? 'PRO TIER UNLOCKED' : 'PRO TIER UNLOCK PROGRESS'}
          </span>
          <span className="font-mono text-xs px-2 py-0.5 rounded bg-surface border border-border-default text-brand font-bold">
            <TabularValue value={percent} decimals={0} suffix="%" />
          </span>
        </div>

        <div className="font-mono text-xs text-muted flex items-center gap-2 flex-wrap">
          {unlocked || isPro ? (
            <span className="text-brand font-bold inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Maximum Alpha &amp; Instant Telegram Calls Active
            </span>
          ) : (
            <span>
              <strong className="text-white font-bold">
                <TabularValue value={effectiveGap} decimals={2} prefix="$" />
              </strong>{' '}
              remaining of ${targetUsd} target
            </span>
          )}
          <MarketDataBadge item={toGenesisProvenanceItem(provenance)} />
        </div>
      </div>

      {/* Progress Track */}
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Pro tier unlock progress"
        className="w-full h-2.5 bg-surface rounded-full overflow-hidden border border-border-default"
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300',
            unlocked || isPro ? 'bg-brand' : 'bg-brand-bright'
          )}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Footer guidance / Stake CTA */}
      {!(unlocked || isPro) && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
          <p className="font-sans text-xs text-muted">
            Stake $250 of $H42 for 90 days on StakePoint to unlock instant Pro calls and full terminal access.
          </p>
          <Link
            href="/dashboard/stake"
            className="font-mono text-xs font-bold text-brand hover:text-brand-bright inline-flex items-center gap-1 shrink-0 self-start sm:self-auto transition-colors"
          >
            <span>Stake to unlock Pro</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
};
