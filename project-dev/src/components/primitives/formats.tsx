'use client';

import { TOKEN_DECIMALS } from '@/lib/config';
import { directionOf, semantic } from '@/lib/theme/semantic';
import { TabularValue } from './TabularValue';

export function TokenPrice({
  value,
  decimals = TOKEN_DECIMALS,
}: {
  value: bigint | number | string | null | undefined;
  decimals?: number;
}) {
  return <TabularValue value={value} decimals={decimals} prefix="$" />;
}

export function TokenAmount({
  value,
  decimals = TOKEN_DECIMALS,
  compact = false,
}: {
  value: bigint | number | string | null | undefined;
  decimals?: number;
  compact?: boolean;
}) {
  return (
    <TabularValue
      value={value}
      decimals={compact ? 2 : decimals}
      suffix=" $H42"
    />
  );
}

export function UsdAmount({ value }: { value: bigint | number | string | null | undefined }) {
  return <TabularValue value={value} decimals={2} prefix="$" />;
}

export function PnlPercent({ value }: { value: number }) {
  const dir = directionOf(value);
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '•';
  return (
    <span className={`tabular-nums ${semantic.pnlClass(value)}`}>
      {arrow}{' '}
      <TabularValue value={value} decimals={2} showSign suffix="%" />
    </span>
  );
}

export function WalletAddress({ value }: { value: string }) {
  if (!value || value.length < 10) {
    return <span className="font-mono">{value}</span>;
  }
  return (
    <span className="font-mono text-muted">
      {value.slice(0, 4)}…{value.slice(-4)}
    </span>
  );
}

export function CountValue({
  value,
  suffix = '',
}: {
  value: bigint | number | string | null | undefined;
  suffix?: string;
}) {
  return <TabularValue value={value} decimals={0} suffix={suffix} />;
}

export function PercentValue({
  value,
  decimals = 0,
  showSign = false,
}: {
  value: bigint | number | string | null | undefined;
  decimals?: number;
  showSign?: boolean;
}) {
  return <TabularValue value={value} decimals={decimals} showSign={showSign} suffix="%" />;
}

export function MetricText({
  value,
  decimals,
}: {
  value: bigint | number | string | null | undefined;
  decimals?: number;
}) {
  return <TabularValue value={value} decimals={decimals} />;
}
