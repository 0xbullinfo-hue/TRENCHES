'use client';

import React from 'react';
import { LockedTerminal } from '@/components/LockedTerminal';
import { IncubatorHub } from '@/components/dashboard/IncubatorHub';
import { useGenesisBalance } from '@/context/GenesisContext';

export default function DashboardPage() {
  const { isUnlocked } = useGenesisBalance();

  return (
    <section id="terminal" className="flex-1 py-6 bg-canvas">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8">
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
