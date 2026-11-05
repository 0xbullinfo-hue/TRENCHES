'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { LedgerCard, LedgerCardData } from './LedgerCard';
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
    searchParams.get('chain') || initialChain
  );
  const [currentSort, setCurrentSort] = useState<'newest' | 'multi'>(
    ((searchParams.get('sort') as 'newest' | 'multi') || initialSort)
  );

  const [entries, setEntries] = useState<LedgerCardData[]>(initialEntries);
  const [total, setTotal] = useState(initialTotal);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLedger = useCallback(
    async (chainVal: string, sortVal: string, offset = 0, append = false) => {
      const limit = isDashboardEmbed ? 6 : 12;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/ledger?chain=${encodeURIComponent(chainVal)}&sort=${encodeURIComponent(
            sortVal
          )}&limit=${limit}&offset=${offset}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (append) {
          setEntries((prev) => [...prev, ...data.entries]);
        } else {
          setEntries(data.entries);
        }
        setTotal(data.total);
        setHasMore(data.has_more);
      } catch {
        setError("Couldn't load the ledger.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [isDashboardEmbed]
  );

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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-neutral-800">
        {/* Chain Filter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleFilterChain('all')}
            className={`h-8 px-3 rounded-md font-sans text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
              currentChain === 'all'
                ? 'bg-neutral-100 text-neutral-900 font-extrabold'
                : 'bg-neutral-900 border border-neutral-800 text-muted hover:text-white'
            }`}
          >
            All
          </button>
          {LEDGER_CHAINS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => handleFilterChain(c.value)}
              className={`h-8 px-3 rounded-md font-sans text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                currentChain === c.value
                  ? 'bg-neutral-100 text-neutral-900 font-extrabold'
                  : 'bg-neutral-900 border border-neutral-800 text-muted hover:text-white'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Sort Selector (Only on full /ledger page) */}
        {!isDashboardEmbed ? (
          <div className="flex items-center gap-2">
            <span className="font-sans text-xs font-bold uppercase tracking-wider text-muted">Sort:</span>
            <select
              value={currentSort}
              onChange={(e) => handleFilterSort(e.target.value as 'newest' | 'multi')}
              className="h-8 px-2.5 rounded-md bg-neutral-900 border border-neutral-800 text-white font-sans text-xs font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-toxic cursor-pointer"
            >
              <option value="newest">Newest ▾</option>
              <option value="multi">Highest multiple ▾</option>
            </select>
          </div>
        ) : (
          <Link
            href="/ledger"
            className="font-mono text-xs text-toxic hover:text-toxic-bright inline-flex items-center gap-1 transition-colors self-start md:self-auto"
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
          <button
            type="button"
            onClick={() => fetchLedger(currentChain, currentSort, 0, false)}
            className="inline-flex items-center gap-1 font-bold text-rose-300 hover:text-white underline cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Grid Content */}
      {loading && entries.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
          <LedgerCardSkeleton />
          <LedgerCardSkeleton />
          <LedgerCardSkeleton />
        </div>
      ) : entries.length === 0 ? (
        /* Empty State */
        <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-12 text-center space-y-3">
          <FolderOpen className="w-8 h-8 text-muted mx-auto stroke-[1.5]" />
          <p className="font-sans text-sm text-muted">
            {currentChain !== 'all'
              ? `No ${currentChain.toUpperCase()} ledger entries recorded yet.`
              : 'Ledger entries will appear here as calls close.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
          {entries.map((entry) => (
            <LedgerCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      {/* Load More Button (Only on full /ledger page) */}
      {!isDashboardEmbed && hasMore && (
        <div className="pt-6 text-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="h-11 px-8 rounded-md bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-white font-sans text-xs font-bold uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
          >
            {loadingMore ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-toxic" />
                <span>Loading more...</span>
              </>
            ) : (
              <span>Load more ({total - entries.length} remaining)</span>
            )}
          </button>
        </div>
      )}

      {/* Dashboard Embed Footer Link */}
      {isDashboardEmbed && entries.length > 0 && (
        <div className="pt-2 flex justify-end">
          <Link
            href="/ledger"
            className="font-mono text-xs text-toxic hover:text-toxic-bright inline-flex items-center gap-1 transition-colors"
          >
            <span>View full ledger ({total} calls)</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
