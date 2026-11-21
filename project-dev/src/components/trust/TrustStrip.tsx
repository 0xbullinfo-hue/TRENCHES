'use client';

import { useState } from 'react';
import Link from 'next/link';
import { roles } from '@/lib/theme/roles';

export type TrustMetrics = {
  signalCount: number;
  winRate: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  startDate: string;
};

type Props = {
  metrics: TrustMetrics | null;
  loading?: boolean;
};

export function TrustStrip({ metrics, loading }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return <div className="h-8 animate-pulse rounded bg-surface-card" aria-hidden />;
  }

  if (!metrics) return null;

  const compact = (
    <>
      {metrics.signalCount} signals · {metrics.winRate}% win ·{' '}
      {metrics.expectancy.toFixed(2)}R avg
    </>
  );

  const full = (
    <>
      {metrics.signalCount} signals · {metrics.winRate}% win ·{' '}
      {metrics.expectancy.toFixed(2)}R avg · {metrics.profitFactor.toFixed(1)} PF ·{' '}
      {metrics.maxDrawdown.toFixed(0)}% max DD · since {metrics.startDate}
    </>
  );

  return (
    <div className="rounded-md border border-line bg-surface-card px-3 py-2 text-xs text-muted">
      <div className="hidden sm:flex items-center justify-between gap-3">
        <span className="tabular-nums">{full}</span>
        <Link href="/ledger" className={`shrink-0 text-brand hover:underline ${roles.focusRing}`}>
          Public Ledger →
        </Link>
      </div>
      <div className="flex items-center justify-between gap-2 sm:hidden">
        <span className="tabular-nums truncate">{compact}</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`shrink-0 text-ink underline ${roles.focusRing}`}
        >
          {expanded ? 'Less' : 'Details'}
        </button>
      </div>
      {expanded && (
        <div className="mt-2 border-t border-line pt-2 tabular-nums sm:hidden space-y-1">
          <div>{full}</div>
          <Link href="/ledger" className={`inline-block text-brand hover:underline ${roles.focusRing}`}>
            Public Ledger →
          </Link>
        </div>
      )}
    </div>
  );
}
