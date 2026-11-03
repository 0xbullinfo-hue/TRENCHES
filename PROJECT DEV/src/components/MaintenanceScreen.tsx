'use client';

import React from 'react';
import { HexCubeLogo } from '@/components/HexCubeLogo';
import { MAINTENANCE_CONFIG, SOCIAL_LINKS } from '@/lib/config';
import { ArrowUpRight, Clock, Send, ShieldAlert } from 'lucide-react';

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

export const MaintenanceScreen: React.FC = () => {
  return (
    <div className="min-h-screen w-full bg-canvas flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      {/* Background Radial Glow */}
      <div
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{
          background:
            'radial-gradient(circle, rgba(52, 211, 153, 0.18) 0%, rgba(16, 185, 129, 0.06) 45%, transparent 70%)',
          filter: 'blur(60px)',
        }}
      />

      <div className="relative z-10 max-w-xl w-full text-center space-y-6">
        {/* Brand Logo */}
        <div className="flex items-center justify-center gap-3">
          <HexCubeLogo size={44} />
          <span className="font-sans font-extrabold text-2xl sm:text-3xl tracking-tight text-white">
            Trench<span className="text-toxic">Labs</span>HQ
          </span>
        </div>

        {/* Maintenance Box */}
        <div className="rounded-2xl bg-surface border border-toxic-border p-6 sm:p-8 space-y-5 shadow-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-toxic-bg border border-toxic-border text-toxic font-mono text-xs font-bold uppercase tracking-wider">
            <ShieldAlert className="w-4 h-4 text-toxic" />
            <span>{MAINTENANCE_CONFIG.title}</span>
          </div>

          <h1 className="font-sans font-black text-2xl sm:text-3xl text-white uppercase tracking-tight">
            {MAINTENANCE_CONFIG.headline}
          </h1>

          <p className="font-sans text-sm text-muted leading-relaxed">
            {MAINTENANCE_CONFIG.message}
          </p>

          <div className="pt-2 flex items-center justify-center gap-2 font-mono text-xs text-toxic">
            <Clock className="w-3.5 h-3.5 text-toxic" />
            <span>ESTIMATED DURATION: {MAINTENANCE_CONFIG.estimatedDuration}</span>
          </div>

          {/* Social Update Channels */}
          <div className="pt-3 border-t border-toxic-border/60 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href={SOCIAL_LINKS.telegram}
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto h-11 px-5 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Send className="w-4 h-4 stroke-[2.5]" />
              <span>LIVE TELEGRAM ALERTS</span>
              <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
            </a>

            <a
              href={SOCIAL_LINKS.x}
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto h-11 px-5 rounded-lg bg-surface-card hover:bg-surface-3 border border-toxic-border hover:border-toxic text-white font-sans font-bold text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors"
            >
              <XIcon className="w-4 h-4 text-toxic" />
              <span>UPDATES ON X</span>
            </a>
          </div>
        </div>

        <div className="text-center font-mono text-[11px] text-muted">
          TRENCHLABS INCUBATOR // SYSTEM TELEMETRY V2.0
        </div>
      </div>
    </div>
  );
};

