'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, BarChart3, Lock } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/components/ui/cn';
import {
  generateWeeklyPerformanceDigest,
  type DigestLedgerEntry,
  type DigestTier,
} from '@/lib/ledger/digest';

interface WeeklyPerformanceDigestProps {
  tierId: string;
  isUnlocked: boolean;
  className?: string;
  /** Test/SSR injection; when provided, no fetch is made. */
  initialEntries?: DigestLedgerEntry[];
}

type LoadState = 'loading' | 'ready' | 'unavailable';

export function resolveDigestTier(tierId: string, isUnlocked: boolean): DigestTier {
  if (tierId === 'PRO') return 'PRO';
  if (tierId === 'LAB_MEMBER' || tierId === 'MEMBER' || isUnlocked) return 'MEMBER';
  return 'FREE';
}

export const WeeklyPerformanceDigest: React.FC<WeeklyPerformanceDigestProps> = ({
  tierId,
  isUnlocked,
  className,
  initialEntries,
}) => {
  const [entries, setEntries] = useState<DigestLedgerEntry[]>(initialEntries ?? []);
  const [loadState, setLoadState] = useState<LoadState>(initialEntries ? 'ready' : 'loading');

  useEffect(() => {
    if (initialEntries) return;
    const controller = new AbortController();
    fetch('/api/ledger?limit=100&sort=newest', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { entries?: DigestLedgerEntry[] }) => {
        setEntries(Array.isArray(data?.entries) ? data.entries : []);
        setLoadState('ready');
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === 'AbortError') return;
        console.error('[WeeklyPerformanceDigest] ledger fetch failed:', err);
        setLoadState('unavailable');
      });
    return () => controller.abort();
  }, [initialEntries]);

  const tier = resolveDigestTier(tierId, isUnlocked);
  const digest = useMemo(() => generateWeeklyPerformanceDigest(entries, tier), [entries, tier]);

  return (
    <section
      data-testid="weekly-performance-digest"
      aria-labelledby="weekly-digest-heading"
      className={cn('rounded-xl bg-surface border border-border-default p-5 sm:p-6 space-y-4', className)}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border-default">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-surface-card border border-border-default flex items-center justify-center text-brand shrink-0">
            <BarChart3 className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 id="weekly-digest-heading" className="font-sans text-sm sm:text-base font-bold text-white">
                Weekly performance digest
              </h2>
              {digest.isSanitized && (
                <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-surface-card border border-border-default text-muted inline-flex items-center gap-1">
                  <Lock className="w-3 h-3" aria-hidden="true" />
                  Free preview
                </span>
              )}
            </div>
            <p className="font-sans text-xs text-muted">
              Calls closed in the last 7 days, from the public performance ledger.
            </p>
          </div>
        </div>

        <Link
          href="/ledger"
          className="font-mono text-xs text-brand hover:text-brand-bright inline-flex items-center gap-1 shrink-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span>Full ledger</span>
          <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>

      {loadState === 'loading' && (
        <div role="status" aria-label="Loading weekly digest" className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="h-[74px] w-full rounded-lg" />
            <Skeleton className="h-[74px] w-full rounded-lg" />
            <Skeleton className="h-[74px] w-full rounded-lg" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        </div>
      )}

      {loadState === 'unavailable' && (
        <p className="font-sans text-xs text-muted" role="status">
          The digest couldn&apos;t be loaded right now. Check your connection and refresh the page.
        </p>
      )}

      {loadState === 'ready' && (
        <>
          <div className="grid grid-cols-3 gap-3 font-mono text-xs">
            <div className="p-3 rounded-lg bg-surface-card border border-border-default space-y-1">
              <div className="text-muted font-bold">Win rate</div>
              <div className="text-lg font-black text-brand tnum">{digest.winRateFormatted}</div>
              <div className="text-muted">
                {digest.profitableCalls}W / {digest.losses}L
              </div>
            </div>
            <div className="p-3 rounded-lg bg-surface-card border border-border-default space-y-1">
              <div className="text-muted font-bold">Top multiple</div>
              <div className="text-lg font-black text-white tnum">
                {digest.topMultiplier !== null ? `${digest.topMultiplier.toFixed(2)}x` : '-'}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-surface-card border border-border-default space-y-1">
              <div className="text-muted font-bold">Resolved</div>
              <div className="text-lg font-black text-white tnum">{digest.resolvedCalls}</div>
            </div>
          </div>

          {digest.calls.length === 0 ? (
            <p className="font-mono text-xs text-muted">No calls closed in the last 7 days.</p>
          ) : (
            <ol className="space-y-1.5" aria-label="Top closed calls this week">
              {digest.calls.map((c, idx) => (
                <li
                  key={`${c.ticker}-${idx}`}
                  className="p-2.5 rounded-lg bg-surface-card border border-border-default flex items-center justify-between gap-3 font-mono text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 text-muted tnum">{idx + 1}.</span>
                    <span className="font-bold text-white truncate">{c.ticker}</span>
                    <span className="text-muted">{c.chain}</span>
                    {c.contractAddress && (
                      <span className="text-muted truncate max-w-[120px] sm:max-w-xs" title={c.contractAddress}>
                        {c.contractAddress.slice(0, 6)}...{c.contractAddress.slice(-4)}
                      </span>
                    )}
                  </div>
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded-md font-black shrink-0 tnum',
                      c.outcome === 'PROFIT' ? 'text-brand' : 'text-danger'
                    )}
                  >
                    {c.multiplierFormatted}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {digest.isSanitized && (
            <p className="font-sans text-xs text-muted">
              Tickers are masked in the free preview. Full details are on the{' '}
              <Link href="/ledger" className="text-brand hover:text-brand-bright underline">
                public ledger
              </Link>
              ; members see them here.
            </p>
          )}
        </>
      )}
    </section>
  );
};
