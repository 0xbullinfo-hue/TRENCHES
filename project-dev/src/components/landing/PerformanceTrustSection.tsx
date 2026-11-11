'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight, CheckCircle2, ShieldCheck, AlertTriangle } from 'lucide-react';

export const PerformanceTrustSection: React.FC = () => {
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
              Every closed trade call and milestone is preserved on the public ledger. We publish both wins and losses without retroactive manipulation.
            </p>
          </div>

          <Link
            href="/ledger"
            className="self-start md:self-auto h-11 px-5 rounded-lg bg-surface hover:bg-surface-card border border-toxic text-white hover:text-toxic font-sans text-xs font-black uppercase tracking-wider inline-flex items-center gap-2 transition-colors cursor-pointer shrink-0"
          >
            <span>EXPLORE FULL LEDGER</span>
            <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
          </Link>
        </div>

        {/* 4 Performance Metric Panels */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-xl bg-surface border border-border-default space-y-2">
            <div className="font-sans text-xs font-bold uppercase text-muted tracking-wider">
              TOTAL RECORDED CALLS
            </div>
            <div className="font-sans text-3xl font-black text-white tnum">
              4+
            </div>
            <div className="font-sans text-xs text-muted">
              Verified incubations logged on-chain
            </div>
          </div>

          <div className="p-5 rounded-xl bg-surface border border-border-default space-y-2">
            <div className="font-sans text-xs font-bold uppercase text-toxic tracking-wider flex items-center justify-between">
              <span>PROFITABLE CALLS</span>
              <CheckCircle2 className="w-4 h-4 text-toxic" />
            </div>
            <div className="font-sans text-3xl font-black text-toxic tnum">
              4
            </div>
            <div className="font-sans text-xs text-muted">
              Reached 2x or higher target take-profit
            </div>
          </div>

          <div className="p-5 rounded-xl bg-surface border border-border-default space-y-2">
            <div className="font-sans text-xs font-bold uppercase text-muted tracking-wider">
              RECORDED LOSSES / SL
            </div>
            <div className="font-sans text-3xl font-black text-white tnum">
              0
            </div>
            <div className="font-sans text-xs text-muted">
              Invalidations recorded on closed sets
            </div>
          </div>

          <div className="p-5 rounded-xl bg-surface border border-border-default space-y-2">
            <div className="font-sans text-xs font-bold uppercase text-amber tracking-wider">
              ACTIVE / PENDING CALLS
            </div>
            <div className="font-sans text-3xl font-black text-amber tnum">
              —
            </div>
            <div className="font-sans text-xs text-muted">
              Excluded from historical win rates
            </div>
          </div>
        </div>

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

