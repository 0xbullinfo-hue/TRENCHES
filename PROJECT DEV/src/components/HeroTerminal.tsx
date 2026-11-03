'use client';

import React from 'react';
import { BUY_LINKS, SOCIAL_LINKS } from '@/lib/config';
import { ArrowUpRight, Send } from 'lucide-react';

const TRUST_METRICS = [
  {
    label: 'ACCESS REQUIREMENT',
    value: '1,000,000',
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
        {/* Main Aligned 12-Column Hero Grid — Bottom-Aligned (items-end) so Hero Image Bottom matches X Button Bottom */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 lg:items-end">
          {/* Left Column (6 cols): Display Headline + Subtext + Buy Button + 2 Social Buttons */}
          <div className="lg:col-span-6 flex flex-col justify-between space-y-6">
            <h1 className="font-display uppercase text-white text-4xl sm:text-6xl md:text-7xl lg:text-[80px] xl:text-[86px] leading-[0.94] tracking-[0.015em]">
              <span className="block">BUILDING THE STRONGEST</span>
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
                  href={SOCIAL_LINKS.telegram}
                  target="_blank"
                  rel="noreferrer"
                  className="h-12 px-4 rounded-lg bg-surface hover:bg-surface-card border border-toxic-border hover:border-toxic text-white font-sans font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Send className="w-4 h-4 text-toxic" />
                  <span>JOIN THE LAB</span>
                </a>

                <a
                  href={SOCIAL_LINKS.x}
                  target="_blank"
                  rel="noreferrer"
                  className="h-12 px-4 rounded-lg bg-surface hover:bg-surface-card border border-toxic-border hover:border-toxic text-white font-sans font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <XIcon className="w-4 h-4 text-toxic" />
                  <span>FOLLOW ON X</span>
                </a>
              </div>
            </div>
          </div>

          {/* Right Column (6 cols): Transparent Cutout Hero Rat Image with Toxic Beaker Green Glow Effect (Theme Emerald/Mint #34D399) */}
          <div className="lg:col-span-6 flex items-end justify-center">
            <div className="relative w-full flex items-end justify-center">
              {/* Radioactive Beaker Toxic Glow Behind Hero Image */}
              <div
                aria-hidden="true"
                className="absolute inset-0 max-w-[480px] mx-auto rounded-full pointer-events-none"
                style={{
                  background:
                    'radial-gradient(circle at 55% 55%, rgba(52, 211, 153, 0.48) 0%, rgba(110, 231, 183, 0.28) 35%, rgba(16, 185, 129, 0.12) 60%, transparent 75%)',
                  filter: 'blur(55px)',
                  transform: 'scale(0.98)',
                }}
              />
              <img
                src="/images/trenchlabs-hero-removebg.png"
                alt="TrenchLabs Rat Scientist holding toxic green Erlenmeyer flask"
                className="relative z-10 w-full h-auto max-h-[500px] object-contain object-bottom block select-none drop-shadow-[0_0_32px_rgba(52,211,153,0.55)] drop-shadow-[0_0_75px_rgba(52,211,153,0.28)]"
              />
            </div>
          </div>
        </div>

        {/* 4 Aligned Metric Cards (Matches Screenshot 2) */}
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {TRUST_METRICS.map((m) => (
            <div
              key={m.label}
              className="p-6 rounded-2xl bg-surface border border-toxic-border hover:border-toxic transition-colors flex flex-col justify-between gap-3 min-h-[140px]"
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
