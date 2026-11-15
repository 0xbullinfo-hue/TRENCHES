'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { LedgerTableRow, LedgerCardData } from './LedgerCard';
import { LedgerCardSkeleton } from './LedgerCardSkeleton';
import { LEDGER_CHAINS } from '@/lib/ledger/format';
import { ArrowUpRight, FolderOpen, Loader2, RefreshCw } from 'lucide-react';

interface LedgerGridProps {
  initialEntries?: LedgerCardData[];
  initialTotal?: number;
  initialHasMore?: boolean;
  initialChain?: string;
  initialSort?: 'newest' | 'multi';
  isDashboardEmbed?: boolean;
}

export function LedgerGrid({
  initialEntries = [],
  initialTotal = 0,
  initialHasMore = false,
  initialChain = 'all',
  initialSort = 'newest',
  isDashboardEmbed = false,
}: LedgerGridProps) {
  const searchParams = useSearchParams();

  const [currentChain, setCurrentChain] = useState<string>(
    searchParams?.get('chain') || initialChain
  );
  const [currentSort, setCurrentSort] = useState<'newest' | 'multi'>(
    ((searchParams?.get('sort') as 'newest' | 'multi') || initialSort)
  );

  const [entries, setEntries] = useState<LedgerCardData[]>(initialEntries);
  const [total, setTotal] = useState(initialTotal);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const hasInitialFetchedRef = useRef(false);

  const fetchLedger = useCallback(
    async (chainVal: string, sortVal: string, offset = 0, append = false) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const limit = isDashboardEmbed ? 8 : 12;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/ledger?chain=${encodeURIComponent(chainVal)}&sort=${encodeURIComponent(
            sortVal
          )}&limit=${limit}&offset=${offset}`,
          { signal: controller.signal }
        );
        if (!res.ok) {
          let message = "The ledger couldn't be loaded. Check your connection and try again.";
          if (res.status === 429) {
            message = 'Too many requests. Please wait a moment and try again.';
          } else if (res.status >= 500) {
            message = 'Ledger service temporarily unavailable. Please try again.';
          } else if (res.status === 404) {
            message = 'Ledger records not found.';
          }
          throw new Error(message);
        }
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (append) {
          setEntries((prev) => [...prev, ...data.entries]);
        } else {
          setEntries(data.entries);
        }
        setTotal(data.total);
        setHasMore(data.has_more);
      } catch (err: unknown) {
        if (controller.signal.aborted || (err as Error)?.name === 'AbortError') {
          return;
        }
        const message =
          (err as Error)?.message && !(err as Error)?.message.startsWith('HTTP ')
            ? (err as Error).message
            : "The ledger couldn't be loaded. Check your connection and try again.";
        setError(message);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [isDashboardEmbed]
  );

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (entries.length === 0 && !hasInitialFetchedRef.current) {
      hasInitialFetchedRef.current = true;
      fetchLedger(currentChain, currentSort, 0, false);
    }
  }, [fetchLedger, currentChain, currentSort, entries.length]);

  const handleFilterChain = (chain: string) => {
    setCurrentChain(chain);
    fetchLedger(chain, currentSort, 0, false);
    if (typeof window !== 'undefined' && !isDashboardEmbed) {
      const url = new URL(window.location.href);
      if (chain === 'all') url.searchParams.delete('chain');
      else url.searchParams.set('chain', chain);
      window.history.replaceState(null, '', url.pathname + url.search);
    }
  };

  const handleFilterSort = (sort: 'newest' | 'multi') => {
    setCurrentSort(sort);
    fetchLedger(currentChain, sort, 0, false);
    if (typeof window !== 'undefined' && !isDashboardEmbed) {
      const url = new URL(window.location.href);
      if (sort === 'newest') url.searchParams.delete('sort');
      else url.searchParams.set('sort', sort);
      window.history.replaceState(null, '', url.pathname + url.search);
    }
  };

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    fetchLedger(currentChain, currentSort, entries.length, true);
  };

  return (
    <div className="space-y-6">
      {/* Filters Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-brand-border/30">
        {/* Chain Filter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={currentChain === 'all' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => handleFilterChain('all')}
            className={`font-sans text-xs font-bold uppercase tracking-wider ${
              currentChain === 'all'
                ? 'shadow-none'
                : 'text-muted hover:text-white'
            }`}
          >
            All
          </Button>
          {LEDGER_CHAINS.map((c) => (
            <Button
              key={c.value}
              variant={currentChain === c.value ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => handleFilterChain(c.value)}
              className={`font-sans text-xs font-bold uppercase tracking-wider ${
                currentChain === c.value
                  ? 'shadow-none'
                  : 'text-muted hover:text-white'
              }`}
            >
              {c.label}
            </Button>
          ))}
        </div>

        {/* Sort Selector (Only on full /ledger page) */}
        {!isDashboardEmbed ? (
          <div className="flex items-center gap-2">
            <span className="font-sans text-xs font-bold uppercase tracking-wider text-muted">Sort:</span>
            <select
              value={currentSort}
              onChange={(e) => handleFilterSort(e.target.value as 'newest' | 'multi')}
              className="h-8 px-2.5 rounded-md bg-surface border border-brand-border/40 text-white font-sans text-xs font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand cursor-pointer"
            >
              <option value="newest">Newest ▾</option>
              <option value="multi">Highest multiple ▾</option>
            </select>
          </div>
        ) : (
          <Link
            href="/ledger"
            className="font-mono text-xs text-brand hover:text-brand-bright inline-flex items-center gap-1 transition-colors self-start md:self-auto"
          >
            <span>View full ledger</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>

      {/* Error state with retry */}
      {error && (
        <div className="p-3 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-mono flex items-center justify-between">
          <span>{error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchLedger(currentChain, currentSort, 0, false)}
            className="h-auto p-0 inline-flex items-center gap-1 font-bold text-rose-300 hover:text-white underline"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry</span>
          </Button>
        </div>
      )}

      {/* Structured Data Table Presentation */}
      {loading && entries.length === 0 ? (
        <LedgerCardSkeleton />
      ) : entries.length === 0 ? (
        /* Empty State */
        <div className="rounded-xl bg-surface border border-brand-border/40 p-12 text-center space-y-3">
          <FolderOpen className="w-8 h-8 text-muted mx-auto stroke-[1.5]" />
          <p className="font-sans text-sm text-muted">
            {currentChain !== 'all'
              ? `No ${currentChain.toUpperCase()} ledger entries recorded yet.`
              : 'Ledger entries will appear here as calls close.'}
          </p>
        </div>
      ) : (
        <div className="w-full overflow-x-auto rounded-xl border border-border-default bg-surface-card shadow-none">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border-default/60 bg-surface/70 text-2xs uppercase tracking-wider font-sans font-bold text-muted">
                <th scope="col" className="px-4 py-3 text-left">Ticker</th>
                <th scope="col" className="px-4 py-3 text-right">Entry MCAP</th>
                <th scope="col" className="px-4 py-3 text-right">Exit MCAP</th>
                <th scope="col" className="px-4 py-3 text-right">Multiplier</th>
                <th scope="col" className="px-4 py-3 text-right">PnL</th>
                <th scope="col" className="px-4 py-3 text-right">DexScreener</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default/30">
              {entries.map((entry) => (
                <LedgerTableRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </table>
          <div className="p-3 text-center border-t border-border-default/30 text-2xs font-mono text-muted">
            Recorded by the TrenchLabs team · All results display verified multipliers and contract addresses.
          </div>
        </div>
      )}

      {/* Load More Button (Only on full /ledger page) */}
      {!isDashboardEmbed && hasMore && (
        <div className="pt-6 text-center">
          <Button
            variant="secondary"
            size="md"
            onClick={handleLoadMore}
            disabled={loadingMore}
            loading={loadingMore}
            className="h-11 px-8 text-white font-sans text-xs font-bold uppercase tracking-wider gap-2 disabled:opacity-50"
          >
            <span>Load more ({total - entries.length} remaining)</span>
          </Button>
        </div>
      )}

      {/* Dashboard Embed Footer Link */}
      {isDashboardEmbed && entries.length > 0 && (
        <div className="pt-2 flex justify-end">
          <Link
            href="/ledger"
            className="font-mono text-xs text-brand hover:text-brand-bright inline-flex items-center gap-1 transition-colors"
          >
            <span>View full ledger ({total} calls)</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
