import type { AlphaItem } from '@/lib/types';
import { formatCompactUsd } from '@/server/alphas-data';
import {
  CHAIN_TO_COINSTATS_SLUG,
  CHAIN_TO_DEX_SLUG,
  getMarketData,
  normalizeToken,
  type MarketToken,
  type NormalizedMarketData,
} from '@/server/market-data';

/** True when at least one provider can cover this chain + contract. */
export function isMarketDataSupported(chain: string, ca: string): boolean {
  const token = normalizeToken({ chain, contractAddress: ca });
  if (!token) return false;
  return CHAIN_TO_DEX_SLUG[token.chain] != null || CHAIN_TO_COINSTATS_SLUG[token.chain] != null;
}

/**
 * Projects validated market data onto an API item, so the UI can always tell where a number came from.
 *
 * - LIVE / CACHED / STALE: provider numbers. A metric the provider did not supply is shown as "—"/null,
 *   never as $0 or 0%.
 * - UNAVAILABLE: providers failed for a supported token. Current live telemetry (marketCap, volume24h,
 *   change24hPct) is reported as "—" / null (never presenting recorded entry MC as current live MC),
 *   while `entryMarketCap` remains preserved for historical reference.
 * - MANUAL: no provider can cover the call (no/invalid/unsupported contract) - admin-entered values only.
 */
export function applyMarketData(item: AlphaItem, data: NormalizedMarketData | null): AlphaItem {
  const entryMarketCap = item.entryMarketCap || item.marketCap || '—';
  const entryMarketCapUsd = item.entryMarketCapUsd || item.marketCapUsd || 0;
  const covered = Boolean(item.ca) && isMarketDataSupported(item.chain, item.ca as string);

  if (!data || data.status === 'UNAVAILABLE') {
    if (!covered) {
      return {
        ...item,
        entryMarketCap,
        entryMarketCapUsd,
        marketCap: item.marketCap || '—',
        volume24h: item.volume24h || '—',
        change24hPct: typeof item.change24hPct === 'number' && Number.isFinite(item.change24hPct) ? item.change24hPct : null,
        dataFreshness: 'MANUAL',
        marketDataSource: 'RECORDED',
        lastPriceUpdated: undefined,
      };
    }

    return {
      ...item,
      entryMarketCap,
      entryMarketCapUsd,
      marketCap: '—',
      marketCapUsd: 0,
      volume24h: '—',
      change24hPct: null,
      dataFreshness: 'UNAVAILABLE',
      marketDataSource: null,
      lastPriceUpdated: undefined,
    };
  }

  const hasMarketCap = typeof data.marketCap === 'number' && Number.isFinite(data.marketCap) && data.marketCap > 0;
  const hasVolume = typeof data.volume24h === 'number' && Number.isFinite(data.volume24h) && data.volume24h >= 0;

  return {
    ...item,
    entryMarketCap,
    entryMarketCapUsd,
    marketCapUsd: hasMarketCap ? (data.marketCap as number) : 0,
    marketCap: hasMarketCap ? formatCompactUsd(data.marketCap as number) : '—',
    volume24h: hasVolume ? (data.volume24h === 0 ? '$0' : formatCompactUsd(data.volume24h as number)) : '—',
    change24hPct: data.priceChange24h,
    logoUrl: item.logoUrl || data.imageUrl || undefined,
    dataFreshness: data.status,
    marketDataSource: data.originProvider,
    lastPriceUpdated: data.fetchedAt ?? undefined,
  };
}

/**
 * Hydrates a list of AlphaItems with validated market telemetry (CoinStats -> DexScreener -> Shared Cache -> UNAVAILABLE).
 * Used consistently across GET / POST / PATCH / DELETE /api/alphas and /api/alphas/fixture.
 */
export async function hydrateAlphaItems(
  items: AlphaItem[],
  lookup: (token: MarketToken) => Promise<NormalizedMarketData> = getMarketData
): Promise<AlphaItem[]> {
  return Promise.all(
    items.map(async (it) => {
      if (!it.ca || !isMarketDataSupported(it.chain, it.ca)) {
        return applyMarketData(it, null);
      }
      try {
        const telemetry = await lookup({ chain: it.chain, contractAddress: it.ca });
        return applyMarketData(it, telemetry);
      } catch {
        return applyMarketData(it, null);
      }
    })
  );
}
