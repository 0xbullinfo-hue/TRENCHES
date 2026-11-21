'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HexCubeLogo } from '@/components/HexCubeLogo';
import { Button } from '@/components/ui/Button';
import { SOCIAL_LINKS } from '@/lib/config';
import { useGenesisBalance } from '@/context/GenesisContext';
import { ArrowUpRight, Command, LogOut, Search, Send, Wallet } from 'lucide-react';

export const TerminalHeader: React.FC = () => {
  const pathname = usePathname();
  const {
    connected,
    shortAddress,
    tier,
    connectWallet,
    switchWallet,
    disconnectDemoOrWallet,
  } = useGenesisBalance();

  const handleOpenCommandPalette = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  };

  const handleDisconnect = async (e: React.MouseEvent) => {
    e.preventDefault();
    await disconnectDemoOrWallet();
  };

  const communityUrl = process.env.NEXT_PUBLIC_COMMUNITY_TG_URL?.trim() || SOCIAL_LINKS.telegram;
  const isDashboardRoute = pathname?.startsWith('/dashboard');

  return (
    <header className="sticky top-0 z-40 w-full bg-canvas border-b border-brand-border">
      <div className="max-w-[1360px] mx-auto px-3 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Hex Cube Icon + Bold TrenchLabsHQ Wordmark */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <Link
            href="/"
            className="flex items-center gap-2 sm:gap-3 shrink-0 group cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            title="Go to TrenchLabs Landing Page"
          >
            <HexCubeLogo />
            <span className="font-sans font-extrabold tracking-tight text-base sm:text-2xl text-white">
              Trench<span className="text-brand">Labs</span>HQ
            </span>
          </Link>
        </div>

        {/* Center: Quick Jump Palette Trigger & Primary App Routes (Desktop) */}
        <div className="hidden md:flex items-center gap-2 sm:gap-3 flex-1 justify-end max-w-xl mx-4">
          <button
            type="button"
            onClick={handleOpenCommandPalette}
            className="flex-1 max-w-[260px] h-10 px-3 rounded-lg bg-surface hover:bg-surface-card border border-border-default hover:border-brand text-xs text-muted hover:text-white inline-flex items-center justify-between gap-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            title="Open quick jump & call lookup (Ctrl+K)"
            aria-label="Quick jump and call lookup"
          >
            <span className="inline-flex items-center gap-2 truncate">
              <Search className="w-3.5 h-3.5 text-brand shrink-0" />
              <span className="truncate">Quick jump &amp; token lookup...</span>
            </span>
            <kbd className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-surface-card border border-border-default font-mono text-[10px] font-bold text-dim shrink-0">
              <Command className="w-2.5 h-2.5" />K
            </kbd>
          </button>

          <Link
            href="/dashboard"
            title="Open Lab Analysis terminal"
            className={`h-10 px-3.5 rounded-lg border font-sans text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
              pathname === '/dashboard'
                ? 'bg-surface-card border-brand text-brand font-black'
                : 'bg-surface hover:bg-surface-card border-border-default hover:border-brand text-white'
            }`}
          >
            <span>Dashboard</span>
          </Link>

          {!isDashboardRoute && (
            <Link
              href="/ledger"
              className={`h-10 px-3.5 rounded-lg border font-sans text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                pathname === '/ledger'
                  ? 'bg-surface-card border-brand text-brand font-black'
                  : 'bg-surface hover:bg-surface-card border-border-default hover:border-brand text-white'
              }`}
            >
              <span>Ledger</span>
            </Link>
          )}

          <a
            href={communityUrl}
            target="_blank"
            rel="noreferrer"
            className="h-10 px-3.5 rounded-lg bg-brand hover:bg-brand-bright text-canvas font-sans text-xs font-black uppercase tracking-wider inline-flex items-center gap-1.5 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
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
              <Button
                variant="secondary"
                size="md"
                onClick={switchWallet}
                className="font-mono text-xs text-white flex items-center gap-2 tnum"
                title="Switch Solana Wallet"
                aria-label="Switch Solana Wallet"
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    tier.id === 'LOCKED'
                      ? 'bg-danger'
                      : tier.id === 'PRO'
                      ? 'bg-alpha-strong'
                      : 'bg-brand'
                  }`}
                />
                <span className="font-semibold">{shortAddress}</span>
                <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-xs font-sans font-bold bg-surface-card border border-border-default uppercase text-muted">
                  {tier.id === 'PRO' ? 'PRO' : tier.id === 'LAB_MEMBER' ? 'MEMBER' : 'FREE'}
                </span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                className="h-10 w-10 p-0 border border-border-default text-muted hover:text-danger"
                title="Disconnect Wallet"
                aria-label="Disconnect Wallet"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <Button
              variant="primary"
              size="md"
              onClick={connectWallet}
              className="h-10 sm:h-11 px-4 sm:px-6 text-xs sm:text-sm font-black uppercase tracking-wide gap-2 shrink-0"
            >
              <Wallet className="w-4 h-4 stroke-[2.5]" />
              <span>CONNECT</span>
            </Button>
          )}
        </div>
      </div>

      {/* Mobile Sub-bar: Quick Jump + Route Shortcuts on Mobile */}
      <div className="md:hidden px-3 py-2 border-t border-border-default bg-surface flex items-center gap-2">
        <button
          type="button"
          onClick={handleOpenCommandPalette}
          className="flex-1 h-9 px-3 rounded-lg bg-surface-card border border-border-default hover:border-brand text-xs text-muted hover:text-white inline-flex items-center gap-2 font-sans cursor-pointer truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          aria-label="Quick jump and token lookup"
        >
          <Search className="w-3.5 h-3.5 text-brand shrink-0" />
          <span className="truncate">Quick jump...</span>
        </button>
        <Link
          href="/dashboard"
          className={`h-9 px-3 rounded-lg border font-sans text-xs font-bold uppercase inline-flex items-center shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
            pathname === '/dashboard'
              ? 'bg-surface-card border-brand text-brand'
              : 'bg-surface-card border-border-default text-white'
          }`}
        >
          Dashboard
        </Link>
        {!isDashboardRoute && (
          <Link
            href="/ledger"
            className={`h-9 px-3 rounded-lg border font-sans text-xs font-bold uppercase inline-flex items-center shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
              pathname === '/ledger'
                ? 'bg-surface-card border-brand text-brand'
                : 'bg-surface-card border-border-default text-white'
            }`}
          >
            Ledger
          </Link>
        )}
      </div>
    </header>
  );
};
