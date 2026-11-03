'use client';

import React from 'react';
import Link from 'next/link';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { MascotRat } from '@/components/MascotRat';
import { useGenesisBalance } from '@/context/GenesisContext';
import { ArrowUpRight, LogOut, Send, Wallet } from 'lucide-react';

export const TerminalHeader: React.FC = () => {
  const { setVisible: openWalletModal } = useWalletModal();
  const {
    connected,
    shortAddress,
    formattedBalance,
    tier,
    isUnlocked,
    disconnectDemoOrWallet,
  } = useGenesisBalance();

  return (
    <header className="sticky top-0 z-40 w-full bg-canvas border-b border-toxic-border overflow-hidden">
      <div className="max-w-[1360px] mx-auto px-3 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Brand Wordmark */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <Link href="/" className="flex items-center gap-2 sm:gap-2.5 shrink-0 group">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-md bg-surface border border-toxic-border group-hover:border-toxic flex items-center justify-center transition-colors">
              <MascotRat variant="icon" size={26} />
            </div>
            <div className="flex items-baseline gap-1.5 sm:gap-2">
              <span className="font-sans font-extrabold tracking-tight text-base sm:text-xl text-white">
                Trench<span className="text-toxic">Labs</span>HQ
              </span>
            </div>
          </Link>
        </div>

        {/* Center: JOIN THE LAB Button (Replaces plain text link) */}
        <div className="flex items-center">
          <a
            href="https://t.me/TrenchLabsHQ"
            target="_blank"
            rel="noreferrer"
            className="h-9 sm:h-10 px-4 sm:px-5 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans text-xs font-black uppercase tracking-wider inline-flex items-center gap-2 transition-colors shrink-0"
          >
            <Send className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>JOIN THE LAB</span>
            <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
          </a>
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
                onClick={disconnectDemoOrWallet}
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
              onClick={() => openWalletModal(true)}
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
