import React from 'react';
import { formatMultiplier } from '@/lib/ledger/format';

interface MultiplierBlockProps {
  multiplier: string | number;
}

export function MultiplierBlock({ multiplier }: MultiplierBlockProps) {
  const num = typeof multiplier === 'number' ? multiplier : Number(multiplier);
  const isPositiveReturn = num >= 1.0;

  return (
    <div className="h-24 flex flex-col justify-center rounded-md bg-neutral-950 p-4 border border-neutral-800/80">
      <div
        className={`font-sans text-3xl sm:text-4xl font-extrabold tracking-tight tnum ${
          isPositiveReturn ? 'text-emerald-400' : 'text-neutral-400'
        }`}
      >
        {formatMultiplier(num)}
      </div>
      <div className="font-sans text-[10px] font-bold text-muted uppercase tracking-wider mt-0.5">
        multiplier
      </div>
    </div>
  );
}

