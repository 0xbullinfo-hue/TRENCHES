'use client';

import React from 'react';
import Image from 'next/image';
import { BUY_LINKS, SOCIAL_LINKS } from '@/lib/config';
import { ArrowUpRight, Send } from 'lucide-react';

const TRUST_METRICS = [
  {
    label: 'ACCESS REQUIREMENT',
    value: 'HOLD OR STAKE',
    sub: '$GENESIS REQUIRED FOR MEMBER ACCESS',
    highlight: true,
  },
  {
    label: 'CALL DETAILS',
    value: 'CA · RISK · TP',
    sub: 'TRADE SETUP INFORMATION IN EACH CALL',
    highlight: true,
  },
  {
    label: 'SUPPORTED NETWORKS',
    value: '6 CHAINS',
    sub: 'SOL · BNB · ETH · BASE · ROBIN · AVAX',
    highlight: false,
  },
  {
    label: 'EXECUTION',
    value: 'YOUR CHOICE',
    sub: 'INFORMATION ONLY — YOU CONTROL EVERY TRADE',
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
  return (
    <section
      id="hero-section"
      className="relative border-b border-toxic-border bg-canvas overflow-hidden"
    >
      <div className="relative z-10 max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 pt-10 sm:pt-14 pb-14">
        {/* Main Aligned 12-Column Hero Grid — Aligned with Full Height */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 lg:items-center">
          {/* Left Column (6 cols): Display Headline + Subtext + Buy Button + 2 Social Buttons */}
          <div className="lg:col-span-6 flex flex-col justify-between space-y-5 sm:space-y-6 min-w-0">
            <h1 className="font-display uppercase text-white text-3xl xs:text-4xl sm:text-6xl md:text-7xl lg:text-[76px] xl:text-[84px] leading-[0.96] tracking-[0.015em] break-words">
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

            {/* Primary Buy Button (Pump.fun) + 2 Community Buttons Underneath (Split 50/50, Same Size) */}
            <div className="w-full space-y-3 pt-2">
              <a
                href={BUY_LINKS.pump}
                target="_blank"
                rel="noreferrer"
                className="w-full h-12 sm:h-[52px] px-4 sm:px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-sm sm:text-base tracking-wide uppercase flex items-center justify-center gap-2.5 transition-colors"
              >
                <span>BUY $GENESIS ON PUMP.FUN</span>
                <ArrowUpRight className="w-5 h-5 stroke-[2.5]" />
              </a>

              <div className="grid grid-cols-2 gap-3">
                <a
                  href={SOCIAL_LINKS.telegram}
                  target="_blank"
                  rel="noreferrer"
                  className="h-12 sm:h-[52px] px-2 sm:px-4 rounded-lg bg-surface hover:bg-surface-card border border-border-default hover:border-toxic text-white font-sans font-bold text-xs sm:text-sm uppercase tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Send className="w-4 h-4 text-toxic shrink-0" />
                  <span>JOIN THE LAB</span>
                </a>

                <a
                  href={SOCIAL_LINKS.x}
                  target="_blank"
                  rel="noreferrer"
                  className="h-12 sm:h-[52px] px-2 sm:px-4 rounded-lg bg-surface hover:bg-surface-card border border-border-default hover:border-toxic text-white font-sans font-bold text-xs sm:text-sm uppercase tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <XIcon className="w-4 h-4 text-toxic shrink-0" />
                  <span>FOLLOW ON X</span>
                </a>
              </div>
            </div>
          </div>

          {/* Right Column (6 cols): Studio Clean Mascot filling the full hero zone */}
          <div className="lg:col-span-6 flex items-center justify-center w-full min-w-0">
            <div className="relative w-full max-w-[320px] xs:max-w-[380px] sm:max-w-[460px] lg:max-w-none flex items-center justify-center">
              <Image
                src="/images/trenchlabs-hero-removebg.png"
                alt="TrenchLabs Mascot"
                width={620}
                height={620}
                priority
                unoptimized
                className="relative z-10 w-full h-auto max-h-[320px] xs:max-h-[380px] sm:max-h-[460px] lg:max-h-[580px] xl:max-h-[630px] object-contain block select-none"
              />
            </div>
          </div>
        </div>

        {/* 4 Aligned Metric Cards */}
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
