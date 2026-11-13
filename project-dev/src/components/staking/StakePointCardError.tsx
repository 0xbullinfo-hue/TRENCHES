'use client';

import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface StakePointCardErrorProps {
  onRetry?: () => void;
  errorMessage?: string;
}

export function StakePointCardError({ onRetry, errorMessage }: StakePointCardErrorProps) {
  const handleRetry = () => {
    if (onRetry) {
      onRetry();
    } else if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return (
    <div
      data-testid="stakepoint-error"
      className="rounded-xl bg-surface border border-line p-5 sm:p-6 flex flex-col justify-between h-full"
    >
      <div className="space-y-4">
        {/* Title */}
        <div className="flex items-center justify-between">
          <h3 className="font-sans text-base font-extrabold text-white uppercase tracking-tight">
            Staking — $H42
          </h3>
          <span className="text-2xs font-mono text-muted uppercase">STAKEPOINT</span>
        </div>

        {/* Error Notice */}
        <div className="rounded-lg bg-surface-card border border-danger/30 p-4 space-y-2">
          <div className="flex items-center gap-2 text-danger">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="font-sans text-xs font-bold uppercase tracking-wider">
              Data Connection Notice
            </span>
          </div>
          <p className="font-sans text-xs text-muted leading-relaxed">
            {"Couldn't load staking data."}{' '}
            <button
              type="button"
              onClick={handleRetry}
              className="text-pump hover:text-pump-hover underline font-bold cursor-pointer inline-flex items-center gap-1 ml-1"
            >
              <span>[Retry]</span>
            </button>
          </p>
          {errorMessage && (
            <p className="font-mono text-[10px] text-muted/70 truncate">{errorMessage}</p>
          )}
        </div>
      </div>

      <div className="pt-5 mt-auto">
        <button
          type="button"
          onClick={handleRetry}
          className="w-full sm:w-auto h-10 px-5 rounded-lg bg-surface-card hover:bg-surface-3 border border-line font-sans text-xs font-bold text-white inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5 text-pump" />
          <span>Retry Loading</span>
        </button>
      </div>
    </div>
  );
}
