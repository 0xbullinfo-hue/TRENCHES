import { GENESIS_MINT } from '@/lib/config';
import { getMarketData } from '@/server/market-data';

export interface GenesisPriceResult {
  priceUsd: number;
  source: 'coinstats' | 'jupiter' | 'dexscreener' | 'cached' | 'fallback' | 'unavailable';
  timestamp: string;
  isFresh: boolean;
  error?: string;
}

// Fallback baseline price if no external oracles are reachable ($0.0000164)
export const FALLBACK_GENESIS_PRICE = 0.0000164;

// Cache settings
const PRICE_CACHE_TTL_MS = 60_000; // 1 minute fresh TTL
const PRICE_CACHE_MAX_AGE_MS = 15 * 60_000; // 15 minutes acceptable stale limit

interface CachedPrice {
  priceUsd: number;
  source: 'coinstats' | 'jupiter' | 'dexscreener';
  fetchedAt: number;
}

let lastGoodPrice: CachedPrice | null = null;
let lastFailedLookupAt = 0;
const FAILED_LOOKUP_COOLDOWN_MS = 60_000;

async function fetchFromJupiter(mint: string, timeoutMs = 3500): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: ctrl.signal,
    });

    if (!res.ok) return null;
    const json = await res.json();
    const priceStr = json?.data?.[mint]?.price;
    if (priceStr && Number.isFinite(Number(priceStr)) && Number(priceStr) > 0) {
      return Number(priceStr);
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retrieves the live, verified USD price of $GENESIS from trusted oracles:
 * 1. Central market-data service (CoinStats when enabled -> DexScreener with chain+baseToken validation -> shared Redis/memory cache).
 * 2. Jupiter Price API v2 fallback.
 * 3. Bounded stale cache -> explicit fallback baseline.
 */
export async function getGenesisPrice(): Promise<GenesisPriceResult> {
  const now = Date.now();

  // 1. Check in-memory fresh cache
  if (lastGoodPrice && now - lastGoodPrice.fetchedAt < PRICE_CACHE_TTL_MS) {
    return {
      priceUsd: lastGoodPrice.priceUsd,
      source: 'cached',
      timestamp: new Date(lastGoodPrice.fetchedAt).toISOString(),
      isFresh: true,
    };
  }

  // Avoid repeatedly blocking page renders when the configured mint is not yet indexed by external oracles
  if (!lastGoodPrice && lastFailedLookupAt > 0 && now - lastFailedLookupAt < FAILED_LOOKUP_COOLDOWN_MS) {
    return {
      priceUsd: FALLBACK_GENESIS_PRICE,
      source: 'fallback',
      timestamp: new Date(lastFailedLookupAt).toISOString(),
      isFresh: false,
      error: 'All price oracles unavailable; using fallback baseline',
    };
  }

  // 2. Try central market-data service (CoinStats optional primary -> DexScreener validated fallback -> shared cache)
  try {
    const md = await getMarketData({ chain: 'SOL', contractAddress: GENESIS_MINT });
    if (md.price !== null && Number.isFinite(md.price) && md.price > 0) {
      const origin: 'coinstats' | 'dexscreener' =
        md.originProvider === 'COINSTATS' ? 'coinstats' : 'dexscreener';
      const isFresh = md.status === 'LIVE' || md.status === 'CACHED';
      const fetchedAtMs = md.fetchedAt ? Date.parse(md.fetchedAt) : now;
      if (isFresh) {
        lastGoodPrice = {
          priceUsd: md.price,
          source: origin,
          fetchedAt: Number.isNaN(fetchedAtMs) ? now : fetchedAtMs,
        };
      }
      return {
        priceUsd: md.price,
        source: md.status === 'LIVE' ? origin : 'cached',
        timestamp: md.fetchedAt ?? new Date(now).toISOString(),
        isFresh,
        ...(isFresh ? {} : { error: 'Using stale shared market-data cache' }),
      };
    }
  } catch {
    // Proceed to Jupiter oracle fallback
  }

  // 3. Try Jupiter oracle
  const jupPrice = await fetchFromJupiter(GENESIS_MINT);
  if (jupPrice !== null) {
    lastGoodPrice = {
      priceUsd: jupPrice,
      source: 'jupiter',
      fetchedAt: now,
    };
    return {
      priceUsd: jupPrice,
      source: 'jupiter',
      timestamp: new Date(now).toISOString(),
      isFresh: true,
    };
  }

  // 4. Stale cache fallback if within acceptable max age (15 min)
  if (lastGoodPrice && now - lastGoodPrice.fetchedAt < PRICE_CACHE_MAX_AGE_MS) {
    return {
      priceUsd: lastGoodPrice.priceUsd,
      source: 'cached',
      timestamp: new Date(lastGoodPrice.fetchedAt).toISOString(),
      isFresh: false,
      error: 'Using cached price past fresh TTL due to oracle timeout',
    };
  }

  // 5. Emergency fallback (explicitly marked not fresh)
  lastFailedLookupAt = now;
  return {
    priceUsd: FALLBACK_GENESIS_PRICE,
    source: 'fallback',
    timestamp: new Date(now).toISOString(),
    isFresh: false,
    error: 'All price oracles unavailable; using fallback baseline',
  };
}
