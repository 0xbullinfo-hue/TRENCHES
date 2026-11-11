'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, Check, Copy, TrendingUp, AlertCircle, ShieldCheck } from 'lucide-react';

interface PastIncubationToken {
  id: string;
  serialTag: string;
  name: string;
  ticker: string;
  chain: 'BSC' | 'SOL' | 'ETH' | 'BASE';
  logoUrl: string;
  contractAddress: string;
  pairAddress: string;
  profitMultiple: string;
  entryMc: string;
  peakMc: string;
  netGain: string;
  callDate: string;
  tpMilestones: string;
  dexUrl: string;
  summary: string;
}

const PAST_INCUBATIONS: PastIncubationToken[] = [
  {
    id: 'exp-01-lity',
    serialTag: 'EXP01',
    name: 'LITY Protocol',
    ticker: '$LITY',
    chain: 'BSC',
    logoUrl:
      'https://cdn.dexscreener.com/cms/images/gZf7k7pcCQwCEpE7?width=800&height=800&quality=95&format=auto',
    contractAddress: '0xD7057e7C56B9C2d5f0a3E639D07610db31C949c8',
    pairAddress: '0x91727e4485542612e9ed4293d1021414dbf5e588',
    profitMultiple: '12.1x',
    entryMc: '$580K',
    peakMc: '$7.0M',
    netGain: '+1,106%',
    callDate: 'Oct 2026',
    tpMilestones: 'TP1 (2x) • TP2 (5x) • TP3 (10x) Hit',
    dexUrl: 'https://dexscreener.com/bsc/0x91727e4485542612e9ed4293d1021414dbf5e588',
    summary:
      'Decentralized AI liquidity routing & bridge protocol on BSC. Early alpha call alerted to Lab members at $580K market cap before a massive multi-million run surging to a $7.0M peak (12.1x profit).',
  },
  {
    id: 'exp-02-bc400',
    serialTag: 'EXP02',
    name: 'BITCOIN CULTIVATOR 400',
    ticker: '$BC400',
    chain: 'BSC',
    logoUrl:
      'https://cdn.dexscreener.com/cms/images/16c7530aeb312896c9f5c0f6079168064e8d2d53a52a1b9cd9135b66e50d0670?width=800&height=800&quality=95&format=auto',
    contractAddress: '0x61Fc93c7C070B32B1b1479B86056d8Ec1D7125BD',
    pairAddress: '0xa02e8735cdc35aea44a770cb511513826e6c68c5',
    profitMultiple: '7.0x',
    entryMc: '$880K',
    peakMc: '$6.2M',
    netGain: '+604%',
    callDate: 'Oct 2026',
    tpMilestones: 'TP1 (2x) • TP2 (5x) Hit',
    dexUrl: 'https://dexscreener.com/bsc/0xa02e8735cdc35aea44a770cb511513826e6c68c5',
    summary:
      'Bitcoin Cultivator 400 algorithmic yield and tokenized farming protocol on BNB Chain. Dispatched at $880K entry before climbing aggressively into price discovery to a $6.2M peak (7.0x profit).',
  },
  {
    id: 'exp-03-water',
    serialTag: 'EXP03',
    name: 'Clean Water',
    ticker: '$WATER',
    chain: 'BSC',
    logoUrl:
      'https://cdn.dexscreener.com/cms/images/1lL2cKq6H5rbcLWC?width=800&height=800&quality=95&format=auto',
    contractAddress: '0x5056d8DFf13388813e4BA9B26375aef658E0044F',
    pairAddress: '0xe8d2a16a9526ca7706c4a13e8b119416791c99b0',
    profitMultiple: '15.0x',
    entryMc: '$8.0K',
    peakMc: '$120K',
    netGain: '+1,400%',
    callDate: 'Nov 2026',
    tpMilestones: 'TP1 (2x) • TP2 (5x) • TP3 (10x) Hit',
    dexUrl: 'https://dexscreener.com/bsc/0xe8d2a16a9526ca7706c4a13e8b119416791c99b0',
    summary:
      'Clean Water Foundation real-world impact charity ecosystem on BNB Chain. Ultra micro-cap entry called at just $8K market cap before an explosive parabolic 15x run to $120K peak (15.0x profit).',
  },
  {
    id: 'exp-04-azuki',
    serialTag: 'EXP04',
    name: 'AZUKI ANIME',
    ticker: '$AZUKI',
    chain: 'BSC',
    logoUrl:
      'https://cdn.dexscreener.com/cms/images/WlCy7-OsXhVq_zw0?width=800&height=800&quality=95&format=auto',
    contractAddress: '0x5963dbDC6BB18f9F1AFc07C0Cb8EBF354dB24cbB',
    pairAddress: '0x2d6025e3d98fa8d0406267dc5a06694371c93c12',
    profitMultiple: '2.6x',
    entryMc: '$21K',
    peakMc: '$55K',
    netGain: '+162%',
    callDate: 'Nov 2026',
    tpMilestones: 'TP1 (2x) Hit',
    dexUrl: 'https://dexscreener.com/bsc/0x2d6025e3d98fa8d0406267dc5a06694371c93c12',
    summary:
      'Community-driven anime culture and gaming brand coin on BSC. Quick-trigger trench momentum call alerted at $21K entry, successfully hitting take-profit targets at $55K peak (2.6x profit).',
  },
];

