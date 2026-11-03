'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LockedTerminal } from '@/components/LockedTerminal';
import { IncubatorHub } from '@/components/dashboard/IncubatorHub';
import { useGenesisBalance } from '@/context/GenesisContext';

export default function DashboardPage() {
  const router = useRouter();
  const { connected, isUnlocked } = useGenesisBalance();

  useEffect(() => {
    if (!connected) {
      router.replace('/');
    }
  }, [connected, router]);

  // If not connected, redirect to landing immediately (never show dashboard)
  if (!connected) {
    return null;
  }

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

