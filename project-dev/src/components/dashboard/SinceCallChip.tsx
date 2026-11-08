import React from 'react';

/**
 * Tiny "x since call" chip: current market cap / market cap at the time of the call.
 * Renders nothing when either figure is missing, so it never shows a made-up number.
 */
export function SinceCallChip({ current, entry }: { current?: number; entry?: number }) {
  if (!current || !entry || !Number.isFinite(current) || !Number.isFinite(entry) || entry <= 0) {
    return null;
  }
  const x = current / entry;
  const label = `${x >= 10 ? x.toFixed(0) : x.toFixed(2)}x since call`;
  const up = x >= 1;
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border font-mono tnum text-[10px] font-bold uppercase ${
        up ? 'text-pump bg-toxic-bg border-toxic-border' : 'text-danger bg-surface-card border-line'
      }`}
      title="Current market cap divided by market cap at the time of the call"
    >
      {label}
    </span>
  );
}
