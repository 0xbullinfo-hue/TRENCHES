'use client';

import React from 'react';
import Image from 'next/image';
import { BUY_LINKS, SOCIAL_LINKS } from '@/lib/config';
import { ArrowUpRight, Send, ShieldCheck } from 'lucide-react';

const TRUST_METRICS = [
  {
    label: 'MEMBER ACCESS',
    value: 'HOLD OR STAKE',
    sub: 'HOLD ~$20 OR STAKE $250 FOR ACCESS',
    highlight: true,
  },
  {
    label: 'TRADE INTELLIGENCE',
    value: 'ENTRY · RISK · TP',
    sub: 'CURATED RESEARCH WITH STRUCTURED SL/TP',
    highlight: true,
  },
  {
    label: 'MULTI-CHAIN COVERAGE',
    value: '6 CHAINS',
    sub: 'SOL · BSC · ETH · BASE · ROBIN · AVAX',
    highlight: false,
  },
  {
    label: 'NON-CUSTODIAL EXECUTION',
    value: 'INDEPENDENT',
    sub: 'YOU CONTROL & EXECUTE EVERY TRADE',
    highlight: false,
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
      className="relative border-b border-toxic-border bg-canvas overflow-hidden scroll-mt-20 sm:scroll-mt-24"
    >
      <div className="relative z-10 max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 sm:pt-12 pb-14">
        {/* Soft-Launch Status Strip */}
        <div className="mb-6 flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface border border-border-default font-mono text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-toxic" />
            <span className="text-muted">TOKEN:</span>
            <span className="text-white">LIVE</span>
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface border border-border-default font-mono text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-toxic" />
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
            <h1 className="font-display uppercase text-white text-3xl xs:text-4xl sm:text-6xl md:text-7xl lg:text-[74px] xl:text-[82px] leading-[0.96] tracking-[0.015em] break-words">
              <span className="block">BUILDING THE STRONGEST</span>
              <span className="block">COMMUNITY IN THE</span>
              <span className="block text-toxic">TRENCHES</span>
            </h1>

            <p className="font-sans text-sm sm:text-lg lg:text-xl font-medium text-muted leading-relaxed">
              Building, experimenting, and shipping together. A multi-chain lab running live
              experiments — <span className="text-toxic-bright font-bold">$GENESIS</span> is
              the incubator token, <span className="text-white font-bold">TRENCHLABS</span>{' '}
              is the incubator. We don&apos;t chase chains, we chase trenches. If
              there&apos;s a trench, we&apos;re in it.
            </p>

            {/* Primary Soft-Launch Conversion Unit */}
            <div className="w-full space-y-3 pt-2">
              <div>
                <a
                  href={communityUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full h-12 sm:h-[54px] px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-sm sm:text-base tracking-wide uppercase flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Send className="w-4 h-4 fill-current" />
                  <span>JOIN THE SOFT LAUNCH</span>
                  <ArrowUpRight className="w-5 h-5 stroke-[2.5]" />
                </a>
                <p className="font-sans text-xs text-muted text-center pt-2">
                  Get early access updates, launch announcements and community access.
                </p>
              </div>

              {/* Secondary Actions: FOLLOW ON X + VIEW $GENESIS */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <a
                  href={SOCIAL_LINKS.x}
                  target="_blank"
                  rel="noreferrer"
                  className="h-12 min-h-[44px] px-3 sm:px-4 rounded-lg bg-surface hover:bg-surface-card border border-border-default hover:border-toxic text-white font-sans font-bold text-xs sm:text-sm uppercase tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <XIcon className="w-4 h-4 text-toxic shrink-0" />
                  <span>FOLLOW ON X</span>
                </a>

                <a
                  href={BUY_LINKS.pump}
                  target="_blank"
                  rel="noreferrer"
                  className="h-12 min-h-[44px] px-3 sm:px-4 rounded-lg bg-surface hover:bg-surface-card border border-border-default hover:border-toxic text-white font-sans font-bold text-xs sm:text-sm uppercase tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <span className="text-toxic">⚡</span>
                  <span>VIEW $GENESIS</span>
                  <ArrowUpRight className="w-4 h-4 text-toxic stroke-[2]" />
                </a>
              </div>
            </div>
          </div>

          {/* Right Column (6 cols): Mascot Illustration */}
          <div className="lg:col-span-6 flex items-center justify-center w-full min-w-0">
            <div className="relative w-full max-w-[320px] xs:max-w-[380px] sm:max-w-[460px] lg:max-w-none flex items-center justify-center">
              <Image
                src="/images/trenchlabs-hero-removebg.png"
                alt="TrenchLabs Mascot"
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
              className="p-5 sm:p-6 rounded-xl bg-surface border border-border-default hover:border-toxic transition-colors flex flex-col justify-between gap-3 min-h-[140px]"
            >
              <div className="font-sans text-xs font-bold text-muted uppercase tracking-wider">
                {m.label}
              </div>
              <div
                className={`font-sans text-lg sm:text-xl xl:text-2xl font-semibold tracking-tight whitespace-nowrap ${
                  m.highlight ? 'text-toxic' : 'text-white'
                }`}
              >
                {m.value}
              </div>
              <div className="font-sans text-xs font-medium text-muted uppercase tracking-wide">
                {m.sub}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
