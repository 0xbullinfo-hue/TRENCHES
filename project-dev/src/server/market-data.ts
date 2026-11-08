/**
 * Market Data Integration Service
 * Multi-chain telemetry with chain/CA validation, concurrency deduping, and honest status reporting.
 */

export type DataFreshness = 'LIVE' | 'CACHED' | 'FALLBACK' | 'UNAVAILABLE';
export type MarketDataSource = 'COINSTATS' | 'DEXSCREENER' | 'RECORDED' | 'UNAVAILABLE';

interface CachedMarketPrice {
  priceUsd: number;
  marketCapUsd: number;
  change24hPct: number;
  volume24hUsd: number;
  fetchedAt: number;
  source: 'COINSTATS' | 'DEXSCREENER';
  imageUrl?: string;
}

const priceCache = new Map<string, CachedMarketPrice>();
const inflightRequests = new Map<string, Promise<CachedMarketPrice | null>>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

export const CHAIN_TO_DEX_SLUG: Record<string, string | null> = {
  SOL: 'solana',
  BASE: 'base',
  ETH: 'ethereum',
  BSC: 'bsc',
  AVAX: 'avalanche',
  ROBIN: null, // Robinhood chain: no public DexScreener indexing
};

export interface TokenMarketTelemetry {
  marketCapUsd?: number;
  priceUsd?: number;
  change24hPct?: number;
  volume24hUsd?: number;
  imageUrl?: string;
  source: MarketDataSource;
  freshness: DataFreshness;
  updatedAt: string;
  chainSupported: boolean;
  notes?: string;
}

/**
 * Validates whether a Contract Address format matches the declared blockchain.
 */
export function validateChainAndContract(chain: string, ca: string): { valid: boolean; reason?: string } {
  const c = chain.toUpperCase();
  const address = ca.trim();

  if (c === 'SOL') {
    // Solana base58: 32-44 alphanumeric chars, excluding 0, O, I, l
    const isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    if (!isSolana) return { valid: false, reason: 'Invalid Solana base58 token address' };
    return { valid: true };
  }

  if (['ETH', 'BASE', 'BSC', 'AVAX'].includes(c)) {
    const isEvm = /^0x[0-9a-fA-F]{40}$/.test(address);
    if (!isEvm) return { valid: false, reason: `Invalid EVM address format for chain ${c} (must be 0x followed by 40 hex digits)` };
    return { valid: true };
  }

  if (c === 'ROBIN') {
    // Robinhood chain custom CA format
    if (address.length < 10) return { valid: false, reason: 'Invalid contract address for Robinhood chain' };
    return { valid: true };
  }

  return { valid: false, reason: `Unsupported blockchain: ${chain}` };
}

/**
 * Fetch token market cap and price from CoinStats if API key is provided
 */
