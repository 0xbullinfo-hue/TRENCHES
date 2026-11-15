'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Pure helper validating `stats.totalRecordedCalls`.
 * Returns formatted proof text when `total` is a finite positive integer/number, or `null` otherwise.
 */
export function formatProofLine(total: unknown): string | null {
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  return `${Math.floor(total)} calls recorded on the public ledger`;
}

interface LedgerStatsResponse {
  ok?: boolean;
  stats?: {
    totalRecordedCalls?: unknown;
  };
}

export const HeroLedgerProof: React.FC = () => {
  const [totalCalls, setTotalCalls] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 4000);

    fetch('/api/ledger/stats', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: LedgerStatsResponse | null) => {
        if (
          data &&
          data.ok === true &&
          data.stats &&
          typeof data.stats.totalRecordedCalls === 'number' &&
          Number.isFinite(data.stats.totalRecordedCalls) &&
          data.stats.totalRecordedCalls > 0
        ) {
          setTotalCalls(Math.floor(data.stats.totalRecordedCalls));
        }
      })
      .catch(() => {
        // Render nothing on loading, error, abort, zero or unexpected shape
      })
      .finally(() => {
        clearTimeout(timeoutId);
      });

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  const validLine = formatProofLine(totalCalls);

  return (
    <div className="min-h-[20px]">
      {validLine !== null && totalCalls !== null && (
        <Link
          href="/ledger"
          className="font-sans text-sm text-muted hover:text-white transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
        >
          <span className="tnum text-white">{totalCalls}</span> calls recorded on the public ledger
        </Link>
      )}
    </div>
  );
};
