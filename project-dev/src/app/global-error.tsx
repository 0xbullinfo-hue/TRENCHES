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
    console.error('[TrenchLabs Global Error]:', error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <head>
        <style>{`
          :root {
            --ge-canvas: #0A0E13;
            --ge-surface: #11161D;
            --ge-border: #163A2D;
            --ge-text: #eaecef;
            --ge-muted: #848E9C;
            --ge-brand: #34D399;
            --ge-brand-hover: #6EE7B7;
            --ge-danger: #EF4444;
          }
          body {
            background-color: var(--ge-canvas);
            color: var(--ge-text);
          }
        `}</style>
      </head>
      <body className="font-mono min-h-screen flex flex-col items-center justify-center p-6 text-center antialiased">
        <div className="max-w-md w-full rounded-xl border border-[var(--ge-border)] bg-[var(--ge-surface)] p-8 space-y-5">
          <div className="flex justify-center">
            <HexCubeLogo size={42} />
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-[var(--ge-danger)]/10 border border-[var(--ge-danger)]/30 text-[var(--ge-danger)] text-xs font-bold">
            <AlertTriangle className="w-4 h-4" />
            <span>Error</span>
          </div>

          <h2 className="font-sans text-xl font-extrabold text-white">
            Something went wrong
          </h2>

          <p className="font-sans text-xs text-[var(--ge-muted)] leading-relaxed">
            The application encountered an unexpected error. Your data is safe — retry or reload the page.
          </p>

          <button
            type="button"
            onClick={() => reset()}
            className="w-full h-11 px-5 rounded-lg bg-[var(--ge-brand)] hover:bg-[var(--ge-brand-hover)] text-[#0A0E13] font-sans font-black text-xs inline-flex items-center justify-center gap-2 cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ge-brand)] focus-visible:outline-offset-2"
          >
            <RefreshCw className="w-4 h-4 stroke-[2.5]" />
            <span>Reset lab environment</span>
          </button>
        </div>
      </body>
    </html>
  );
}

