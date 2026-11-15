import type { AlphaItem } from '@/lib/types';

export type GenesisProvenanceBadgeItem = Pick<
  AlphaItem,
  'dataFreshness' | 'marketDataSource' | 'lastPriceUpdated'
>;

export interface GenesisThresholdProvenanceInput {
  twap_source?: string | null;
  stale?: boolean | null;
  recalculated_at?: string | null;
}

/**
 * Converts threshold/stake price metadata from `/api/stake/status` or `getTierThresholds()`
 * into the `BadgeItem` shape consumed by the shared `<MarketDataBadge />` component.
 */
export function toGenesisProvenanceItem(
  input?: GenesisThresholdProvenanceInput | null
): GenesisProvenanceBadgeItem {
  if (!input) {
    return {
      dataFreshness: 'CACHED',
      marketDataSource: 'DEXSCREENER',
    };
  }

  const rawSource = (input.twap_source || '').toLowerCase();
  const marketDataSource: GenesisProvenanceBadgeItem['marketDataSource'] =
    rawSource === 'coinstats'
      ? 'COINSTATS'
      : rawSource === 'dexscreener' || rawSource === 'jupiter' || rawSource === 'cached'
      ? 'DEXSCREENER'
      : null;

  let dataFreshness: GenesisProvenanceBadgeItem['dataFreshness'];
  if (rawSource === 'unavailable') {
    dataFreshness = 'UNAVAILABLE';
  } else if (input.stale) {
    dataFreshness = 'STALE';
  } else if (rawSource === 'cached') {
    dataFreshness = 'CACHED';
  } else {
    dataFreshness = 'LIVE';
  }

  return {
    dataFreshness,
    marketDataSource,
    lastPriceUpdated: input.recalculated_at || undefined,
  };
}
