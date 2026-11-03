/**
 * Market Data Integration Service
 * Supports CoinStats API and DexScreener with server-side caching and fallback.
 */

interface CachedMarketPrice {
  priceUsd: number;
  marketCapUsd: number;
  change24hPct: number;
  volume24hUsd: number;
  fetchedAt: number;
  source: 'COINSTATS' | 'DEXSCREENER';
}

const priceCache = new Map<string, CachedMarketPrice>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

export interface TokenMarketTelemetry {
  marketCapUsd?: number;
  priceUsd?: number;
  change24hPct?: number;
  volume24hUsd?: number;
  source: 'COINSTATS' | 'DEXSCREENER' | 'FIXTURE';
  freshness: 'LIVE' | 'CACHED' | 'FIXTURE';
  updatedAt: string;
}

/**
 * Fetch token market cap and price from CoinStats if API key is provided
 */
async function fetchFromCoinStats(ca: string): Promise<CachedMarketPrice | null> {
  const apiKey = process.env.COINSTATS_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(`https://openapiv1.coinstats.app/coins/token/${encodeURIComponent(ca)}`, {
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json',
      },
      next: { revalidate: 60 },
    });

    if (!res.ok) return null;

    const data = await res.json();
    const coin = data?.coin || data;
    if (coin && typeof coin.marketCap === 'number') {
      return {
        priceUsd: Number(coin.price) || 0,
        marketCapUsd: Number(coin.marketCap) || 0,
        change24hPct: Number(coin.priceChange1d) || 0,
        volume24hUsd: Number(coin.volume) || 0,
        fetchedAt: Date.now(),
        source: 'COINSTATS',
      };
    }
  } catch {
    // Graceful fallback to next provider
  }
  return null;
}

/**
 * Fetch token market cap and price from DexScreener
 */
async function fetchFromDexScreener(ca: string): Promise<CachedMarketPrice | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(ca)}`,
      {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      }
    );
    clearTimeout(timeoutId);

    if (!res.ok) return null;

    const json = await res.json();
    const pair = json?.pairs?.[0];
    if (pair) {
      const mc = Number(pair.marketCap || pair.fdv || 0);
      const price = Number(pair.priceUsd || 0);
      const change24h = Number(pair.priceChange?.h24 || 0);
      const vol24h = Number(pair.volume?.h24 || 0);

      if (mc > 0) {
        return {
          priceUsd: price,
          marketCapUsd: mc,
          change24hPct: change24h,
          volume24hUsd: vol24h,
          fetchedAt: Date.now(),
          source: 'DEXSCREENER',
        };
      }
    }
  } catch {
    // Fail silently to fixture
  }
  return null;
}

/**
 * Retrieves market telemetry for a given token contract address.
 */
export async function getMarketTelemetry(
  ca: string | null | undefined,
  fallbackMcUsd: number,
  fallbackChange24h: number
): Promise<TokenMarketTelemetry> {
  if (!ca || ca.length < 8) {
    return {
      marketCapUsd: fallbackMcUsd,
      change24hPct: fallbackChange24h,
      source: 'FIXTURE',
      freshness: 'FIXTURE',
      updatedAt: new Date().toISOString(),
    };
  }

  const normalizedCa = ca.trim();
  const cached = priceCache.get(normalizedCa);

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      marketCapUsd: cached.marketCapUsd,
      priceUsd: cached.priceUsd,
      change24hPct: cached.change24hPct,
      volume24hUsd: cached.volume24hUsd,
      source: cached.source,
      freshness: 'CACHED',
      updatedAt: new Date(cached.fetchedAt).toISOString(),
    };
  }

  // 1. Try CoinStats
  let liveData = await fetchFromCoinStats(normalizedCa);

  // 2. Fallback to DexScreener
  if (!liveData) {
    liveData = await fetchFromDexScreener(normalizedCa);
  }

  if (liveData) {
    priceCache.set(normalizedCa, liveData);
    return {
      marketCapUsd: liveData.marketCapUsd,
      priceUsd: liveData.priceUsd,
      change24hPct: liveData.change24hPct,
      volume24hUsd: liveData.volume24hUsd,
      source: liveData.source,
      freshness: 'LIVE',
      updatedAt: new Date(liveData.fetchedAt).toISOString(),
    };
  }

  // Fallback to recorded fixture data
  return {
    marketCapUsd: fallbackMcUsd,
    change24hPct: fallbackChange24h,
    source: 'FIXTURE',
    freshness: 'FIXTURE',
    updatedAt: new Date().toISOString(),
  };
}

