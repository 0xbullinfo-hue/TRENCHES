'use client';

import React from 'react';
import { formatUsd } from '@/lib/stake/format';

interface CurrentStakeCardProps {
  amountUsd: number;
  unlocksAt: string | null;
  daysRemaining: number;
  status: 'active' | 'expired' | 'none';
  onStakeAdditional?: () => void;
  showStakeAdditionalLink?: boolean;
}

export function CurrentStakeCard({
  amountUsd,
  unlocksAt,
  daysRemaining,
  status,
  onStakeAdditional,
  showStakeAdditionalLink = false,
}: CurrentStakeCardProps) {
  const formattedDate = unlocksAt
    ? new Date(unlocksAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    <div className="rounded-xl bg-surface border border-border-default p-6 shadow-none space-y-2">
      <div className="font-sans text-xs font-bold uppercase tracking-wider text-muted">
        CURRENT STAKE
      </div>
      <div className="font-sans text-3xl font-extrabold text-white tracking-tight tnum">
        {formatUsd(amountUsd)}
      </div>

      {status === 'active' && formattedDate ? (
        <div className="space-y-2 pt-1">
          <p className="font-sans text-sm text-toxic font-medium leading-relaxed">
            Your Pro access is active until {formattedDate}. {daysRemaining} days remaining.
          </p>
          {showStakeAdditionalLink && onStakeAdditional && (
            <button
              onClick={onStakeAdditional}
              type="button"
              className="font-sans text-xs text-muted hover:text-toxic underline underline-offset-4 transition-colors"
            >
              Stake additional $GENESIS →
            </button>
          )}
        </div>
      ) : (
        <p className="font-sans text-sm text-muted">No active stake</p>
      )}
    </div>
  );
}

