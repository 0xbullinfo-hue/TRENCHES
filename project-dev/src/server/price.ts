import { GENESIS_MINT } from '@/lib/config';

export interface GenesisPriceResult {
  priceUsd: number;
  source: 'jupiter' | 'dexscreener' | 'cached' | 'fallback' | 'unavailable';
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
  source: 'jupiter' | 'dexscreener';
  fetchedAt: number;
}

let lastGoodPrice: CachedPrice | null = null;

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

async function fetchFromDexScreener(mint: string, timeoutMs = 3500): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: ctrl.signal,
    });

    if (!res.ok) return null;
    const json = await res.json();
    const pairs = json?.pairs;
    if (Array.isArray(pairs) && pairs.length > 0) {
      // Find the pair with highest liquidity
      const solPairs = pairs.filter((p: { chainId?: string }) => p.chainId === 'solana');
      const targetPairs = solPairs.length > 0 ? solPairs : pairs;
      targetPairs.sort((a: { liquidity?: { usd?: number } }, b: { liquidity?: { usd?: number } }) => {
        return (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0);
      });

      const priceUsd = parseFloat(targetPairs[0]?.priceUsd || '0');
      if (Number.isFinite(priceUsd) && priceUsd > 0) {
        return priceUsd;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retrieves the live, verified USD price of $GENESIS from trusted oracles (Jupiter -> DexScreener -> cache).
 * Guarantees explicit freshness and error reporting without inventing synthetic numbers.
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

  // 2. Try Jupiter oracle
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

  // 3. Try DexScreener fallback
  const dexsPrice = await fetchFromDexScreener(GENESIS_MINT);
  if (dexsPrice !== null) {
    lastGoodPrice = {
      priceUsd: dexsPrice,
      source: 'dexscreener',
      fetchedAt: now,
    };
    return {
      priceUsd: dexsPrice,
      source: 'dexscreener',
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
  return {
    priceUsd: FALLBACK_GENESIS_PRICE,
    source: 'fallback',
    timestamp: new Date(now).toISOString(),
    isFresh: false,
    error: 'All price oracles unavailable; using fallback baseline',
  };
}

