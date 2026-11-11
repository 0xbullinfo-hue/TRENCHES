'use client';

import React from 'react';
import { IncubatorHub } from '@/components/dashboard/IncubatorHub';
import { DashboardLedgerEmbed } from '@/components/ledger/DashboardLedgerEmbed';
import { StakePointCardClient } from '@/components/staking/StakePointCardClient';

export default function DashboardPage() {
  return (
    <section id="terminal" className="flex-1 py-6 bg-canvas">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Unified 4-tab dashboard terminal for all membership tiers */}
        <IncubatorHub />

        <div className="max-w-2xl mx-auto pt-4">
          <StakePointCardClient />
        </div>

        {/* Historical Verified Multipliers Ledger */}
        <DashboardLedgerEmbed />
      </div>
    </section>
  );
}
