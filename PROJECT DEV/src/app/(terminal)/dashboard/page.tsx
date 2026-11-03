'use client';

import React from 'react';
import { LockedTerminal } from '@/components/LockedTerminal';
import { IncubatorHub } from '@/components/dashboard/IncubatorHub';
import { useGenesisBalance } from '@/context/GenesisContext';
import { ADMIN_WALLET_SHORT, GENESIS_MINT_SHORT } from '@/lib/config';

export default function DashboardPage() {
  const { connected, isUnlocked, isAdmin, formattedBalance } = useGenesisBalance();

  return (
    <section id="terminal" className="flex-1 py-6 bg-canvas">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8">
        {/* Clean Dashboard Status Bar (Zero Glow) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 mb-5 border-b border-line">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-sans text-xs text-pump uppercase tracking-wider font-bold">
              ALPHA TRADE CALLS DASHBOARD
            </span>
            <span className="text-dim">•</span>
            <span className="font-sans text-xs text-muted">
              Gate Contract:{' '}
              <strong className="font-mono text-pump-pill">{GENESIS_MINT_SHORT}</strong>
            </span>
            <span className="text-dim">•</span>
            <span className="font-sans text-xs text-muted">
              Admin:{' '}
              <strong className="font-mono text-white">{ADMIN_WALLET_SHORT}</strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-sans text-xs tnum">
            <span className="px-3 py-1 rounded-md bg-surface border border-line text-muted">
              Wallet Balance:{' '}
              <strong className={isUnlocked ? 'text-pump' : 'text-danger'}>
                {connected ? `${formattedBalance} $GENESIS` : 'Disconnected'}
              </strong>
            </span>

            <span
              className={`px-3 py-1 rounded-md border font-bold ${
                isAdmin
                  ? 'bg-pump text-canvas border-pump'
                  : isUnlocked
                  ? 'bg-surface border-line text-pump'
                  : 'bg-danger/10 border-danger/40 text-danger'
              }`}
            >
              {!connected
                ? 'Wallet Disconnected'
                : isAdmin
                ? 'Master Admin (Full Access)'
                : isUnlocked
                ? 'Lab Member (1M+ Verified)'
                : 'Locked (1M $GENESIS Required)'}
            </span>
          </div>
        </div>

        {!isUnlocked ? (
          <div className="py-8">
            <LockedTerminal />
          </div>
        ) : (
          <IncubatorHub />
        )}
      </div>
    </section>
  );
}

