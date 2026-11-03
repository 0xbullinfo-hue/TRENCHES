'use client';

import React from 'react';
import { TrendingUp } from 'lucide-react';

interface PastIncubationToken {
  id: string;
  cohort: string;
  name: string;
  ticker: string;
  chain: 'SOL' | 'BASE' | 'ETH' | 'BSC';
  profitMultiple: string;
  entryMc: string;
  peakMc: string;
  holderRewardsPaid: string;
  summary: string;
}

const PAST_INCUBATIONS: PastIncubationToken[] = [
  {
    id: 'EXP01',
    cohort: 'Cohort #14',
    name: 'Pill Protocol',
    ticker: '$PILL',
    chain: 'SOL',
    profitMultiple: '64.2x',
    entryMc: '$12.4K',
    peakMc: '$796K',
    holderRewardsPaid: '$692,353',
    summary:
      'Lab members unlocked the contract address at $12.4K market cap before public graduation, capturing a 64.2x peak run.',
  },
  {
    id: 'EXP02',
    cohort: 'Cohort #15',
    name: 'Baton Relay AI',
    ticker: '$BATON',
    chain: 'SOL',
    profitMultiple: '48.5x',
    entryMc: '$72.0K',
    peakMc: '$3.50M',
    holderRewardsPaid: '$591,806',
    summary:
      'Early contract address dispatched to verified $GENESIS holders at $72K entry prior to its expansion to $3.5M market cap.',
  },
  {
    id: 'EXP03',
    cohort: 'Cohort #16',
    name: 'Big Trench Coin',
    ticker: '$BTC',
    chain: 'ETH',
    profitMultiple: '32.0x',
    entryMc: '$265K',
    peakMc: '$8.52M',
    holderRewardsPaid: '$281,485',
    summary:
      'Cross-chain incubation call unlocked for verified Lab members at $265K market cap before surging to $8.52M.',
  },
  {
    id: 'EXP04',
    cohort: 'Cohort #17',
    name: 'SwordCat',
    ticker: '$SWORDCAT',
    chain: 'SOL',
    profitMultiple: '19.4x',
    entryMc: '$94.8K',
    peakMc: '$1.84M',
    holderRewardsPaid: '$236,336',
    summary:
      'High-conviction Solana launch where verified $GENESIS holders received early access at $94.8K market cap before hitting $1.84M.',
  },
];

export const PipelineGrid: React.FC = () => {
  return (
    <section id="pipeline-section" className="border-b border-toxic-border bg-canvas py-16">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8">
        {/* Clean Section Header */}
        <div className="pb-6 mb-8 border-b border-toxic-border">
          <span className="font-sans text-xs font-bold uppercase tracking-widest text-toxic">
            PROVEN TRACK RECORD
          </span>
          <h2 className="font-sans text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-white mt-1">
            INCUBATOR PIPELINE
          </h2>
          <p className="font-sans text-sm sm:text-base text-muted mt-1.5 max-w-2xl">
            Past tokens that verified <span className="text-toxic-bright font-bold">$GENESIS</span>{' '}
            holders got into early — and the peak{' '}
            <span className="text-toxic font-bold">X profits</span> they earned.
          </p>
        </div>

        {/* 4 Aligned Early-Entry Profit Cards (Hard Flat 1px Structure) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
          {PAST_INCUBATIONS.map((token) => (
            <article
              key={token.id}
              className="rounded-xl bg-surface border border-toxic-border hover:border-toxic transition-colors flex flex-col justify-between overflow-hidden"
            >
              <div>
                {/* Card Top Bar */}
                <div className="px-5 py-3 bg-surface-card border-b border-toxic-border flex items-center justify-between text-xs font-semibold">
                  <span className="text-muted">{token.cohort}</span>
                  <span className="px-2.5 py-0.5 rounded bg-toxic-bg border border-toxic-border text-toxic font-mono text-xs font-bold">
                    {token.chain}
                  </span>
                </div>

                {/* Token Identity & X Profit Multiple */}
                <div className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-sans text-lg font-extrabold text-white">
                        {token.name}
                      </h3>
                      <div className="font-mono text-sm text-toxic-bright font-bold mt-0.5">
                        {token.ticker}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-toxic text-canvas font-sans text-lg font-black tnum">
                        <TrendingUp className="w-4 h-4 stroke-[2.75]" />
                        <span>{token.profitMultiple}</span>
                      </div>
                      <div className="font-sans text-[11px] text-toxic font-bold uppercase mt-1">
                        PEAK PROFIT
                      </div>
                    </div>
                  </div>

                  <p className="font-sans text-sm text-muted leading-relaxed">
                    {token.summary}
                  </p>
                </div>
              </div>

              {/* Clean Metrics Table */}
              <div className="px-5 pb-5">
                <div className="bg-surface-card border border-toxic-border rounded-lg divide-y divide-toxic-border font-sans text-xs">
                  <div className="px-3.5 py-2.5 flex items-center justify-between">
                    <span className="text-muted font-medium">Early Entry MC</span>
                    <span className="text-white font-bold tnum">{token.entryMc}</span>
                  </div>
                  <div className="px-3.5 py-2.5 flex items-center justify-between">
                    <span className="text-muted font-medium">Peak Market Cap</span>
                    <span className="text-toxic font-extrabold tnum">
                      {token.peakMc}
                    </span>
                  </div>
                  <div className="px-3.5 py-2.5 flex items-center justify-between">
                    <span className="text-muted font-medium">Holder Rewards</span>
                    <span className="text-toxic-bright font-bold tnum">
                      {token.holderRewardsPaid}
                    </span>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};
