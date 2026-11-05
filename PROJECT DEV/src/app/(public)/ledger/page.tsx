import React, { Suspense } from 'react';
import { getLedgerEntries } from '@/server/db';
import { LedgerGrid } from '@/components/ledger/LedgerGrid';
import { LedgerCardSkeleton } from '@/components/ledger/LedgerCardSkeleton';
import { ShieldCheck } from 'lucide-react';

export const revalidate = 60;

export default async function PublicLedgerPage(props: {
  searchParams?: Promise<{ chain?: string; sort?: 'newest' | 'multi' }>;
}) {
  const params = await props.searchParams;
  const chain = params?.chain || 'all';
  const sort = params?.sort || 'newest';

  const { entries, total, has_more } = await getLedgerEntries({
    chain,
    sort,
    limit: 12,
    offset: 0,
  });

  return (
    <div className="py-12 sm:py-16 bg-canvas min-h-[calc(100vh-140px)]">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Page Header */}
        <div className="pb-6 border-b border-toxic-border/20 max-w-3xl space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-sans uppercase">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Verified Call History</span>
            </span>
            <span className="font-mono text-xs text-muted">
              {total} Total Results
            </span>
          </div>

          <h1 className="font-sans text-3xl sm:text-4xl font-extrabold uppercase text-white tracking-tight">
            Official Performance Ledger
          </h1>
          <p className="font-sans text-sm sm:text-base text-muted leading-relaxed">
            Every closed early-access call recorded by the TrenchLabs team. All results display
            verified multipliers, timestamps, and contract addresses.
          </p>
        </div>

        {/* Ledger Grid wrapped in Suspense for useSearchParams */}
        <Suspense
          fallback={
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
              <LedgerCardSkeleton />
              <LedgerCardSkeleton />
              <LedgerCardSkeleton />
            </div>
          }
        >
          <LedgerGrid
            initialEntries={entries}
            initialTotal={total}
            initialHasMore={has_more}
            initialChain={chain}
            initialSort={sort}
            isDashboardEmbed={false}
          />
        </Suspense>
      </div>
    </div>
  );
}

