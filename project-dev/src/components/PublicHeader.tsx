'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useGenesisBalance } from '@/context/GenesisContext';
import { HexCubeLogo } from '@/components/HexCubeLogo';
import { SOCIAL_LINKS } from '@/lib/config';
import { ArrowUpRight, LogOut, Menu, Wallet, X } from 'lucide-react';

export const PublicHeader: React.FC = () => {
  const { connected, shortAddress, disconnectDemoOrWallet } = useGenesisBalance();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleDisconnect = async (e: React.MouseEvent) => {
    e.preventDefault();
    await disconnectDemoOrWallet();
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-canvas border-b border-toxic-border">
      <div className="max-w-[1360px] mx-auto px-3 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Hex Cube Icon + Bold TrenchLabsHQ Wordmark */}
        <Link href="/" className="flex items-center gap-2 sm:gap-3 shrink-0 group">
          <HexCubeLogo />
          <span className="font-sans font-extrabold tracking-tight text-base sm:text-2xl text-white">
            Trench<span className="text-toxic">Labs</span>HQ
          </span>
        </Link>

        {/* Center: Enlarged Navigation Menu Tabs (Desktop) */}
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

        {/* Right: CONNECT Button & Mobile Hamburger Toggle */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {connected ? (
            <Link
              href="/dashboard"
              className="h-9 sm:h-11 px-2.5 sm:px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans text-xs sm:text-sm font-black uppercase tracking-wide inline-flex items-center gap-1.5 sm:gap-2 transition-colors cursor-pointer shrink-0"
            >
              <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
              <span className="hidden sm:inline">DASHBOARD ({shortAddress})</span>
              <span className="sm:hidden">{shortAddress}</span>
            </Link>
          ) : (
            <button
              type="button"
              disabled
              aria-disabled="true"
              title="Wallet connection coming soon"
              className="h-9 sm:h-11 px-2.5 sm:px-6 rounded-lg bg-surface border border-toxic-border/60 text-muted font-sans text-[11px] sm:text-sm font-black uppercase tracking-wide inline-flex items-center gap-1.5 sm:gap-2 cursor-not-allowed opacity-75 select-none shrink-0"
            >
              <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5] text-muted shrink-0" />
              <span className="hidden sm:inline">CONNECT WALLET · LIVE SOON</span>
              <span className="sm:hidden">LIVE SOON</span>
            </button>
          )}

          {connected && (
            <button
              type="button"
              onClick={handleDisconnect}
              className="h-9 w-9 sm:h-11 sm:w-11 rounded-lg bg-surface hover:bg-surface-card border border-toxic-border text-muted hover:text-danger flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="Disconnect Wallet"
              aria-label="Disconnect Wallet"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}

          {/* Mobile Navigation Toggle Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden h-9 w-9 rounded-lg bg-surface hover:bg-surface-card border border-border-default hover:border-toxic text-white flex items-center justify-center transition-colors shrink-0"
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'}
          >
            {mobileMenuOpen ? <X className="w-5 h-5 text-toxic" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Collapsible Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border-default bg-surface-primary px-4 py-4 space-y-2 animate-in fade-in slide-in-from-top-2 duration-150">
          <a
            href="#hero-section"
            onClick={() => setMobileMenuOpen(false)}
            className="flex items-center h-11 px-4 rounded-lg text-white font-sans font-bold text-sm hover:bg-surface-elevated hover:text-toxic transition-colors uppercase tracking-wider"
          >
            HOME
          </a>
          <a
            href="#pipeline-section"
            onClick={() => setMobileMenuOpen(false)}
            className="flex items-center h-11 px-4 rounded-lg text-muted font-sans font-bold text-sm hover:bg-surface-elevated hover:text-toxic transition-colors uppercase tracking-wider"
          >
            EXPERIMENTS
          </a>
          <a
            href={SOCIAL_LINKS.telegram}
            target="_blank"
            rel="noreferrer"
            onClick={() => setMobileMenuOpen(false)}
            className="flex items-center justify-between h-11 px-4 rounded-lg text-muted font-sans font-bold text-sm hover:bg-surface-elevated hover:text-toxic transition-colors uppercase tracking-wider"
          >
            <span>JOIN THE LAB</span>
            <ArrowUpRight className="w-4 h-4 text-toxic" />
          </a>
        </div>
      )}
    </header>
  );
};
