'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useGenesisBalance } from '@/context/GenesisContext';
import { Wallet } from 'lucide-react';

function HexCubeLogo() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      <polygon
        points="18,2 32,10 32,26 18,34 4,26 4,10"
        stroke="#4DFE15"
        strokeWidth="2"
        fill="#11161D"
      />
      <polygon
        points="18,7 27,12.5 27,23.5 18,29 9,23.5 9,12.5"
        stroke="#76FF32"
        strokeWidth="1.2"
        strokeDasharray="2 2"
      />
      <line
        x1="18"
        y1="18"
        x2="18"
        y2="29"
        stroke="#4DFE15"
        strokeWidth="1.3"
        strokeDasharray="2 2"
      />
      <line
        x1="18"
        y1="18"
        x2="9"
        y2="12.5"
        stroke="#4DFE15"
        strokeWidth="1.3"
        strokeDasharray="2 2"
      />
      <line
        x1="18"
        y1="18"
        x2="27"
        y2="12.5"
        stroke="#4DFE15"
        strokeWidth="1.3"
        strokeDasharray="2 2"
      />
      <circle cx="18" cy="18" r="2.2" fill="#4DFE15" />
    </svg>
  );
}

export const PublicHeader: React.FC = () => {
  const router = useRouter();
  const { setVisible: openWalletModal } = useWalletModal();
  const { connected, shortAddress } = useGenesisBalance();

  const handleConnectClick = () => {
    if (!connected) {
      openWalletModal(true);
    }
    router.push('/dashboard');
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
          className="hidden md:flex items-center gap-6 lg:gap-8 font-sans text-base lg:text-lg font-extrabold tracking-wide"
        >
          <a
            href="#hero-section"
            className="px-4 py-2 rounded-lg text-white hover:text-toxic hover:bg-surface transition-colors"
          >
            Home
          </a>
          <a
            href="#pipeline-section"
            className="px-4 py-2 rounded-lg text-muted hover:text-toxic hover:bg-surface transition-colors"
          >
            Experiments
          </a>
          <a
            href="#join-lab-section"
            className="px-4 py-2 rounded-lg text-muted hover:text-toxic hover:bg-surface transition-colors"
          >
            Community
          </a>
        </nav>

        {/* Right: CONNECT Button (Hard Flat Toxic Theme) */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleConnectClick}
            className="h-10 sm:h-11 px-3 sm:px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans text-xs sm:text-sm font-black uppercase tracking-wide inline-flex items-center gap-1.5 sm:gap-2 transition-colors cursor-pointer"
          >
            <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
            <span>{connected ? shortAddress : 'CONNECT'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
