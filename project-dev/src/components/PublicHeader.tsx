'use client';

import React from 'react';
import Link from 'next/link';
import { useGenesisBalance } from '@/context/GenesisContext';
import { HexCubeLogo } from '@/components/HexCubeLogo';
import { PUBLIC_DASHBOARD_ENABLED, SOCIAL_LINKS } from '@/lib/config';
import { ArrowUpRight, LogOut, Send, Wallet } from 'lucide-react';

export const PublicHeader: React.FC = () => {
  const { connected, shortAddress, disconnectDemoOrWallet } = useGenesisBalance();

  const handleDisconnect = async (e: React.MouseEvent) => {
    e.preventDefault();
    await disconnectDemoOrWallet();
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-canvas border-b border-toxic-border overflow-hidden">
      <div className="max-w-[1360px] mx-auto px-3 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Hex Cube Icon + Bold TrenchLabsHQ Wordmark */}
        <Link href="/" className="flex items-center gap-2 sm:gap-3 shrink-0 group">
          <HexCubeLogo />
          <span className="font-sans font-extrabold tracking-tight text-lg sm:text-2xl text-white">
            Trench<span className="text-toxic">Labs</span>HQ
          </span>
        </Link>

        {/* Center: Enlarged Navigation Menu Tabs */}
        <nav
          aria-label="Public Navigation"
          className="hidden md:flex items-center gap-6 lg:gap-8 font-sans text-base lg:text-lg font-extrabold uppercase tracking-wide"
        >
          <a
            href="#hero-section"
            className="px-4 py-2 rounded-lg text-white hover:text-toxic hover:bg-surface uppercase transition-colors"
          >
            HOME
          </a>
          <a
            href="#pipeline-section"
            className="px-4 py-2 rounded-lg text-muted hover:text-toxic hover:bg-surface uppercase transition-colors"
          >
            EXPERIMENTS
          </a>
          <a
            href={SOCIAL_LINKS.telegram}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-lg text-muted hover:text-toxic hover:bg-surface uppercase transition-colors inline-flex items-center gap-1.5"
          >
            <span>JOIN THE LAB</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-toxic" />
          </a>
        </nav>

        {/* Right: Primary Soft-Launch CTA (or Dashboard when public access is enabled) & Disconnect */}
        <div className="flex items-center gap-2 shrink-0">
          {connected && PUBLIC_DASHBOARD_ENABLED ? (
            <Link
              href="/dashboard"
              className="h-10 sm:h-11 px-3 sm:px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans text-xs sm:text-sm font-black uppercase tracking-wide inline-flex items-center gap-1.5 sm:gap-2 transition-colors cursor-pointer"
            >
              <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
              <span>DASHBOARD ({shortAddress})</span>
            </Link>
          ) : (
            <a
              href={SOCIAL_LINKS.telegram}
              target="_blank"
              rel="noreferrer"
              className="h-10 sm:h-11 px-3 sm:px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans text-xs sm:text-sm font-black uppercase tracking-wide inline-flex items-center gap-1.5 sm:gap-2 transition-colors cursor-pointer"
            >
              <Send className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
              <span>JOIN THE SOFT LAUNCH</span>
              <ArrowUpRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
            </a>
          )}
          {connected && (
            <button
              type="button"
              onClick={handleDisconnect}
              className="h-10 w-10 sm:h-11 sm:w-11 rounded-lg bg-surface hover:bg-surface-card border border-toxic-border text-muted hover:text-danger flex items-center justify-center transition-colors cursor-pointer"
              title="Disconnect Wallet"
              aria-label="Disconnect Wallet"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
