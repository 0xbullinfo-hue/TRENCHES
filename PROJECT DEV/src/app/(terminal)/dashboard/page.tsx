'use client';

import React from 'react';
import { LockedTerminal } from '@/components/LockedTerminal';
import { IncubatorHub } from '@/components/dashboard/IncubatorHub';
import { DashboardStakingCard } from '@/components/stake/DashboardStakingCard';
import { DashboardLedgerEmbed } from '@/components/ledger/DashboardLedgerEmbed';
import { useGenesisBalance } from '@/context/GenesisContext';

export default function DashboardPage() {
  const { isUnlocked } = useGenesisBalance();

  return (
    <section id="terminal" className="flex-1 py-6 bg-canvas">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Feature 3 — Dashboard Staking Card (§4) */}
        <DashboardStakingCard />

        {!isUnlocked ? (
          <div className="py-8">
            <LockedTerminal />
          </div>
        ) : (
          /* Main Incubator Terminal Alpha Calls */
          <IncubatorHub />
        )}

        {/* Feature 2 — Public Ledger Card Grid Embed (§3) */}
        <DashboardLedgerEmbed />
      </div>
    </section>
  );
}

