'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { LedgerCard, LedgerCardData } from './LedgerCard';
import { LedgerCardSkeleton } from './LedgerCardSkeleton';
import { LEDGER_CHAINS } from '@/lib/ledger/format';
import { ArrowUpRight, FolderOpen, Loader2, RefreshCw } from 'lucide-react';

interface LedgerGridProps {
  initialEntries?: LedgerCardData[];
  initialTotal?: number;
  initialHasMore?: boolean;
  isDashboardEmbed?: boolean;
}

export function LedgerGrid({
  initialEntries = [],
  initialTotal = 0,
  initialHasMore = false,
  isDashboardEmbed = false,
}: LedgerGridProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentChain = searchParams.get('chain') || 'all';
  const currentSort = searchParams.get('sort') || 'newest';

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
      } catch (err) {
        setError("Couldn't load the ledger.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [isDashboardEmbed]
  );

  // Sync when query params change on /ledger
  useEffect(() => {
    if (isDashboardEmbed) return;
    let active = true;
    const limit = 12;
    fetch(
      `/api/ledger?chain=${encodeURIComponent(currentChain)}&sort=${encodeURIComponent(
        currentSort
      )}&limit=${limit}&offset=0`
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setEntries(data.entries);
        setTotal(data.total);
        setHasMore(data.has_more);
      })
      .catch(() => {
        if (active) setError("Couldn't load the ledger.");
      });
    return () => {
      active = false;
    };
  }, [currentChain, currentSort, isDashboardEmbed]);

  const handleFilterChain = (chain: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (chain === 'all') params.delete('chain');
    else params.set('chain', chain);
    router.push(`/ledger?${params.toString()}`);
  };

  const handleFilterSort = (sort: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (sort === 'newest') params.delete('sort');
    else params.set('sort', sort);
    router.push(`/ledger?${params.toString()}`);
  };

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    fetchLedger(currentChain, currentSort, entries.length, true);
  };

  return (
    <div className="space-y-6">
      {/* Filters & Header Bar (Only on full /ledger page) */}
      {!isDashboardEmbed && (
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

          {/* Sort Selector */}
          <div className="flex items-center gap-2">
            <span className="font-sans text-xs font-bold uppercase tracking-wider text-muted">Sort:</span>
            <select
              value={currentSort}
              onChange={(e) => handleFilterSort(e.target.value)}
              className="h-8 px-2.5 rounded-md bg-neutral-900 border border-neutral-800 text-white font-sans text-xs font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pump cursor-pointer"
            >
              <option value="newest">Newest ▾</option>
              <option value="multi">Highest multiple ▾</option>
            </select>
          </div>
        </div>
      )}

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
        /* Empty State (§3, AC 14) */
        <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-12 text-center space-y-3">
          <FolderOpen className="w-8 h-8 text-muted mx-auto stroke-[1.5]" />
          <p className="font-sans text-sm text-muted">
            Ledger entries will appear here as calls close.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
          {entries.map((entry) => (
            <LedgerCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      {/* Load More Button (Only on /ledger, infinite scroll click) */}
      {!isDashboardEmbed && hasMore && (
        <div className="text-center pt-4">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="h-11 px-8 rounded-md bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-white font-sans text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loadingMore ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-pump" />
                <span>Loading more...</span>
              </>
            ) : (
              <span>Load more ({total - entries.length} remaining)</span>
            )}
          </button>
        </div>
      )}

      {/* Dashboard Embed: View full ledger link */}
      {isDashboardEmbed && (
        <div className="flex items-center justify-between pt-2">
          <span className="font-sans text-xs text-muted">
            Showing latest {entries.length} closed trade results
          </span>
          <Link
            href="/ledger"
            className="font-sans text-xs font-bold uppercase tracking-wider text-pump hover:text-white inline-flex items-center gap-1 transition-colors"
          >
            <span>View full ledger</span>
            <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
          </Link>
        </div>
      )}
    </div>
  );
}
