'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HexCubeLogo } from '@/components/HexCubeLogo';
import { SOCIAL_LINKS } from '@/lib/config';
import { useGenesisBalance } from '@/context/GenesisContext';
import { ArrowUpRight, LogOut, Search, Send, Sparkles, Target, Wallet, X } from 'lucide-react';

export const TerminalHeader: React.FC = () => {
  const pathname = usePathname();
  const {
    connected,
    shortAddress,
    tier,
    connectWallet,
    switchWallet,
    disconnectDemoOrWallet,
    searchQuery,
    setSearchQuery,
  } = useGenesisBalance();

  const handleDisconnect = async (e: React.MouseEvent) => {
    e.preventDefault();
    await disconnectDemoOrWallet();
  };

  const communityUrl = process.env.NEXT_PUBLIC_COMMUNITY_TG_URL?.trim() || SOCIAL_LINKS.telegram;

  return (
    <header className="sticky top-0 z-40 w-full bg-canvas border-b border-toxic-border">
      <div className="max-w-[1360px] mx-auto px-3 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Hex Cube Icon + Bold TrenchLabsHQ Wordmark */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <Link
            href="/"
            className="flex items-center gap-2 sm:gap-3 shrink-0 group cursor-pointer"
            title="Go to TrenchLabs Landing Page"
          >
            <HexCubeLogo />
            <span className="font-sans font-extrabold tracking-tight text-base sm:text-2xl text-white">
              Trench<span className="text-toxic">Labs</span>HQ
            </span>
          </Link>
        </div>

        {/* Center: Search & Navigation Tabs (Desktop) */}
        <div className="hidden md:flex items-center gap-2 sm:gap-3 flex-1 max-w-xl mx-4">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search calls (token, CA, chain)..."
              className="w-full h-10 pl-9 pr-8 rounded-lg bg-surface border border-border-default focus:border-toxic text-xs text-white placeholder:text-dim focus:outline-none font-sans"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-white p-1"
                title="Clear search"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <Link
            href="/dashboard"
            className={`h-10 px-3.5 rounded-lg border font-sans text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5 transition-colors shrink-0 ${
              pathname === '/dashboard'
                ? 'bg-surface-card border-toxic text-toxic font-black'
                : 'bg-surface hover:bg-surface-card border-border-default hover:border-toxic text-white'
            }`}
          >
            <span>Dashboard</span>
          </Link>

          <Link
            href="/ledger"
            className={`h-10 px-3.5 rounded-lg border font-sans text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5 transition-colors shrink-0 ${
              pathname === '/ledger'
                ? 'bg-surface-card border-toxic text-toxic font-black'
                : 'bg-surface hover:bg-surface-card border-border-default hover:border-toxic text-white'
            }`}
          >
            <span>Ledger</span>
          </Link>

          <a
            href={communityUrl}
            target="_blank"
            rel="noreferrer"
            className="h-10 px-3.5 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans text-xs font-black uppercase tracking-wider inline-flex items-center gap-1.5 transition-colors shrink-0"
          >
            <Send className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Community</span>
            <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
          </a>
        </div>

        {/* Right: Wallet & Account Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {connected ? (
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                type="button"
                onClick={switchWallet}
                className="h-10 px-3 sm:px-4 rounded-lg bg-surface hover:bg-surface-card border border-border-default hover:border-toxic font-mono text-xs text-white flex items-center gap-2 transition-colors tnum cursor-pointer"
                title="Switch Solana Wallet"
                aria-label="Switch Solana Wallet"
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    tier.id === 'LOCKED'
                      ? 'bg-danger'
                      : tier.id === 'PRO'
                      ? 'bg-alpha-strong'
                      : 'bg-toxic'
                  }`}
                />
                <span className="font-semibold">{shortAddress}</span>
                <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[10px] font-sans font-bold bg-surface-card border border-border-default uppercase text-muted">
                  {tier.id === 'PRO' ? 'PRO' : tier.id === 'LAB_MEMBER' ? 'MEMBER' : 'FREE'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleDisconnect}
                className="h-10 w-10 rounded-lg bg-surface hover:bg-surface-card border border-border-default text-muted hover:text-danger flex items-center justify-center transition-colors cursor-pointer"
                title="Disconnect Wallet"
                aria-label="Disconnect Wallet"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={connectWallet}
              className="h-10 sm:h-11 px-4 sm:px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans text-xs sm:text-sm font-black uppercase tracking-wide inline-flex items-center gap-2 cursor-pointer transition-colors shrink-0"
            >
              <Wallet className="w-4 h-4 stroke-[2.5]" />
              <span>CONNECT</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile Sub-bar: Search Input on Mobile */}
      <div className="md:hidden px-3 py-2 border-t border-border-default bg-surface flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search calls (token, CA, chain)..."
            className="w-full h-9 pl-8 pr-8 rounded-lg bg-surface-card border border-border-default focus:border-toxic text-xs text-white placeholder:text-dim focus:outline-none font-sans"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-white p-1"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <Link
          href="/dashboard"
          className={`h-9 px-3 rounded-lg border font-sans text-xs font-bold uppercase inline-flex items-center shrink-0 transition-colors ${
            pathname === '/dashboard'
              ? 'bg-surface-card border-toxic text-toxic'
              : 'bg-surface-card border-border-default text-white'
          }`}
        >
          Dashboard
        </Link>
        <Link
          href="/ledger"
          className={`h-9 px-3 rounded-lg border font-sans text-xs font-bold uppercase inline-flex items-center shrink-0 transition-colors ${
            pathname === '/ledger'
              ? 'bg-surface-card border-toxic text-toxic'
              : 'bg-surface-card border-border-default text-white'
          }`}
        >
          Ledger
        </Link>
      </div>
    </header>
  );
};
