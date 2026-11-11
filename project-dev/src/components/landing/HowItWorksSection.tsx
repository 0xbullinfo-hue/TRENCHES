'use client';

import React from 'react';
import { Compass, LineChart, ShieldCheck, Users } from 'lucide-react';

const STAGES = [
  {
    step: '01',
    title: 'DISCOVER',
    icon: Compass,
    description:
      'Discover curated Alpha Calls and early setups across 6 supported networks (SOL, BSC, ETH, BASE, ROBIN, AVAX) vetted for community members.',
  },
  {
    step: '02',
    title: 'ANALYSE',
    icon: LineChart,
    description:
      'Review entry market caps, risk ratings (1–5), structured stop losses, and take-profit targets with clear technical parameters before taking any action.',
  },
  {
    step: '03',
    title: 'TRACK',
    icon: ShieldCheck,
    description:
      'Monitor market movement, real-time data freshness, and historical outcomes logged transparently on the verified performance ledger.',
  },
  {
    step: '04',
    title: 'PARTICIPATE',
    icon: Users,
    description:
      'Join community activities, submit proof for Social Raids to earn airdrops, and unlock tier-based research privileges via $GENESIS.',
  },
];

export const HowItWorksSection: React.FC = () => {
  return (
    <section id="how-it-works" className="border-b border-toxic-border bg-canvas py-16">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Section Header */}
        <div className="pb-6 border-b border-toxic-border">
          <span className="font-sans text-xs font-bold uppercase tracking-widest text-toxic">
            PLATFORM ARCHITECTURE
          </span>
          <h2 className="font-sans text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-white mt-1">
            HOW THE LAB WORKS
          </h2>
          <p className="font-sans text-sm sm:text-base text-muted mt-1.5 max-w-2xl">
            A structured, non-custodial intelligence workflow designed to help members navigate fast-moving crypto trenches.
          </p>
        </div>

        {/* 4 Process Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {STAGES.map((stage) => {
            const Icon = stage.icon;
            return (
              <div
                key={stage.step}
                className="rounded-xl bg-surface border border-border-default hover:border-toxic transition-all duration-150 p-6 flex flex-col justify-between min-h-[220px]"
              >
                <div>
                  <div className="flex items-center justify-between pb-4 mb-4 border-b border-border-default">
                    <span className="font-mono text-2xl font-black text-toxic tracking-tight">
                      {stage.step}
                    </span>
                    <div className="w-9 h-9 rounded-lg bg-surface-card border border-border-default flex items-center justify-center text-muted">
                      <Icon className="w-4 h-4 text-toxic" />
                    </div>
                  </div>
                  <h3 className="font-sans text-base font-extrabold text-white uppercase tracking-wider mb-2">
                    {stage.title}
                  </h3>
                  <p className="font-sans text-xs sm:text-sm text-muted leading-relaxed">
                    {stage.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

