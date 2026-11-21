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
      <div className="relative z-10 max-w-xl w-full text-center space-y-6">
        {/* Brand Logo */}
        <div className="flex items-center justify-center gap-3">
          <HexCubeLogo size={44} />
          <span className="font-sans font-extrabold text-2xl sm:text-3xl tracking-tight text-white">
            Trench<span className="text-brand">Labs</span>HQ
          </span>
        </div>

        {/* Maintenance Box */}
        <div className="rounded bg-surface border border-brand-border p-6 sm:p-8 space-y-5 shadow-none">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-brand-bg border border-brand-border text-brand font-mono text-xs font-bold uppercase tracking-wider">
            <ShieldAlert className="w-4 h-4 text-brand" />
            <span>{MAINTENANCE_CONFIG.title}</span>
          </div>

          <h1 className="font-sans font-black text-2xl sm:text-3xl text-white uppercase tracking-tight">
            {MAINTENANCE_CONFIG.headline}
          </h1>

          <p className="font-sans text-sm text-muted leading-relaxed">
            {MAINTENANCE_CONFIG.message}
          </p>

          <div className="pt-2 flex items-center justify-center gap-2 font-mono text-xs text-brand">
            <Clock className="w-3.5 h-3.5 text-brand" />
            <span>ESTIMATED DURATION: {MAINTENANCE_CONFIG.estimatedDuration}</span>
          </div>

          {/* Social Update Channels */}
          <div className="pt-3 border-t border-brand-border/60 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href={SOCIAL_LINKS.telegram}
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto h-11 px-5 rounded-lg bg-brand hover:bg-brand-bright text-canvas font-sans font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
            >
              <Send className="w-4 h-4 stroke-[2.5]" />
              <span>LIVE TELEGRAM ALERTS</span>
              <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
            </a>

            <a
              href={SOCIAL_LINKS.x}
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto h-11 px-5 rounded-lg bg-surface-card hover:bg-surface-3 border border-brand-border hover:border-brand text-white font-sans font-bold text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
            >
              <XIcon className="w-4 h-4 text-brand" />
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

