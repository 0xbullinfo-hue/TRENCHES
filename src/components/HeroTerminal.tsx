'use client';

import React from 'react';
import { BUY_LINKS } from '@/lib/config';
import { ArrowUpRight, Send } from 'lucide-react';

const TRUST_METRICS = [
  {
    label: 'ALPHA CALLS',
    value: '1+',
    sub: 'DISTRIBUTED ACROSS INCUBATED LAUNCHES',
    highlight: true,
  },
  {
    label: 'AVG EARLY MULTIPLIER',
    value: '34.8x',
    sub: 'MEAN PEAK PROFIT FOR $GENESIS HOLDERS',
    highlight: true,
  },
  {
    label: 'CHAINS MONITORED',
    value: 'ALL CHAIN',
    sub: 'TRENCHES HAVE NO CHAIN',
    highlight: false,
  },
  {
    label: 'CURATION RATIO',
    value: '< 2% OF APPLICANTS',
    sub: 'PRIVATE SYNDICATE VETTED',
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
        {/* Main Aligned 12-Column Hero Grid — Bottom-Aligned (items-end) so Hero Image Bottom matches X Button Bottom */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 lg:items-end">
          {/* Left Column (6 cols): Display Headline + Subtext + Buy Button + 2 Social Buttons */}
          <div className="lg:col-span-6 flex flex-col justify-between space-y-6">
            <h1 className="font-display uppercase text-white text-5xl sm:text-7xl lg:text-[86px] leading-[0.94] tracking-[0.015em]">
              <span className="block">THE STRONGEST</span>
              <span className="block">COMMUNITY IN THE</span>
              <span className="block text-toxic">TRENCHES</span>
            </h1>

            <p className="font-sans text-base sm:text-lg lg:text-xl font-medium text-muted leading-relaxed">
              Building, experimenting, and shipping together. A multi-chain lab running live
              experiments — <span className="text-toxic-bright font-bold">$GENESIS</span> is
              the incubator token, <span className="text-white font-bold">TRENCHLABS</span>{' '}
              is the incubator. We don&apos;t chase chains, we chase trenches. If
              there&apos;s a trench, we&apos;re in it.
            </p>

            {/* Primary Buy Button (Pump.fun) + 2 Community Buttons Underneath (Hard Flat Toxic Theme) */}
            <div className="w-full space-y-3 pt-2">
              <a
                href={BUY_LINKS.pump}
                target="_blank"
                rel="noreferrer"
                className="w-full h-14 px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-base tracking-wide uppercase flex items-center justify-center gap-2.5 transition-colors"
              >
                <span>BUY $GENESIS ON PUMP.FUN</span>
                <ArrowUpRight className="w-5 h-5 stroke-[2.5]" />
              </a>

              <div className="grid grid-cols-2 gap-3">
                <a
                  href="https://t.me/TrenchLabsHQ"
                  target="_blank"
                  rel="noreferrer"
                  className="h-12 px-4 rounded-lg bg-surface hover:bg-surface-card border border-toxic-border hover:border-toxic text-white font-sans font-bold text-sm flex items-center justify-center gap-2 transition-colors"
                >
                  <Send className="w-4 h-4 text-toxic" />
                  <span>JOIN TELEGRAM</span>
                </a>

                <a
                  href="https://x.com/Trenchlabshq"
                  target="_blank"
                  rel="noreferrer"
                  className="h-12 px-4 rounded-lg bg-surface hover:bg-surface-card border border-toxic-border hover:border-toxic text-white font-sans font-bold text-sm flex items-center justify-center gap-2 transition-colors"
                >
                  <XIcon className="w-4 h-4 text-toxic" />
                  <span>FOLLOW ON X</span>
                </a>
              </div>
            </div>
          </div>

          {/* Right Column (6 cols): Transparent Cutout Hero Rat Image Bottom-Aligned Flush With the X Button */}
          <div className="lg:col-span-6 flex items-end justify-center">
            <div className="relative w-full flex items-end">
              <img
                src="/images/trenchlabs-hero-removebg.png"
                alt="TrenchLabs Rat Scientist holding toxic green Erlenmeyer flask"
                className="w-full h-auto max-h-[500px] object-contain object-bottom block select-none"
              />
            </div>
          </div>
        </div>

        {/* 4 Aligned Metric Cards (Hard Flat 1px Structure, Zero Glow) */}
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {TRUST_METRICS.map((m) => (
            <div
              key={m.label}
              className="p-6 rounded-xl bg-surface border border-toxic-border hover:border-toxic transition-colors flex flex-col justify-between gap-2"
            >
              <div className="font-sans text-xs font-bold text-muted uppercase tracking-wider">
                {m.label}
              </div>
              <div
                className={`font-sans text-3xl sm:text-4xl font-extrabold tnum tracking-tight ${
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
