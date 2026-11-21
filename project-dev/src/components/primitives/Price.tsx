import React from 'react';
import { TOKEN_DECIMALS } from '@/lib/config';
import { formatUnits } from '@/lib/math/tokenMath';
import { semantic } from '@/lib/theme/semantic';
import { cn } from '@/components/ui/cn';

export interface PriceProps {
  /** Human-readable numeric price/value. Ignored when `raw` is provided. */
  value?: number | null;
  /** Atomic token balance/amount formatted via exact `bigint` math. */
  raw?: bigint;
  /** Token decimals when formatting `raw` (defaults to `TOKEN_DECIMALS`). */
  decimals?: number;
  /** Optional percent or value delta for semantic coloring (`text-brand` / `text-danger`). */
  delta?: number | null;
  /** Prefix symbol such as `$` or `+`. */
  prefix?: string;
  /** Optional unit suffix such as `SOL` or `%`. */
  suffix?: string;
  /** Max fractional digits shown. */
  maxFractionDigits?: number;
  /** Placeholder when value is missing/non-finite. */
  fallback?: string;
  className?: string;
}

function formatFloatPrice(value: number, maxFractionDigits?: number): string {
  if (!Number.isFinite(value)) return '—';
  const digits =
    maxFractionDigits !== undefined
      ? maxFractionDigits
      : Math.abs(value) >= 1
        ? 2
        : Math.abs(value) >= 0.01
          ? 4
          : 6;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

/**
 * Tabular monospace price/delta display aligned to TrenchLabs design tokens.
 */
export function Price({
  value,
  raw,
  decimals = TOKEN_DECIMALS,
  delta,
  prefix = '',
  suffix = '',
  maxFractionDigits,
  fallback = '—',
  className,
}: PriceProps) {
  let rendered = fallback;

  if (raw !== undefined) {
    rendered = `${prefix}${formatUnits(raw, decimals, {
      maxFractionDigits: maxFractionDigits ?? decimals,
      trimTrailingZeros: true,
    })}${suffix ? ` ${suffix}` : ''}`;
  } else if (value !== null && value !== undefined && Number.isFinite(value)) {
    rendered = `${prefix}${formatFloatPrice(value, maxFractionDigits)}${suffix ? ` ${suffix}` : ''}`;
  }

  const toneClass = delta !== undefined ? semantic.pnlClass(delta) : 'text-ink';

  return (
    <span
      data-num="true"
      className={cn('tabular tnum font-mono inline-block whitespace-nowrap', toneClass, className)}
    >
      {rendered}
    </span>
  );
}
