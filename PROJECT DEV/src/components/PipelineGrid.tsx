'use client';

import React from 'react';
import { ArrowUpRight, TrendingUp } from 'lucide-react';

interface PastIncubationToken {
  id: string;
  cohort: string;
  name: string;
  ticker: string;
  chain: 'BSC' | 'SOL' | 'ETH' | 'BASE';
  profitMultiple: string;
  entryMc: string;
  peakMc: string;
  gainPercent: string;
  dexUrl: string;
  summary: string;
}

const PAST_INCUBATIONS: PastIncubationToken[] = [
  {
    id: 'EXP01',
    cohort: 'Incubation #01',
    name: 'LITY',
    ticker: '$LITY',
    chain: 'BSC',
    profitMultiple: '12.1x',
    entryMc: '$580K',
    peakMc: '$7.0M',
    gainPercent: '+1,106%',
    dexUrl: 'https://dexscreener.com/bsc/0x91727e4485542612e9ed4293d1021414dbf5e588',
    summary:
      'High-conviction BSC alpha trade call dispatched to Lab members at $580K market cap before a violent parabolic expansion reaching a $7.0M peak.',
  },
  {
    id: 'EXP02',
    cohort: 'Incubation #02',
    name: 'BITCOIN CULTIVATOR 400',
    ticker: '$BC400',
    chain: 'BSC',
    profitMultiple: '7.0x',
    entryMc: '$880K',
    peakMc: '$6.2M',
    gainPercent: '+604%',
    dexUrl: 'https://dexscreener.com/bsc/0xa02e8735cdc35aea44a770cb511513826e6c68c5',
    summary:
      'Early BSC trade setup shared with verified $GENESIS holders at $880K entry prior to multi-million expansion and a $6.2M peak market cap.',
  },
  {
    id: 'EXP03',
    cohort: 'Incubation #03',
    name: 'Clean Water',
    ticker: '$WATER',
    chain: 'BSC',
    profitMultiple: '15.0x',
    entryMc: '$8.0K',
    peakMc: '$120K',
    gainPercent: '+1,400%',
    dexUrl: 'https://dexscreener.com/bsc/0xe8d2a16a9526ca7706c4a13e8b119416791c99b0',
    summary:
      'Micro-cap trench entry unlocked for Lab members at just $8K market cap before surging into a massive 15x run peaking at $120K market cap.',
  },
  {
    id: 'EXP04',
    cohort: 'Incubation #04',
    name: 'AZUKI ANIME',
    ticker: '$AZUKI',
    chain: 'BSC',
    profitMultiple: '2.6x',
    entryMc: '$21K',
    peakMc: '$55K',
    gainPercent: '+162%',
    dexUrl: 'https://dexscreener.com/bsc/0x2d6025e3d98fa8d0406267dc5a06694371c93c12',
    summary:
      'Fast-moving momentum trade call alerted at $21K entry on BSC, locking in high-probability take profit targets at a $55K peak market cap.',
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
            <span className="text-toxic font-bold">X profits</span> achieved.
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

              {/* Clean Metrics Table (No Holder Rewards) */}
              <div className="px-5 pb-5 space-y-3">
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
                    <span className="text-muted font-medium">Net Return</span>
                    <span className="text-toxic-bright font-bold tnum">
                      {token.gainPercent}
                    </span>
                  </div>
                </div>

                {/* DexScreener Chart Verification Link */}
                <a
                  href={token.dexUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full py-2 px-3 rounded-lg bg-surface-card hover:bg-surface border border-toxic-border hover:border-toxic text-muted hover:text-white font-sans text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <span>DEXSCREENER CHART</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-toxic" />
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};
