'use client';

import React, { useState } from 'react';
import { truncateAddress } from '@/lib/ledger/format';
import { Copy, Check } from 'lucide-react';

interface CopyableCAProps {
  address: string;
}

export function CopyableCA({ address }: CopyableCAProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard error
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 bg-neutral-950/70 border border-neutral-800/80 rounded px-2.5 py-1.5 font-mono text-xs">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-muted text-[10px] uppercase font-bold tracking-wider select-none shrink-0">
          CA
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-neutral-300 hover:text-white truncate text-left cursor-pointer transition-colors focus-visible:outline-none"
          title={`Click to copy full CA: ${address}`}
        >
          {truncateAddress(address)}
        </button>
      </div>

      <button
        type="button"
        onClick={handleCopy}
        className="text-muted hover:text-white shrink-0 p-1 rounded hover:bg-neutral-800 transition-colors cursor-pointer"
        title="Copy full address"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
}
