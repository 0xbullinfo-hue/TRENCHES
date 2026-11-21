'use client';

import { memo } from 'react';
import { formatUnits } from '@/lib/math/tokenMath';

type TabularValueProps = {
  value: bigint | number | string | null | undefined;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  showSign?: boolean;
  className?: string;
};

function formatBigInt(value: bigint, decimals: number): string {
  const safeDecimals =
    Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : 0;
  return formatUnits(value, safeDecimals, {
    maxFractionDigits: safeDecimals,
    trimTrailingZeros: true,
  });
}

function formatNumber(value: number, decimals: number): string {
  const safeDecimals = Number.isInteger(decimals) && decimals >= 0 ? decimals : 0;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: safeDecimals,
    maximumFractionDigits: safeDecimals,
  });
}

/** Renders numeric, bigint, or string values with tabular numerals. */
export const TabularValue = memo(function TabularValue({
  value,
  decimals = 4,
  prefix = '',
  suffix = '',
  showSign = false,
  className = '',
}: TabularValueProps) {
  let text = '—';
  let sign = '';
  if (value !== null && value !== undefined) {
    if (typeof value === 'bigint') {
      text = formatBigInt(value, decimals);
      sign = showSign && value > 0n ? '+' : '';
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      text = formatNumber(value, decimals);
      sign = showSign && value > 0 ? '+' : '';
    } else if (typeof value === 'string') {
      text = value;
    }
  }

  return (
    <span
      className={`tabular-nums ${className}`}
      style={{ fontVariantNumeric: 'tabular-nums' }}
      aria-label={`${prefix}${sign}${text}${suffix}`}
    >
      {prefix}
      {sign}
      {text}
      {suffix}
    </span>
  );
});
