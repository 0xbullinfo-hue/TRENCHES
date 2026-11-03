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
      <body className="bg-[#0A0E13] text-[#eaecef] font-mono min-h-screen flex flex-col items-center justify-center p-6 text-center antialiased">
        <div className="max-w-md w-full rounded border border-[#163A2D] bg-[#11161D] p-8 space-y-5">
          <div className="flex justify-center">
            <HexCubeLogo size={42} />
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#EF4444] text-xs font-bold uppercase">
            <AlertTriangle className="w-4 h-4" />
            <span>GLOBAL ROOT FAULT</span>
          </div>

          <h2 className="text-lg font-bold text-white uppercase tracking-tight">
            System Level Interrupt
          </h2>

          <p className="text-xs text-[#848E9C] leading-relaxed">
            A fatal boundary fault was intercepted. Reset to restore dashboard execution.
          </p>

          <button
            type="button"
            onClick={() => reset()}
            className="w-full h-11 px-5 rounded bg-[#34D399] hover:bg-[#6EE7B7] text-[#0A0E13] font-bold text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <RefreshCw className="w-4 h-4 stroke-[2.5]" />
            <span>RESET LAB ENVIRONMENT</span>
          </button>
        </div>
      </body>
    </html>
  );
}

