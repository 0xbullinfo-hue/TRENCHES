'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { LedgerGrid } from './LedgerGrid';
import { LedgerCardSkeleton } from './LedgerCardSkeleton';
import { ShieldCheck, ArrowUpRight, ChevronUp, BarChart3 } from 'lucide-react';

export function DashboardLedgerEmbed() {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#ledger-embed') {
      return true;
    }
    return false;
  });

  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash === '#ledger-embed') {
        setIsOpen(true);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <section id="ledger-embed" className="pt-8 border-t border-toxic-border/30">
      {/* Closed State: Sleek banner with View Full Ledger button */}
      {!isOpen ? (
        <div className="rounded-xl bg-surface-card border border-border-default hover:border-toxic p-6 sm:p-7 transition-all duration-150 shadow-none">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-2xs font-mono px-2 py-0.5 rounded-md bg-toxic/15 text-toxic border border-toxic/30 uppercase font-bold flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Closed Calls Showcase</span>
                </span>
                <span className="text-2xs font-mono text-muted uppercase">
                  Verified Multipliers
                </span>
              </div>
              <h2 className="font-sans text-xl sm:text-2xl font-black uppercase tracking-tight text-white">
                Recent Call Performance Ledger
              </h2>
              <p className="font-sans text-xs sm:text-sm text-muted max-w-2xl">
                Verified trade outcomes, multipliers achieved, and contract addresses recorded by the TrenchLabs team.
              </p>
            </div>

            <div className="shrink-0 flex flex-col sm:flex-row items-center gap-2.5">
              <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="w-full sm:w-auto h-11 px-5 rounded-lg bg-surface hover:bg-surface-elevated border border-border-default hover:border-toxic text-white font-sans font-bold text-xs uppercase tracking-wider inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Preview Inline</span>
              </button>
              <Link
                href="/ledger"
                className="w-full sm:w-auto h-11 px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-none"
              >
                <span>View full ledger</span>
                <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
              </Link>
            </div>
          </div>
        </div>
      ) : (
        /* Open / Expanded State: Revealing the full max-4 cards grid */
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-toxic-border/30">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-2xs font-mono px-2 py-0.5 rounded bg-toxic/15 text-toxic border border-toxic/30 uppercase font-bold flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Closed Calls Showcase</span>
                </span>
              </div>
              <h2 className="font-sans text-xl sm:text-2xl font-black uppercase tracking-tight text-white flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-toxic" />
                <span>Recent Call Performance Ledger</span>
              </h2>
              <p className="font-sans text-xs sm:text-sm text-muted">
                Latest verified trade outcomes recorded by the TrenchLabs team.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/ledger"
                className="h-10 px-4 rounded-lg bg-surface hover:bg-surface-elevated border border-toxic text-white hover:text-toxic font-sans text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Full Ledger Page</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="h-10 px-4 rounded-lg bg-surface hover:bg-surface-elevated border border-toxic-border/40 hover:border-toxic text-muted hover:text-white font-sans text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ChevronUp className="w-4 h-4" />
                <span>Hide Ledger</span>
              </button>
            </div>
          </div>

          <Suspense
            fallback={
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 items-stretch">
                <LedgerCardSkeleton />
                <LedgerCardSkeleton />
                <LedgerCardSkeleton />
                <LedgerCardSkeleton />
              </div>
            }
          >
            <LedgerGrid isDashboardEmbed={true} />
          </Suspense>
        </div>
      )}
    </section>
  );
}
