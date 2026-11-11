'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CheckCircle2, ShieldCheck, AlertCircle, RefreshCw } from 'lucide-react';
import type { PerformanceCalculationResult } from '@/lib/ledger/performance-stats';

export const PerformanceTrustSection: React.FC = () => {
  const [stats, setStats] = useState<PerformanceCalculationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ledger/stats');
      if (!res.ok) {
        throw new Error('Unable to retrieve performance data');
      }
      const data = await res.json();
      if (!data.ok || !data.stats) {
        throw new Error(data.error || 'Invalid statistics payload');
      }
      setStats(data.stats);
    } catch (err) {
      setError((err as Error).message || 'Failed to load telemetry');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/ledger/stats')
      .then((res) => {
        if (!res.ok) throw new Error('Unable to retrieve performance data');
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        if (!data.ok || !data.stats) throw new Error(data.error || 'Invalid statistics payload');
        setStats(data.stats);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError((err as Error).message || 'Failed to load telemetry');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const hasRecords = stats && stats.totalRecordedCalls > 0;

  return (
    <section id="ledger-section" className="border-b border-toxic-border bg-canvas py-16">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-toxic-border">
          <div>
            <span className="font-sans text-xs font-bold uppercase tracking-widest text-toxic">
              TRANSPARENCY &amp; ACCOUNTABILITY
            </span>
            <h2 className="font-sans text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-white mt-1">
              PERFORMANCE &amp; TRUST
            </h2>
            <p className="font-sans text-sm sm:text-base text-muted mt-1.5 max-w-2xl">
              Every closed trade call and milestone is preserved on the public ledger. We document both wins and losses without retroactive modification.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {error && (
              <button
                type="button"
                onClick={fetchStats}
                className="h-11 px-4 rounded-lg bg-surface hover:bg-surface-card border border-border-default text-muted hover:text-white font-sans text-xs font-bold uppercase inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            )}

            <Link
              href="/ledger"
              className="self-start md:self-auto h-11 px-5 rounded-lg bg-surface hover:bg-surface-card border border-toxic text-white hover:text-toxic font-sans text-xs font-black uppercase tracking-wider inline-flex items-center gap-2 transition-colors cursor-pointer shrink-0"
            >
              <span>EXPLORE FULL LEDGER</span>
              <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
            </Link>
          </div>
        </div>

        {/* State 1: Error State */}
        {error ? (
          <div className="p-6 rounded-xl bg-surface border border-danger/30 text-center space-y-3">
            <AlertCircle className="w-6 h-6 text-danger mx-auto" />
            <div className="font-sans text-sm font-bold text-white">Performance Telemetry Unavailable</div>
            <p className="font-sans text-xs text-muted max-w-md mx-auto">
              Authoritative ledger metrics could not be loaded at this time. Live ledger records remain directly accessible.
            </p>
            <button
              type="button"
              onClick={fetchStats}
              className="px-4 py-2 rounded-lg bg-surface-card border border-border-default text-white font-sans text-xs font-bold uppercase inline-flex items-center gap-2 hover:border-toxic cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Request</span>
            </button>
          </div>
        ) : loading ? (
          /* State 2: Loading Skeleton */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="p-5 rounded-xl bg-surface border border-border-default space-y-3 min-h-[120px]">
                <div className="h-3 w-28 bg-surface-card rounded" />
                <div className="h-8 w-16 bg-surface-card rounded" />
                <div className="h-3 w-36 bg-surface-card rounded" />
              </div>
            ))}
          </div>
        ) : !hasRecords ? (
          /* State 3: Empty State (Zero Historical Records) */
          <div className="p-8 rounded-xl bg-surface border border-border-default text-center space-y-3">
            <div className="font-mono text-xs font-bold uppercase text-muted tracking-wider">
              AUTHORITATIVE PERFORMANCE LEDGER
            </div>
            <h3 className="font-sans text-lg font-bold text-white">Recorded Performance Not Yet Available</h3>
            <p className="font-sans text-xs text-muted max-w-lg mx-auto">
              Historical calls are being logged as closed trades settle. Visit the full ledger route to inspect current open and completed incubator records.
            </p>
            <div className="pt-2">
              <Link
                href="/ledger"
                className="px-4 py-2 rounded-lg bg-surface-card border border-border-default text-white hover:text-toxic font-sans text-xs font-bold uppercase inline-flex items-center gap-1.5 transition-colors"
              >
                <span>View Ledger Route</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        ) : (
          /* State 4: Successful Data Response */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-xl bg-surface border border-border-default space-y-2">
              <div className="font-sans text-xs font-bold uppercase text-muted tracking-wider">
                TOTAL RECORDED CALLS
              </div>
              <div className="font-sans text-3xl font-black text-white tnum">
                {stats.totalRecordedCalls}
              </div>
              <div className="font-sans text-xs text-muted">
                Documented incubator entries on public ledger
              </div>
            </div>

            <div className="p-5 rounded-xl bg-surface border border-border-default space-y-2">
              <div className="font-sans text-xs font-bold uppercase text-toxic tracking-wider flex items-center justify-between">
                <span>PROFITABLE CALLS</span>
                <CheckCircle2 className="w-4 h-4 text-toxic" />
              </div>
              <div className="font-sans text-3xl font-black text-toxic tnum">
                {stats.profitableCalls}
              </div>
              <div className="font-sans text-xs text-muted">
                Authoritative TP milestone or profitable close
              </div>
            </div>

            <div className="p-5 rounded-xl bg-surface border border-border-default space-y-2">
              <div className="font-sans text-xs font-bold uppercase text-muted tracking-wider">
                RECORDED LOSSES / SL
              </div>
              <div className="font-sans text-3xl font-black text-white tnum">
                {stats.losses}
              </div>
              <div className="font-sans text-xs text-muted">
                Authoritative SL invalidation or loss close
              </div>
            </div>

            <div className="p-5 rounded-xl bg-surface border border-border-default space-y-2">
              <div className="font-sans text-xs font-bold uppercase text-amber tracking-wider flex items-center justify-between">
                <span>ACTIVE / OPEN CALLS</span>
                {stats.winRateFormatted !== '—' && (
                  <span className="text-[10px] text-muted font-mono">{stats.winRateFormatted} WR</span>
                )}
              </div>
              <div className="font-sans text-3xl font-black text-amber tnum">
                {stats.openCalls > 0 ? stats.openCalls : '0'}
              </div>
              <div className="font-sans text-xs text-muted">
                Excluded from resolved win-rate denominator
              </div>
            </div>
          </div>
        )}

        {/* Institutional Trust & Non-Guarantee Statement */}
        <div className="rounded-xl bg-surface border border-border-default p-5 sm:p-6 space-y-3">
          <div className="flex items-center gap-2 text-toxic font-mono text-xs font-extrabold uppercase">
            <ShieldCheck className="w-4 h-4" />
            <span>INSTITUTIONAL INTEGRITY PLEDGE</span>
          </div>
          <p className="font-sans text-xs sm:text-sm text-muted leading-relaxed">
            TrenchLabs is committed to zero fabrication. Pending or open calls are never counted as completed wins or losses. Historical performance reflects past outcomes under specific market regimes and does not guarantee future results. Cryptocurrency trading carries substantial risk of loss; never trade capital you cannot afford to lose completely.
          </p>
        </div>
      </div>
    </section>
  );
};
