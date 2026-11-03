'use client';

import React, { useEffect } from 'react';
import { HexCubeLogo } from '@/components/HexCubeLogo';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log unexpected errors for telemetry
    console.error('TrenchLabs App Error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full rounded-2xl bg-surface border border-toxic-border p-8 space-y-5">
        <div className="flex justify-center">
          <HexCubeLogo size={42} />
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-danger/10 border border-danger/30 text-danger font-mono text-xs font-bold uppercase">
          <AlertTriangle className="w-4 h-4" />
          <span>TELEMETRY SYNC INTERRUPTED</span>
        </div>

        <h2 className="font-sans font-extrabold text-xl text-white">
          Temporary Network Desync
        </h2>

        <p className="font-sans text-xs text-muted leading-relaxed">
          The lab interface encountered a temporary connection glitch. You can safely retry or reload the page.
        </p>

        <button
          type="button"
          onClick={() => reset()}
          className="w-full h-11 px-5 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
        >
          <RefreshCw className="w-4 h-4 stroke-[2.5]" />
          <span>RETRY CONNECTION</span>
        </button>
      </div>
    </div>
  );
}