async function fetchFromCoinStats(ca: string): Promise<CachedMarketPrice | null> {
  const apiKey = process.env.COINSTATS_API_KEY;
  if (!apiKey) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(`https://openapiv1.coinstats.app/coins/token/${encodeURIComponent(ca)}`, {
      signal: controller.signal,
      headers: {
        'X-API-KEY': apiKey,
        Accept: 'application/json',
      },
    });
    clearTimeout(timer);

    if (!res.ok) return null;

    const data = await res.json();
    const coin = data?.coin || data;
    if (coin && typeof coin.marketCap === 'number' && coin.marketCap > 0) {
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
 * Fetch token market cap and price from DexScreener with strict chain matching
 */
async function fetchFromDexScreener(ca: string, expectedChain?: string): Promise<CachedMarketPrice | null> {
  const c = expectedChain ? expectedChain.toUpperCase() : undefined;

  // If chain is known and has no DexScreener support (e.g. ROBIN), do not waste an outbound request
  if (c && CHAIN_TO_DEX_SLUG[c] === null) {
    return null;
  }

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
    const expectedDexSlug = c ? CHAIN_TO_DEX_SLUG[c] : undefined;
    const pairs: Array<{
      chainId?: string;
      liquidity?: { usd?: number };
      marketCap?: number;
      fdv?: number;
      priceUsd?: string;
      priceChange?: { h24?: number };
      volume?: { h24?: number };
    }> = json?.pairs ?? [];

    if (pairs.length === 0) return null;

    // Filter by matching chain if specified
    const onChainPairs = expectedDexSlug
      ? pairs.filter((p) => p.chainId === expectedDexSlug)
      : pairs;

    if (onChainPairs.length === 0) {
      // Chain did not match pairs on DexScreener
      return null;
    }

    // Sort by highest USD liquidity
    const sorted = [...onChainPairs].sort(
      (a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0)
    );

    const pair = sorted[0];
    if (pair) {
      const mc = Number(pair.marketCap || pair.fdv || 0);
      const price = Number(pair.priceUsd || 0);
      const change24h = Number(pair.priceChange?.h24 || 0);
      const vol24h = Number(pair.volume?.h24 || 0);
      const imageUrl = (pair as { info?: { imageUrl?: string } })?.info?.imageUrl;

      if (mc > 0 || imageUrl) {
        return {
          priceUsd: price,
          marketCapUsd: mc,
          change24hPct: change24h,
          volume24hUsd: vol24h,
          imageUrl: typeof imageUrl === 'string' && imageUrl.startsWith('http') ? imageUrl : undefined,
          fetchedAt: Date.now(),
          source: 'DEXSCREENER',
        };
      }
    }
  } catch {
    // Fail cleanly
  }
  return null;
}

/**
 * Retrieves market telemetry for a token contract address.
 * Never represents fallback or fixture data as verified live market data.
 */
export async function getMarketTelemetry(
  ca: string | null | undefined,
  fallbackMcUsd: number,
  fallbackChange24h: number,
  chain?: string
): Promise<TokenMarketTelemetry> {
  const upperChain = chain?.toUpperCase();

  if (!ca || ca.trim().length < 8) {
    return {
      marketCapUsd: fallbackMcUsd,
      change24hPct: fallbackChange24h,
      source: 'RECORDED',
      freshness: 'FALLBACK',
      updatedAt: new Date().toISOString(),
      chainSupported: Boolean(upperChain && upperChain !== 'ROBIN'),
      notes: 'No contract address available; displaying recorded baseline data.',
    };
  }

  const normalizedCa = ca.trim();

  // Validate chain & address format
  if (upperChain) {
    const val = validateChainAndContract(upperChain, normalizedCa);
    if (!val.valid) {
      return {
        marketCapUsd: fallbackMcUsd,
        change24hPct: fallbackChange24h,
        source: 'RECORDED',
        freshness: 'FALLBACK',
        updatedAt: new Date().toISOString(),
        chainSupported: false,
        notes: val.reason,
      };
    }
  }

  // Handle explicitly unsupported data providers (e.g. Robinhood Chain)
  if (upperChain === 'ROBIN') {
    return {
      marketCapUsd: fallbackMcUsd,
      change24hPct: fallbackChange24h,
      source: 'UNAVAILABLE',
      freshness: 'UNAVAILABLE',
      updatedAt: new Date().toISOString(),
      chainSupported: false,
      notes: 'Robinhood Chain market data provider is currently unavailable.',
    };
  }

  const cacheKey = upperChain ? `${upperChain}:${normalizedCa}` : normalizedCa;
  const cached = priceCache.get(cacheKey);

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      marketCapUsd: cached.marketCapUsd,
      priceUsd: cached.priceUsd,
      change24hPct: cached.change24hPct,
      volume24hUsd: cached.volume24hUsd,
      source: cached.source,
      freshness: 'CACHED',
      updatedAt: new Date(cached.fetchedAt).toISOString(),
      chainSupported: true,
    };
  }

  // Concurrency deduplication: coalesce duplicate calls for the same key in-flight
  let inflight = inflightRequests.get(cacheKey);
  if (!inflight) {
    inflight = (async () => {
      // 1. Try CoinStats
      let live = await fetchFromCoinStats(normalizedCa);
      // 2. Fallback to DexScreener
      if (!live) {
        live = await fetchFromDexScreener(normalizedCa, upperChain);
      }
      return live;
    })();

    inflightRequests.set(cacheKey, inflight);
  }

  let liveData: CachedMarketPrice | null = null;
  try {
    liveData = await inflight;
  } finally {
    inflightRequests.delete(cacheKey);
  }

  if (liveData) {
    if (priceCache.size > 1000) {
      const firstKey = priceCache.keys().next().value;
      if (firstKey) priceCache.delete(firstKey);
    }
    priceCache.set(cacheKey, liveData);

    return {
      marketCapUsd: liveData.marketCapUsd,
      priceUsd: liveData.priceUsd,
      change24hPct: liveData.change24hPct,
      volume24hUsd: liveData.volume24hUsd,
      imageUrl: liveData.imageUrl,
      source: liveData.source,
      freshness: 'LIVE',
      updatedAt: new Date(liveData.fetchedAt).toISOString(),
      chainSupported: true,
    };
  }

  // Fallback to recorded baseline data (clearly labeled as FALLBACK, never LIVE)
  return {
    marketCapUsd: fallbackMcUsd,
    change24hPct: fallbackChange24h,
    source: 'RECORDED',
    freshness: 'FALLBACK',
    updatedAt: new Date().toISOString(),
    chainSupported: true,
    notes: 'Live market provider query timed out or returned no matching pair; showing recorded baseline data.',
  };
}
