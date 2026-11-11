'use client';

import React from 'react';
import { Target, Shield, Activity, Info } from 'lucide-react';

export const AlphaIntelligencePreview: React.FC = () => {
  return (
    <section id="alpha-intelligence" className="border-b border-toxic-border bg-canvas py-16">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Section Header */}
        <div className="pb-6 border-b border-toxic-border">
          <span className="font-sans text-xs font-bold uppercase tracking-widest text-alpha-primary">
            INTELLIGENCE TELEMETRY
          </span>
          <h2 className="font-sans text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-white mt-1">
            WHAT INSIDE AN ALPHA CALL LOOKS LIKE
          </h2>
          <p className="font-sans text-sm sm:text-base text-muted mt-1.5 max-w-2xl">
            Every trade call published by TrenchLabs contains structured risk and execution parameters so members trade with clarity.
          </p>
        </div>

        {/* 2-Column Showcase: Breakdown Explanations on Left, Representative Card on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left: Key Dimensions List */}
          <div className="lg:col-span-6 space-y-4">
            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-surface border border-border-default space-y-1">
                <div className="flex items-center gap-2 text-alpha-primary font-mono text-xs font-bold uppercase">
                  <Target className="w-4 h-4" />
                  <span>Entry &amp; Target Valuation</span>
                </div>
                <p className="font-sans text-xs text-muted leading-relaxed">
                  Clear Entry Market Cap recorded at call time, paired with mathematical Take-Profit multipliers (2x, 5x, 10x) and target market caps.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-surface border border-border-default space-y-1">
                <div className="flex items-center gap-2 text-toxic font-mono text-xs font-bold uppercase">
                  <Shield className="w-4 h-4" />
                  <span>Risk Parameter &amp; Invalidation (SL)</span>
                </div>
                <p className="font-sans text-xs text-muted leading-relaxed">
                  Standardized Risk Level (1 to 5), calculated 1:4 Risk:Reward ratio, and exact invalidation stop-loss percentage (-25% SL) to protect capital.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-surface border border-border-default space-y-1">
                <div className="flex items-center gap-2 text-white font-mono text-xs font-bold uppercase">
                  <Activity className="w-4 h-4 text-toxic" />
                  <span>Verified Contract Address &amp; Provider Freshness</span>
                </div>
                <p className="font-sans text-xs text-muted leading-relaxed">
                  Single-click verified Contract Address copy, direct links to DexScreener/Photon charts, and explicit LIVE / CACHED / UNAVAILABLE telemetry badges.
                </p>
              </div>
            </div>
          </div>

          {/* Right: Representative Visual Card (Explicitly labeled as Illustrative Example) */}
          <div className="lg:col-span-6">
            <div className="relative rounded-2xl bg-surface border-2 border-alpha-border p-6 shadow-none space-y-5">
              {/* Illustrative Example Header Strip */}
              <div className="flex items-center justify-between pb-3 border-b border-border-default">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-md bg-alpha-bg border border-alpha-border text-alpha-text font-mono text-xs font-bold">
                    ILLUSTRATIVE EXAMPLE
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-surface-card border border-border-default text-white font-mono text-[10px] font-bold">
                    SOL CHAIN
                  </span>
                </div>
                <span className="font-mono text-[10px] text-muted bg-surface-card px-2 py-0.5 rounded border border-border-default uppercase">
                  SAMPLE ANATOMY
                </span>
              </div>

              {/* Token Info */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-sans font-black text-xl text-white">
                    SYNTHETIC LAB PROTOCOL <span className="text-alpha-primary font-mono text-base">($SAMPLE)</span>
                  </h3>
                  <p className="font-sans text-xs text-muted mt-0.5">
                    Illustrative early-stage token model • Standardized Call Anatomy
                  </p>
                </div>
                <div className="text-right font-mono">
                  <div className="text-[10px] text-muted uppercase font-bold">ENTRY MC</div>
                  <div className="text-base font-black text-white">$400K</div>
                </div>
              </div>

              {/* 2x2 Parameters: Mathematically Consistent (25% risk vs 100% gain = 1:4 R:R) */}
              <div className="grid grid-cols-2 gap-2.5 font-mono text-xs">
                <div className="p-3 rounded-lg bg-surface-card border border-border-default space-y-1">
                  <div className="text-[10px] text-muted uppercase font-bold">RISK RATING</div>
                  <div className="text-white font-bold">Level 2 / 5 <span className="text-alpha-primary text-[11px]">(1:4 R:R)</span></div>
                </div>

                <div className="p-3 rounded-lg bg-surface-card border border-border-default space-y-1">
                  <div className="text-[10px] text-muted uppercase font-bold">STOP LOSS (SL)</div>
                  <div className="text-amber font-extrabold">-25% SL ($300K MC)</div>
                </div>

                <div className="p-3 rounded-lg bg-surface-card border border-border-default space-y-1">
                  <div className="text-[10px] text-muted uppercase font-bold">TARGET 1 &amp; 2</div>
                  <div className="text-toxic font-bold">2x ($800K) • 5x ($2.0M)</div>
                </div>

                <div className="p-3 rounded-lg bg-surface-card border border-border-default space-y-1">
                  <div className="text-[10px] text-muted uppercase font-bold">TARGET 3</div>
                  <div className="text-toxic-bright font-black">10x ($4.0M MC)</div>
                </div>
              </div>

              {/* CA Row */}
              <div className="px-3 py-2 rounded-lg bg-surface-card border border-border-default flex items-center justify-between font-mono text-xs">
                <span className="text-muted text-[11px]">CA: SAMPLE1111111111111111111111111111111111111</span>
                <span className="text-alpha-primary text-[11px] font-bold">FORMAT SPEC</span>
              </div>

              {/* Bottom Notice */}
              <div className="pt-2 flex items-center gap-2 text-[11px] font-sans text-muted">
                <Info className="w-3.5 h-3.5 text-muted shrink-0" />
                <span>Illustrative call anatomy representation. Not live advice or active recommendations.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
