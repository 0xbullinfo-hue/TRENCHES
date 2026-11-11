'use client';

import React from 'react';
import Link from 'next/link';
import { BUY_LINKS } from '@/lib/config';
import {
  ArrowUpRight,
  Check,
  Copy,
  Flame,
  Gift,
  Sparkles,
  Star,
  Target,
  Wallet,
} from 'lucide-react';

interface DashboardOverviewProps {
  connected: boolean;
  shortAddress: string;
  tier: { id: string; label?: string; multiplier?: number };
  formattedBalance: string;
  alphasCount: number;
  newCallsCount: number;
  raidsCount: number;
  watchlistCount: number;
  isUnlocked: boolean;
  onCopyGenesisCa: (e: React.MouseEvent) => void;
  copiedGenesisCa: boolean;
  onSelectFilter?: (filter: 'all' | 'new' | 'watchlist') => void;
  onSelectTab?: (tab: 'alphas' | 'raids') => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  connected,
  shortAddress,
  tier,
  formattedBalance,
  alphasCount,
  newCallsCount,
  raidsCount,
  watchlistCount,
  isUnlocked,
  onCopyGenesisCa,
  copiedGenesisCa,
  onSelectFilter,
  onSelectTab,
}) => {
  const isPro = tier.id === 'PRO';
  const isMember = tier.id === 'MEMBER' || tier.id === 'LAB_MEMBER';
  const tierDisplayName = isPro ? 'PRO TIER' : isMember ? 'MEMBER TIER' : 'FREE TIER';

  return (
    <div className="space-y-5">
      {/* 1. Welcome Panel & Membership Summary Strip */}
      <div className="rounded-xl bg-surface border border-border-default p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-border-default">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-surface-card border border-border-default flex items-center justify-center text-toxic shrink-0">
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-sans text-xl sm:text-2xl font-black text-white uppercase tracking-tight">
                  Welcome to the Lab
                </h1>
                <span
                  className={`px-2 py-0.5 rounded-md font-mono text-[11px] font-black uppercase ${
                    isPro
                      ? 'bg-alpha-strong text-white border border-alpha-border'
                      : isMember
                      ? 'bg-toxic-bg text-toxic border border-toxic-border'
                      : 'bg-surface-card text-muted border border-border-default'
                  }`}
                >
                  {tierDisplayName}
                </span>
              </div>
              <p className="font-sans text-xs text-muted mt-0.5">
                Multi-chain trade intelligence terminal, risk telemetry, and community rewards.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onCopyGenesisCa}
              className="h-10 px-3.5 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default hover:border-toxic font-sans text-xs font-bold text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Copy $GENESIS token contract address"
            >
              {copiedGenesisCa ? (
                <Check className="w-3.5 h-3.5 text-toxic" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-toxic" />
              )}
              <span>{copiedGenesisCa ? 'Copied CA' : 'Copy $GENESIS CA'}</span>
            </button>

            <a
              href={BUY_LINKS.pump}
              target="_blank"
              rel="noreferrer"
              className="h-10 px-4 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans text-xs font-black uppercase inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>Buy $GENESIS</span>
              <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
            </a>
          </div>
        </div>

        {/* 2. Membership Telemetry Grid (Section 4.2 B) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
          <div className="p-3.5 rounded-lg bg-surface-card border border-border-default space-y-1">
            <div className="text-[10px] text-muted uppercase font-bold tracking-wider flex items-center justify-between">
              <span>WALLET STATUS</span>
              <Wallet className="w-3.5 h-3.5 text-toxic" />
            </div>
            <div className="text-white font-bold truncate tnum">
              {connected ? shortAddress : 'Disconnected'}
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-surface-card border border-border-default space-y-1">
            <div className="text-[10px] text-muted uppercase font-bold tracking-wider flex items-center justify-between">
              <span>VERIFIED BALANCE</span>
              <span className="text-toxic font-mono text-[10px]">SPL</span>
            </div>
            <div className="text-white font-black tnum">
              {formattedBalance} $GENESIS
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-surface-card border border-border-default space-y-1">
            <div className="text-[10px] text-muted uppercase font-bold tracking-wider flex items-center justify-between">
              <span>RESEARCH ACCESS</span>
              <Target className="w-3.5 h-3.5 text-alpha-primary" />
            </div>
            <div className="text-white font-bold">
              {isUnlocked ? 'Unlocked (Standard Calls)' : 'Locked (~$20 Required)'}
            </div>
          </div>

          <Link
            href="/dashboard/stake"
            className="p-3.5 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default hover:border-toxic space-y-1 transition-colors cursor-pointer block group focus:outline-none focus-visible:ring-1 focus-visible:ring-toxic"
            title="Explore StakePoint 90-day staking for Pro Tier"
          >
            <div className="text-[10px] text-muted group-hover:text-toxic uppercase font-bold tracking-wider flex items-center justify-between">
              <span>PRO STAKING STATUS</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-toxic" />
            </div>
            <div className="text-toxic-bright font-black">
              {isPro ? 'Pro Eligible (Active Stake)' : 'Stake on StakePoint ↗'}
            </div>
          </Link>
        </div>

        {/* 3. Interactive Activity Summary (Section 7.2) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 border-t border-border-default font-mono text-xs">
          <button
            type="button"
            onClick={() => {
              onSelectTab?.('alphas');
              onSelectFilter?.('all');
            }}
            className="p-3 rounded-lg bg-surface-card/60 hover:bg-surface-card border border-transparent hover:border-alpha-border flex items-center justify-between transition-colors text-left cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-alpha-primary"
            title="View all active Alpha Calls"
          >
            <div className="space-y-0.5">
              <div className="text-[10px] text-muted uppercase font-bold">ACTIVE CALLS</div>
              <div className="text-base font-black text-white tnum">{alphasCount}</div>
            </div>
            <Target className="w-4 h-4 text-alpha-primary" />
          </button>

          <button
            type="button"
            onClick={() => {
              onSelectTab?.('alphas');
              onSelectFilter?.('new');
            }}
            className="p-3 rounded-lg bg-surface-card/60 hover:bg-surface-card border border-transparent hover:border-toxic flex items-center justify-between transition-colors text-left cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-toxic"
            title="Filter by new Alpha Calls"
          >
            <div className="space-y-0.5">
              <div className="text-[10px] text-muted uppercase font-bold">NEW CALLS</div>
              <div className="text-base font-black text-toxic tnum">{newCallsCount}</div>
            </div>
            <Sparkles className="w-4 h-4 text-toxic" />
          </button>

          <button
            type="button"
            onClick={() => {
              onSelectTab?.('raids');
              const raidsEl = document.getElementById('raids-section');
              if (raidsEl) raidsEl.scrollIntoView({ behavior: 'smooth' });
            }}
            className="p-3 rounded-lg bg-surface-card/60 hover:bg-surface-card border border-transparent hover:border-raid-border flex items-center justify-between transition-colors text-left cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-raid-primary"
            title="Jump to Social Raids section"
          >
            <div className="space-y-0.5">
              <div className="text-[10px] text-muted uppercase font-bold">ACTIVE RAIDS</div>
              <div className="text-base font-black text-raid-primary tnum">{raidsCount}</div>
            </div>
            <Gift className="w-4 h-4 text-raid-primary" />
          </button>

          <button
            type="button"
            onClick={() => {
              onSelectTab?.('alphas');
              onSelectFilter?.('watchlist');
            }}
            className="p-3 rounded-lg bg-surface-card/60 hover:bg-surface-card border border-transparent hover:border-amber flex items-center justify-between transition-colors text-left cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-amber"
            title="View saved Watchlist tokens"
          >
            <div className="space-y-0.5">
              <div className="text-[10px] text-muted uppercase font-bold">WATCHLIST</div>
              <div className="text-base font-black text-amber tnum">{watchlistCount}</div>
            </div>
            <Star className="w-4 h-4 text-amber" />
          </button>
        </div>
      </div>
    </div>
  );
};