export const PipelineGrid: React.FC = () => {
  const [copiedCa, setCopiedCa] = useState<string | null>(null);
  const [copyFailedCa, setCopyFailedCa] = useState<string | null>(null);

  const handleCopyCa = async (ca: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(ca);
      setCopiedCa(ca);
      setCopyFailedCa(null);
      setTimeout(() => setCopiedCa(null), 2000);
    } catch {
      setCopyFailedCa(ca);
      setTimeout(() => setCopyFailedCa(null), 2500);
    }
  };

  return (
    <section id="pipeline-section" className="border-b border-toxic-border bg-canvas py-16">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-toxic-border">
          <div>
            <span className="font-sans text-xs font-bold uppercase tracking-widest text-toxic">
              PROVEN TRACK RECORD
            </span>
            <h2 className="font-sans text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-white mt-1">
              INCUBATOR PIPELINE
            </h2>
            <p className="font-sans text-sm sm:text-base text-muted mt-1.5 max-w-2xl">
              Recorded research calls verified early for community members — comparing initial entry market cap to peak recorded multiples.
            </p>
          </div>

          <Link
            href="/ledger"
            className="self-start md:self-auto h-11 px-5 rounded-lg bg-surface hover:bg-surface-card border border-toxic text-white hover:text-toxic font-sans text-xs font-extrabold uppercase tracking-wider inline-flex items-center gap-2 transition-colors cursor-pointer shrink-0"
          >
            <ShieldCheck className="w-4 h-4 text-toxic" />
            <span>VIEW FULL PERFORMANCE LEDGER</span>
            <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>

        {/* 4 Aligned Early-Entry Profit Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 items-stretch">
          {PAST_INCUBATIONS.map((token) => {
            const isCopied = copiedCa === token.contractAddress;
            const shortCa = `${token.contractAddress.slice(0, 6)}...${token.contractAddress.slice(-4)}`;

            return (
              <article
                key={token.id}
                className="rounded-xl bg-surface border border-border-default hover:border-toxic transition-all duration-150 flex flex-col justify-between overflow-hidden group shadow-none"
              >
                <div>
                  {/* Top Header Strip: Chain + Original Call Date */}
                  <div className="px-5 py-2.5 bg-surface-card border-b border-border-default flex items-center justify-between text-xs font-semibold">
                    <span className="text-muted font-mono text-[11px]">
                      Call: {token.callDate}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-toxic-bg border border-toxic-border text-toxic font-mono text-xs font-bold">
                      {token.chain}
                    </span>
                  </div>

                  {/* Token Identity & Peak X Multiple Banner */}
                  <div className="p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Image
                          src={token.logoUrl}
                          alt={`${token.name} logo`}
                          width={44}
                          height={44}
                          unoptimized
                          className="w-11 h-11 rounded-lg border border-border-default object-cover bg-surface-card shrink-0"
                        />
                        <div>
                          <h3 className="font-sans text-base sm:text-lg font-extrabold text-white leading-tight">
                            {token.name}
                          </h3>
                          <div className="font-mono text-sm text-toxic font-bold mt-0.5">
                            {token.ticker}
                          </div>
                        </div>
                      </div>

                      {/* Max Recorded Multiple */}
                      <div className="text-right shrink-0">
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-toxic text-canvas font-sans text-base font-black tnum">
                          <TrendingUp className="w-3.5 h-3.5 stroke-[3]" />
                          <span>{token.profitMultiple}</span>
                        </div>
                        <div className="font-sans text-[10px] text-toxic font-bold uppercase mt-1 tracking-wider">
                          PEAK MULTIPLE
                        </div>
                      </div>
                    </div>

                    {/* Contract Address Bar with Copy Action */}
                    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface-card border border-border-default font-mono text-xs">
                      <span className="text-muted text-[11px] uppercase font-bold shrink-0">CA:</span>
                      <span className="text-white font-medium truncate tnum">{shortCa}</span>
                      <button
                        type="button"
                        onClick={(e) => handleCopyCa(token.contractAddress, e)}
                        className="text-toxic hover:text-toxic-bright font-sans text-[11px] font-bold uppercase inline-flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
                        title="Copy Contract Address"
                        aria-label={`Copy ${token.name} contract address`}
                      >
                        {copyFailedCa === token.contractAddress ? (
                          <span className="text-danger font-bold">FAILED</span>
                        ) : isCopied ? (
                          <>
                            <Check className="w-3 h-3 text-toxic-bright" />
                            <span className="text-toxic-bright">COPIED</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>COPY</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Milestone notes */}
                    <div className="text-[11px] font-mono text-toxic-bright font-semibold">
                      {token.tpMilestones}
                    </div>

                    {/* Context Explanation */}
                    <p className="font-sans text-xs text-muted leading-relaxed line-clamp-3 min-h-[3.5rem]">
                      {token.summary}
                    </p>
                  </div>
                </div>

                {/* Metrics Table: Entry MC, Peak MC, Net Multiple */}
                <div className="px-5 pb-5 space-y-3">
                  <div className="bg-surface-card border border-border-default rounded-lg divide-y divide-border-default font-sans text-xs">
                    <div className="px-3.5 py-2.5 flex items-center justify-between">
                      <span className="text-muted font-medium">ENTRY MARKET CAP</span>
                      <span className="text-white font-bold tnum">{token.entryMc}</span>
                    </div>
                    <div className="px-3.5 py-2.5 flex items-center justify-between">
                      <span className="text-muted font-medium">PEAK MARKET CAP</span>
                      <span className="text-toxic font-black tnum">{token.peakMc}</span>
                    </div>
                    <div className="px-3.5 py-2.5 flex items-center justify-between">
                      <span className="text-muted font-medium">MAX RECORDED MULTIPLE</span>
                      <span className="text-toxic-bright font-extrabold tnum">
                        {token.profitMultiple} ({token.netGain})
                      </span>
                    </div>
                  </div>

                  {/* DexScreener Chart Verification Link */}
                  <a
                    href={token.dexUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full h-10 px-4 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default hover:border-toxic text-white font-sans text-xs font-extrabold uppercase inline-flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <span>VIEW ON DEXSCREENER</span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-toxic" />
                  </a>
                </div>
              </article>
            );
          })}
        </div>

        {/* Realised Profit Disclaimer Note */}
        <div className="rounded-lg bg-surface border border-border-default p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-muted shrink-0 mt-0.5" />
          <p className="font-sans text-xs text-muted leading-relaxed">
            <strong className="text-white">PERFORMANCE DISCLOSURE:</strong> Peak market-cap multiples reflect the highest recorded valuation following the original research call timestamp. Peak multiple performance does not guarantee realized profit; actual investor returns depend on individual trade timing, execution, slippage, liquidity, and risk management.
          </p>
        </div>
      </div>
    </section>
  );
};
