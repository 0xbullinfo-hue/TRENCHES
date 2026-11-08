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
            {/* Wallet Authentication Required: Zero cards shown until visitor connects wallet */}
            <LockedTerminal />
          </div>
        ) : (
          /* Incubator Terminal:
             - Free signed-in users see Raid cards
             - Verified token holders see Raid cards + Call cards
             - Pro & Admin see Max Alpha cards + Raid cards + Call cards
          */
          <IncubatorHub />
        )}

        {/* Historical Verified Multipliers Ledger */}
        <DashboardLedgerEmbed />
      </div>
    </section>
  );
}
