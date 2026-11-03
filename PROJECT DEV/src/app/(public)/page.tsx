'use client';

import React from 'react';
import { HeroTerminal } from '@/components/HeroTerminal';
import { PipelineGrid } from '@/components/PipelineGrid';
import { BUY_LINKS, GENESIS_MINT, SOCIAL_LINKS } from '@/lib/config';
import {
  ArrowUpRight,
  FlaskConical,
  Send,
  ShieldCheck,
} from 'lucide-react';

const LAB_BENEFITS = [
  {
    title: 'Multi-Chain Trade Calls',
    body: 'Browse admin-posted calls across supported networks, filter by chain, and review the details before making your own decision.',
  },
  {
    title: 'Contract Address & Market Links',
    body: 'Copy the contract address shared in each post and open available external market links. Always verify the address and token independently.',
  },
  {
    title: 'Wallet-Balance Access',
    body: 'Hold at least 1,000,000 $GENESIS in your connected Solana wallet to meet the stated dashboard access requirement. No staking is required.',
  },
  {
    title: 'Risk & Target Details',
    body: 'Review the market-cap snapshot, risk ratio, and take-profit targets entered with each call. Calls are informational and can lose value.',
  },
];

export default function LandingPage() {
  return (
    <div className="flex flex-col bg-canvas">
      {/* 1. Hero Section */}
      <HeroTerminal />

      {/* 2. Incubator Pipeline Section (Past Early-Access Tokens & X Profits Earned) */}
      <PipelineGrid />

      {/* 3. JOIN THE LAB — Single 1,000,000 $GENESIS Tier Card (Hard Flat 1px Structure) */}
      <section id="join-lab-section" className="bg-canvas py-16">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          {/* Clean Section Header */}
          <div className="pb-6 border-b border-toxic-border">
            <span className="font-sans text-xs font-bold uppercase tracking-widest text-toxic">
              MEMBERSHIP REQUIREMENT
            </span>
            <h2 className="font-sans text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-white mt-1">
              JOIN THE LAB
            </h2>
            <p className="font-sans text-sm sm:text-base text-muted mt-1.5 max-w-2xl">
              One unified membership tier. Hold{' '}
              <span className="text-toxic-bright font-bold">1,000,000 $GENESIS</span> in your
              Solana login wallet to unlock full access to the TrenchLabs incubator.
            </p>
          </div>

          {/* Combined Single Tier Card (Matches Screenshot 1) */}
          <div className="rounded-2xl bg-surface border border-toxic-border p-6 sm:p-8 lg:p-10">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              {/* Left Column (5 cols): Single Tier Requirement & Merged Buy Button */}
              <div className="lg:col-span-5 space-y-6 lg:pr-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-toxic-bg border border-toxic-border text-toxic font-sans text-xs font-extrabold uppercase tracking-wider">
                  <FlaskConical className="w-4 h-4" />
                  <span>OFFICIAL LAB PASS</span>
                </div>

                <div className="space-y-2">
                  <div className="font-sans text-xs font-bold uppercase tracking-wider text-muted">
                    REQUIRED WALLET BALANCE
                  </div>
                  <div className="font-sans text-4xl sm:text-5xl font-black text-white tracking-tight tnum">
                    1,000,000{' '}
                    <span className="text-toxic font-extrabold">$GENESIS</span>
                  </div>
                  <p className="font-sans text-sm text-muted leading-relaxed pt-1">
                    Hold at least{' '}
                    <strong className="text-toxic">1,000,000 $GENESIS</strong> from contract{' '}
                    <span className="font-mono text-xs text-white break-all">
                      {GENESIS_MINT}
                    </span>{' '}
                    in your wallet to enter the incubator dashboard.
                  </p>
                </div>

                {/* Dual Community & Buy Action Buttons */}
                <div className="pt-2 space-y-3">
                  <a
                    href={SOCIAL_LINKS.telegram}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full h-14 px-6 rounded-xl bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-base uppercase tracking-wide flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <Send className="w-5 h-5 stroke-[2.5]" />
                    <span>JOIN THE LAB</span>
                    <ArrowUpRight className="w-5 h-5 stroke-[2.5]" />
                  </a>

                  <a
                    href={BUY_LINKS.pump}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full h-12 px-6 rounded-xl bg-surface hover:bg-surface-card border border-toxic-border hover:border-toxic text-white font-sans font-extrabold text-sm uppercase tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <span>BUY $GENESIS ON PUMP.FUN</span>
                    <ArrowUpRight className="w-4 h-4 text-toxic stroke-[2.5]" />
                  </a>
                </div>
              </div>

              {/* Right Column (7 cols): 4 Clear Benefits Grid (Matches Screenshot 1) */}
              <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {LAB_BENEFITS.map((benefit) => (
                  <div
                    key={benefit.title}
                    className="p-6 rounded-2xl bg-surface-card border border-toxic-border hover:border-toxic transition-colors space-y-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-toxic shrink-0" />
                      <h3 className="font-sans text-sm font-bold text-white">
                        {benefit.title}
                      </h3>
                    </div>
                    <p className="font-sans text-xs sm:text-sm text-muted leading-relaxed">
                      {benefit.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
