'use client';

import React from 'react';
import Link from 'next/link';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { HexCubeLogo } from '@/components/HexCubeLogo';
import { SOCIAL_LINKS } from '@/lib/config';
import { useGenesisBalance } from '@/context/GenesisContext';
import { ArrowUpRight, LogOut, Search, Send, Wallet } from 'lucide-react';

export const TerminalHeader: React.FC = () => {
  const { setVisible: openWalletModal } = useWalletModal();
  const {
    connected,
    shortAddress,
    tier,
    setDemoPreset,
    disconnectDemoOrWallet,
    searchQuery,
    setSearchQuery,
  } = useGenesisBalance();

  const handleDisconnect = async (e: React.MouseEvent) => {
    e.preventDefault();
    await disconnectDemoOrWallet();
  };

  const handleConnect = () => {
    setDemoPreset('live');
    openWalletModal(true);
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-canvas border-b border-toxic-border overflow-hidden">
      <div className="max-w-[1360px] mx-auto px-3 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Hex Cube Icon + Bold TrenchLabsHQ Wordmark (Matches Landing Page) */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <Link
            href="/"
            className="flex items-center gap-2 sm:gap-3 shrink-0 group cursor-pointer"
            title="Go to TrenchLabs Landing Page"
          >
            <HexCubeLogo />
            <span className="font-sans font-extrabold tracking-tight text-lg sm:text-2xl text-white">
              Trench<span className="text-toxic">Labs</span>HQ
            </span>
          </Link>
        </div>

        {/* Center: JOIN THE LAB Button & Search Calls Input (Right side of JOIN THE LAB) */}
        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href={SOCIAL_LINKS.telegram}
            target="_blank"
            rel="noreferrer"
            className="h-9 sm:h-10 px-3 sm:px-4 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans text-xs font-black uppercase tracking-wider inline-flex items-center gap-1.5 sm:gap-2 transition-colors shrink-0"
          >
            <Send className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>JOIN THE LAB</span>
            <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
          </a>

          <div className="relative w-36 sm:w-56 md:w-72 lg:w-80">
            <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search calls (token, CA, chain)..."
              className="w-full h-9 sm:h-10 pl-9 pr-3 rounded-lg bg-surface border border-toxic-border focus:border-toxic text-xs text-white placeholder:text-dim focus:outline-none font-sans"
            />
          </div>
        </div>

        {/* Right: Wallet & Disconnect (SOL wallet balance completely removed) */}
        <div className="flex items-center gap-2.5">
          {connected ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => openWalletModal(true)}
                className="h-9 sm:h-10 px-2.5 sm:px-4 rounded-lg bg-surface hover:bg-surface-card border border-toxic-border hover:border-toxic font-mono text-[11px] sm:text-xs text-white flex items-center gap-1.5 sm:gap-2 transition-colors tnum cursor-pointer"
                title="Switch Solana Wallet"
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    tier.id === 'LOCKED' ? 'bg-danger' : 'bg-toxic'
                  }`}
                />
                <span className="font-semibold">{shortAddress}</span>
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                className="h-9 w-9 sm:h-10 sm:w-10 rounded-lg bg-surface hover:bg-surface-card border border-toxic-border text-muted hover:text-danger flex items-center justify-center transition-colors cursor-pointer"
                title="Disconnect Wallet"
                aria-label="Disconnect Wallet"
              >
                <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleConnect}
              className="h-9 sm:h-11 px-4 sm:px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans text-xs sm:text-sm font-black uppercase tracking-wide inline-flex items-center gap-2 cursor-pointer shrink-0"
            >
              <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
              <span>CONNECT</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
