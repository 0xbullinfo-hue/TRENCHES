import React from 'react';
import { formatMultiplier } from '@/lib/ledger/format';

interface MultiplierBlockProps {
  multiplier: string | number;
}

export function MultiplierBlock({ multiplier }: MultiplierBlockProps) {
  const num = typeof multiplier === 'number' ? multiplier : Number(multiplier);
  const isPositiveReturn = num >= 1.0;

  return (
    <div className="h-20 flex flex-col justify-center rounded-lg bg-surface p-3.5 border border-toxic-border/40">
      <div
        className={`font-sans text-2xl sm:text-3xl font-black tracking-tight tnum ${
          isPositiveReturn ? 'text-toxic' : 'text-muted'
        }`}
      >
        {formatMultiplier(num)}
      </div>
      <div className="font-sans text-[10px] font-bold text-muted uppercase tracking-wider mt-0.5">
        Multiplier
      </div>
    </div>
  );
}

