'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BUY_LINKS, GENESIS_MINT, SOCIAL_LINKS, SOLSCAN } from '@/lib/config';
import { HexCubeLogo } from '@/components/HexCubeLogo';
import { ArrowUp, ArrowUpRight } from 'lucide-react';

export const Footer: React.FC = () => {
  const pathname = usePathname();
  const isHomePage = pathname === '/';
  const communityUrl = process.env.NEXT_PUBLIC_COMMUNITY_TG_URL?.trim() || SOCIAL_LINKS.telegram;

  const handleBackToTop = (e: React.MouseEvent) => {
    if (isHomePage) {
      e.preventDefault();
      const el = document.getElementById('hero-section');
      if (el) {
        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth' });
        window.history.pushState(null, '', '#hero-section');
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  };

  return (
    <footer className="w-full bg-canvas border-t border-border-default font-sans text-xs text-muted mt-auto">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16 space-y-10">
        {/* Multi-Column Technical Structure */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-8 lg:gap-10">
          {/* Brand (4 cols) */}
          <div className="lg:col-span-4 space-y-4">
            <Link href="/" className="flex items-center gap-2.5">
              <HexCubeLogo />
              <span className="font-sans font-extrabold tracking-tight text-xl text-white">
                Trench<span className="text-toxic">Labs</span>HQ
              </span>
            </Link>
            <p className="font-sans text-xs text-muted leading-relaxed max-w-sm">
              The premier crypto intelligence terminal in the trenches. Multi-chain curation, disciplined take-profit milestones, and community reward campaigns.
            </p>
            <div className="flex items-center gap-2 font-mono text-[11px] text-muted">
              <span className="w-2 h-2 rounded-full bg-toxic" />
              <span>Token: $GENESIS • Solana Native</span>
            </div>
          </div>

          {/* Platform (3 cols) */}
          <div className="lg:col-span-3 space-y-3">
            <div className="font-sans text-xs font-bold uppercase tracking-wider text-white">
              PLATFORM
            </div>
            <ul className="space-y-2">
              <li>
                <Link href="/#hero-section" className="hover:text-toxic transition-colors">
                  Home
                </Link>
              </li>
              <li>
                <Link href="/#how-it-works" className="hover:text-toxic transition-colors">
                  How The Lab Works
                </Link>
              </li>
              <li>
                <Link href="/#pipeline-section" className="hover:text-toxic transition-colors">
                  Incubator Pipeline
                </Link>
              </li>
              <li>
                <Link href="/#choose-your-access" className="hover:text-toxic transition-colors">
                  Membership Tiers
                </Link>
              </li>
              <li>
                <Link href="/ledger" className="hover:text-toxic transition-colors inline-flex items-center gap-1">
                  <span>Performance Ledger</span>
                  <ArrowUpRight className="w-3 h-3 text-toxic" />
                </Link>
              </li>
            </ul>
          </div>

          {/* Community (2 cols) */}
          <div className="lg:col-span-2 space-y-3">
            <div className="font-sans text-xs font-bold uppercase tracking-wider text-white">
              COMMUNITY
            </div>
            <ul className="space-y-2">
              <li>
                <a
                  href={communityUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-toxic transition-colors inline-flex items-center gap-1"
                >
                  <span>Telegram</span>
                  <ArrowUpRight className="w-3 h-3 text-muted" />
                </a>
              </li>
              <li>
                <a
                  href={SOCIAL_LINKS.x}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-toxic transition-colors inline-flex items-center gap-1"
                >
                  <span>X (Twitter)</span>
                  <ArrowUpRight className="w-3 h-3 text-muted" />
                </a>
              </li>
            </ul>
          </div>

          {/* Resources & Contracts (3 cols) */}
          <div className="lg:col-span-3 space-y-3">
            <div className="font-sans text-xs font-bold uppercase tracking-wider text-white">
              RESOURCES
            </div>
            <ul className="space-y-2">
              <li>
                <a
                  href={BUY_LINKS.pump}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-toxic transition-colors inline-flex items-center gap-1"
                >
                  <span>Buy on Pump.fun</span>
                  <ArrowUpRight className="w-3 h-3 text-toxic" />
                </a>
              </li>
              <li>
                <a
                  href={SOLSCAN.token(GENESIS_MINT)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-toxic transition-colors inline-flex items-center gap-1"
                >
                  <span>Solscan SPL Explorer</span>
                  <ArrowUpRight className="w-3 h-3 text-muted" />
                </a>
              </li>
              <li>
                <Link href="/dashboard" className="hover:text-toxic transition-colors">
                  Terminal Login
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Legal & Risk Disclosures (Section 3.10) */}
        <div className="pt-8 border-t border-border-default/60 space-y-3">
          <div className="font-sans text-[11px] font-bold uppercase tracking-wider text-muted">
            LEGAL &amp; RISK DISCLOSURE
          </div>
          <p className="font-sans text-[11px] text-muted/80 leading-relaxed">
            TrenchLabsHQ is an experimental crypto research and intelligence incubator. All information, trade signals, risk parameters, and take-profit milestones provided on this platform or associated community channels are strictly for educational and informational purposes. TrenchLabs does not execute trades, manage funds, or provide personalized financial or investment advice. Trading digital assets involves severe risk of loss. Always conduct independent research (DYOR) and never trade capital you cannot afford to lose.
          </p>
        </div>

        {/* Bottom Copyright & Back to Top Row */}
        <div className="pt-6 border-t border-border-default/40 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-toxic" />
            <span className="text-white font-medium">
              TrenchLabsHQ © 2026 — Built in the Trenches. All rights reserved.
            </span>
          </div>

          <Link
            href={isHomePage ? '#hero-section' : '/#hero-section'}
            onClick={handleBackToTop}
            className="inline-flex items-center gap-1 text-muted hover:text-toxic font-bold uppercase transition-colors"
          >
            <span>BACK TO TOP</span>
            <ArrowUp className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </footer>
  );
};
