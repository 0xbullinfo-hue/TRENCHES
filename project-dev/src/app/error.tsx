'use client';

import React, { useEffect } from 'react';
import { HexCubeLogo } from '@/components/HexCubeLogo';
import { Button } from '@/components/ui/Button';
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
      <div className="max-w-md w-full rounded-xl bg-surface border border-brand-border p-8 space-y-5">
        <div className="flex justify-center">
          <HexCubeLogo size={42} />
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-danger/10 border border-danger/30 text-danger font-mono text-xs font-bold">
          <AlertTriangle className="w-4 h-4" />
          <span>Error</span>
        </div>

        <h2 className="font-sans font-extrabold text-xl text-white">
          Something went wrong
        </h2>

        <p className="font-sans text-xs text-muted leading-relaxed">
          The application encountered an unexpected error. Your data is safe — retry or reload the page.
        </p>

        <Button
          variant="primary"
          size="md"
          onClick={() => reset()}
          className="w-full h-11 px-5 text-xs font-black gap-2"
        >
          <RefreshCw className="w-4 h-4 stroke-[2.5]" />
          <span>Retry connection</span>
        </Button>
      </div>
    </div>
  );
}

