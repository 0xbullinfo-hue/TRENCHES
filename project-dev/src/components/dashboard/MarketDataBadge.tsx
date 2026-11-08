import React from 'react';
import type { AlphaItem } from '@/lib/types';

type BadgeItem = Pick<AlphaItem, 'dataFreshness' | 'marketDataSource' | 'lastPriceUpdated'>;

const SOURCE_LABEL: Record<string, string> = {
  COINSTATS: 'CoinStats',
  DEXSCREENER: 'DexScreener',
  RECORDED: 'Recorded at call time',
};

const TONE: Record<string, string> = {
  LIVE: 'text-pump border-pump/40',
  CACHED: 'text-pump border-line',
  STALE: 'text-amber border-amber/40',
  UNAVAILABLE: 'text-danger border-danger/40',
  MANUAL: 'text-muted border-line',
};

/** "+12%", "-8%", or "—" when there is no trustworthy provider value. Never "0%" for missing data. */
export function formatChangePct(pct: number | null | undefined): string {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return '—';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`;
}

/** Sort comparator: highest 24h change first; calls without a provider value always sort last. */
export function compareChangeDesc(a: Pick<AlphaItem, 'change24hPct'>, b: Pick<AlphaItem, 'change24hPct'>): number {
  const x = a.change24hPct ?? Number.NEGATIVE_INFINITY;
  const y = b.change24hPct ?? Number.NEGATIVE_INFINITY;
  if (x === y) return 0;
  return y > x ? 1 : -1;
}

function updatedAt(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function describe(item: BadgeItem): { label: string; title: string } | null {
  const status = item.dataFreshness;
  if (!status) return null;
  const source = item.marketDataSource ? SOURCE_LABEL[item.marketDataSource] : null;
  const time = updatedAt(item.lastPriceUpdated);

  switch (status) {
    case 'LIVE':
      return { label: `LIVE${source ? ` · ${source}` : ''}`, title: `Live provider data${time ? `, updated ${time}` : ''}.` };
    case 'CACHED':
      return {
        label: `CACHED${source ? ` · ${source}` : ''}`,
        title: `Recently cached provider data${time ? ` from ${time}` : ''}.`,
      };
    case 'STALE':
      return {
        label: `STALE${time ? ` · ${time}` : ''}`,
        title: `Providers are failing. Showing older data${source ? ` from ${source}` : ''}${time ? ` (${time})` : ''}.`,
      };
    case 'UNAVAILABLE':
      return {
        label: 'UNAVAILABLE',
        title: 'Market data providers are unavailable. Live telemetry could not be retrieved.',
      };
    case 'MANUAL':
      return {
        label: 'MANUAL',
        title: 'No market data provider covers this call. Values were entered by the administrator.',
      };
    default:
      return null;
  }
}

/** Small status pill that tells the user where a market-data number came from. */
export const MarketDataBadge: React.FC<{ item: BadgeItem }> = ({ item }) => {
  const info = describe(item);
  if (!info || !item.dataFreshness) return null;
  return (
    <span
      title={info.title}
      className={`px-1.5 py-0.5 rounded border bg-surface-card font-mono text-[10px] font-bold uppercase ${TONE[item.dataFreshness]}`}
    >
      {info.label}
    </span>
  );
};
