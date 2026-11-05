'use client';

import React from 'react';
import { LockedTerminal } from '@/components/LockedTerminal';
import { IncubatorHub } from '@/components/dashboard/IncubatorHub';
import { DashboardLedgerEmbed } from '@/components/ledger/DashboardLedgerEmbed';
import { useGenesisBalance } from '@/context/GenesisContext';

export default function DashboardPage() {
  const { connected } = useGenesisBalance();

  return (
    <section id="terminal" className="flex-1 py-6 bg-canvas">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        {!connected ? (
          <div className="py-8">
            <LockedTerminal />
          </div>
        ) : (
          /* Incubator Terminal (Contains Disclaimer, Welcome Card, Staking Card below Welcome Card, and Alpha Calls) */
          <IncubatorHub />
        )}

        {/* Performance Ledger Card Grid Embed (Only in user dashboard) */}
        <DashboardLedgerEmbed />
      </div>
    </section>
  );
}

