'use client';

import React, { Suspense } from 'react';
import { LedgerGrid } from './LedgerGrid';
import { LedgerCardSkeleton } from './LedgerCardSkeleton';
import { ShieldCheck } from 'lucide-react';

export function DashboardLedgerEmbed() {
  return (
    <section id="ledger-embed" className="pt-8 border-t border-neutral-800/80">
      <div className="mb-6 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-2xs font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase font-bold flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" />
            <span>Closed Calls Showcase</span>
          </span>
        </div>
        <h2 className="font-sans text-xl sm:text-2xl font-black uppercase tracking-tight text-white">
          Recent Call Performance Ledger
        </h2>
        <p className="font-sans text-xs sm:text-sm text-muted">
          Latest verified trade outcomes recorded by the TrenchLabs team.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
            <LedgerCardSkeleton />
            <LedgerCardSkeleton />
            <LedgerCardSkeleton />
          </div>
        }
      >
        <LedgerGrid isDashboardEmbed={true} />
      </Suspense>
    </section>
  );
}
