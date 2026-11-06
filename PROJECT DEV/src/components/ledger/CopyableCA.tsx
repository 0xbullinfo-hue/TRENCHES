'use client';

import React, { useState } from 'react';
import { truncateAddress } from '@/lib/ledger/format';
import { Copy, Check } from 'lucide-react';

interface CopyableCAProps {
  address: string;
}

export function CopyableCA({ address }: CopyableCAProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setCopyError(false);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError(true);
      setTimeout(() => setCopyError(false), 2500);
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 bg-canvas/80 border border-toxic-border/40 hover:border-toxic-border rounded-lg px-3 py-2 font-mono text-xs transition-colors">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-muted text-[10px] uppercase font-bold tracking-wider select-none shrink-0">
          CA
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-white hover:text-toxic truncate text-left cursor-pointer transition-colors focus-visible:outline-none"
          title={`Click to copy full CA: ${address}`}
        >
          {truncateAddress(address)}
        </button>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {copyError && (
          <span className="text-2xs text-rose-400 font-sans font-bold">Copy failed</span>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="text-muted hover:text-toxic shrink-0 p-1 rounded transition-colors cursor-pointer"
          title="Copy full address"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-toxic" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

