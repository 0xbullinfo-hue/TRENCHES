'use client';

import React from 'react';
import { LockedTerminal } from '@/components/LockedTerminal';
import { IncubatorHub } from '@/components/dashboard/IncubatorHub';
import { DashboardLedgerEmbed } from '@/components/ledger/DashboardLedgerEmbed';
import { StakePointCardClient } from '@/components/staking/StakePointCardClient';
import { useGenesisBalance } from '@/context/GenesisContext';
import { PUBLIC_DASHBOARD_ENABLED } from '@/lib/config';

export default function DashboardPage() {
  const { connected, isAdmin } = useGenesisBalance();
  const canAccessDashboard = connected && (PUBLIC_DASHBOARD_ENABLED || isAdmin);

  return (
    <section id="terminal" className="flex-1 py-6 bg-canvas">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        {!canAccessDashboard ? (
          <div className="py-8 space-y-6">
            {/* Soft-Launch / Wallet Authentication Gate: Zero alpha/raid cards shown to ordinary public visitors */}
            <LockedTerminal />
            <div className="max-w-2xl mx-auto">
              <StakePointCardClient />
            </div>
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
