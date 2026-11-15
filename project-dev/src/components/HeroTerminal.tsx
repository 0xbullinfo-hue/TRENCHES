'use client';

import React from 'react';
import Image from 'next/image';
import { BUY_LINKS, BUY_LOCK, SOCIAL_LINKS } from '@/lib/config';
import { LaunchLockedButton } from '@/components/LaunchLockedButton';
import { HeroLedgerProof } from '@/components/landing/HeroLedgerProof';
import { ArrowUpRight, Send, ShieldCheck } from 'lucide-react';

const TRUST_METRICS = [
  {
    label: 'Access',
    value: 'Hold or stake',
    sub: 'Hold $20 of $H42 for Member, or stake $250 for Pro.',
  },
  {
    label: 'Each call',
    value: 'Entry · risk · take-profit',
    sub: 'Curated research with structured stop-loss and take-profit levels.',
  },
  {
    label: 'Coverage',
    value: '6 chains',
    sub: 'SOL · BSC · ETH · BASE · ROBIN · AVAX',
  },
  {
    label: 'Execution',
    value: 'Non-custodial',
    sub: 'You make and execute every trade.',
  },
];

function XIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export const HeroTerminal: React.FC = () => {
  const communityUrl = process.env.NEXT_PUBLIC_COMMUNITY_TG_URL?.trim() || SOCIAL_LINKS.telegram;

  return (
    <section
      id="hero-section"
      className="relative border-b border-brand-border bg-canvas overflow-hidden scroll-mt-20 sm:scroll-mt-24"
    >
      <div className="relative z-10 max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 sm:pt-12 pb-14">
        {/* Soft-Launch Status Strip */}
        <div className="mb-6 flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface border border-border-default font-mono text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-amber" />
            <span className="text-muted">TOKEN:</span>
            <span className="text-amber">LIVE SOON</span>
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface border border-border-default font-mono text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-brand" />
            <span className="text-muted">COMMUNITY:</span>
            <span className="text-white">OPEN</span>
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface border border-border-default font-mono text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-amber" />
            <span className="text-muted">DASHBOARD:</span>
            <span className="text-amber">COMING SOON</span>
          </div>
        </div>

        {/* Main Aligned 12-Column Hero Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 lg:items-center">
          {/* Left Column (6 cols): Headline + Subtext + Soft-Launch CTAs */}
          <div className="lg:col-span-6 flex flex-col justify-between space-y-5 sm:space-y-6 min-w-0">
            <h1 className="font-sans font-semibold tracking-tight text-white text-3xl sm:text-5xl lg:text-6xl leading-[1.08] text-balance break-words">
              A grassroots research lab for{' '}
              <span className="text-brand whitespace-nowrap">on-chain</span> communities.
            </h1>

            <p className="font-sans text-sm sm:text-lg lg:text-xl font-medium text-muted leading-relaxed">
              Building, experimenting, and shipping together. TrenchLabs HQ is the lab — the platform. The GENESIS (<span className="text-brand-bright font-bold">$H42</span>) is your access key. TrenchLabs is a research and trading-intelligence platform. Holding GENESIS ($H42) unlocks membership tiers and tools.
            </p>

            {/* Primary Soft-Launch Conversion Unit */}
            <div className="w-full space-y-3 pt-2">
              <div>
                <a
                  href={communityUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full h-12 sm:h-[54px] px-6 rounded-lg bg-brand hover:bg-brand-bright text-canvas font-sans font-black text-sm sm:text-base tracking-wide uppercase flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Send className="w-4 h-4 fill-current" />
                  <span>JOIN THE SOFT LAUNCH</span>
                  <ArrowUpRight className="w-5 h-5 stroke-[2.5]" />
                </a>
                <p className="font-sans text-xs text-muted text-center pt-2">
                  Get early access updates, launch announcements and community access.
                </p>
              </div>

              {/* Secondary Actions: FOLLOW ON X + VIEW $H42 */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <a
                  href={SOCIAL_LINKS.x}
                  target="_blank"
                  rel="noreferrer"
                  className="h-12 min-h-[44px] px-3 sm:px-4 rounded-lg bg-surface hover:bg-surface-card border border-border-default hover:border-brand text-white font-sans font-bold text-xs sm:text-sm uppercase tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <XIcon className="w-4 h-4 text-brand shrink-0" />
                  <span>FOLLOW ON X</span>
                </a>

                {BUY_LOCK ? (
                  <LaunchLockedButton className="h-12 min-h-[44px] px-3 sm:px-4 rounded-lg font-sans font-bold text-xs sm:text-sm uppercase tracking-wide flex items-center justify-center gap-2">
                    <span className="text-muted">⚡</span>
                    <span>VIEW $H42</span>
                  </LaunchLockedButton>
                ) : (
                  <a
                    href={BUY_LINKS.pump}
                    target="_blank"
                    rel="noreferrer"
                    className="h-12 min-h-[44px] px-3 sm:px-4 rounded-lg bg-surface hover:bg-surface-card border border-border-default hover:border-brand text-white font-sans font-bold text-xs sm:text-sm uppercase tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <span className="text-brand">⚡</span>
                    <span>VIEW $H42</span>
                    <ArrowUpRight className="w-4 h-4 text-brand stroke-[2]" />
                  </a>
                )}
              </div>

              <HeroLedgerProof />
              <p className="font-sans text-[12px] leading-4 text-muted">
                Research only, not financial advice. You make every trade decision.
              </p>
            </div>
          </div>

          {/* Right Column (6 cols): Mascot Illustration */}
          <div className="lg:col-span-6 flex items-center justify-center w-full min-w-0">
            <div className="relative w-full max-w-[320px] xs:max-w-[380px] sm:max-w-[460px] lg:max-w-none flex items-center justify-center">
              <Image
                src="/images/trenchlabs-hero.webp"
                alt=""
                width={620}
                height={620}
                priority
                unoptimized
                className="relative z-10 w-full h-auto max-h-[320px] xs:max-h-[380px] sm:max-h-[460px] lg:max-h-[560px] xl:max-h-[620px] object-contain block select-none"
              />
            </div>
          </div>
        </div>

        {/* 4 Aligned Information Cards */}
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {TRUST_METRICS.map((m) => (
            <div
              key={m.label}
              className="p-5 sm:p-6 rounded-xl bg-surface border border-border-default flex flex-col justify-between gap-3 min-h-[140px]"
            >
              <div className="font-sans text-sm font-medium text-muted">{m.label}</div>
              <div className="font-sans text-lg sm:text-xl font-semibold tracking-tight text-white">{m.value}</div>
              <div className="font-sans text-sm text-muted leading-snug">{m.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
