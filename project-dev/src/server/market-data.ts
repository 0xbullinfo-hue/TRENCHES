/**
 * Market Data Service (server-only).
 *
 * Provider priority:
 *   1. CoinStats    - optional; only when COINSTATS_ENABLED=true AND COINSTATS_API_KEY is set.
 *   2. DexScreener  - independent fallback, no credentials needed.
 *   3. Shared cache - previously VALIDATED data (Upstash Redis, with in-memory fallback), as STALE.
 *   4. UNAVAILABLE  - explicit state. Market data is never invented, defaulted to 0 or relabelled.
 *
 * CoinStats API (verified against https://coinstats.app/api-docs, "Get coins"):
 *   GET https://api.coinstats.app/v1/coins?contractAddresses=<ca>&blockchains=<slug>&currency=USD
 *   Header:   X-API-KEY: <key>             (server-side only)
 *   Response: { meta: {...}, result: [ { id, price, volume, marketCap, priceChange1d, icon,
 *               contractAddresses: [ { blockchain, contractAddress } ], ... } ] }
 * The previous implementation called /coins/token/<ca> and parsed `data.coin || data`; that route does
 * not exist (404) and the response is a `result` array, so it could never have returned data.
 */
import { KV_CONFIGURED, kvGet, kvLock, kvSetEx, kvUnlock } from '@/server/kv';
import {
  describeCoinStatsConfig,
  getCoinStatsApiKey,
  getMarketProviderConfig,
  MAX_FUTURE_CLOCK_SKEW_MS,
  type CoinStatsConfigState,
} from '@/server/market-config';

export { MAX_FUTURE_CLOCK_SKEW_MS };

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type MarketDataStatus = 'LIVE' | 'CACHED' | 'STALE' | 'UNAVAILABLE';
export type MarketProviderName = 'COINSTATS' | 'DEXSCREENER';

export interface MarketToken {
  chain: string;
  contractAddress: string;
}

export interface NormalizedMarketData {
  chain: string;
  contractAddress: string;

  price: number | null;
  marketCap: number | null;
  volume24h: number | null;
  priceChange24h: number | null;
  liquidity: number | null;
  /** Token logo, when the provider supplies one. */
  imageUrl: string | null;

  status: MarketDataStatus;
  /** Where THIS response was served from. 'CACHE' for cached/stale data. */
  provider: MarketProviderName | 'CACHE' | null;
  /** Which provider originally produced the numbers (differs from `provider` when served from cache). */
  originProvider: MarketProviderName | null;

  /** ISO timestamp of when the provider produced the numbers. null when UNAVAILABLE. */
  fetchedAt: string | null;
  isFallback: boolean;
}

/** Provider output before status/provider are decided by the orchestrator. */
export interface ProviderData {
  chain: string;
  contractAddress: string;
  price: number | null;
  marketCap: number | null;
  volume24h: number | null;
  priceChange24h: number | null;
  liquidity: number | null;
  imageUrl: string | null;
  fetchedAt: string;
}

export type ProviderFailureKind =
  | 'not_configured'
  | 'unsupported'
  | 'timeout'
  | 'network'
  | 'unauthorized'
  | 'rate_limited'
  | 'http_error'
  | 'malformed'
  | 'no_match'
  | 'invalid_data';

/** Error raised by a provider adapter. The message never contains URLs, headers or keys. */
export class ProviderError extends Error {
  constructor(
    readonly provider: MarketProviderName,
    readonly kind: ProviderFailureKind,
    readonly status?: number,
    readonly retryAfterSec?: number
  ) {
    super(`${provider} ${kind}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'ProviderError';
  }
}

// ---------------------------------------------------------------------------------------------
// Chain tables & identity helpers
// ---------------------------------------------------------------------------------------------

export const CHAIN_TO_DEX_SLUG: Record<string, string | null> = {
  SOL: 'solana',
  BASE: 'base',
  ETH: 'ethereum',
  BSC: 'bsc',
  AVAX: 'avalanche',
  ROBIN: null, // Robinhood chain: no public DexScreener indexing
};

/**
 * CoinStats `blockchains` slugs. The docs list ethereum, solana, binance-smart-chain, polygon and
 * avalanche as "common values"; `base` is NOT listed there and is therefore UNVERIFIED. A wrong slug
 * only means CoinStats returns an error/no match and the service falls back to DexScreener.
 */
export const CHAIN_TO_COINSTATS_SLUG: Record<string, string | null> = {
  SOL: 'solana',
  ETH: 'ethereum',
  BSC: 'binance-smart-chain',
  AVAX: 'avalanche',
  BASE: 'base',
  ROBIN: null,
};

/** Accepted spellings of the `blockchain` value inside a CoinStats `contractAddresses` entry. */
const COINSTATS_CHAIN_ALIASES: Record<string, string[]> = {
  SOL: ['solana'],
  ETH: ['ethereum'],
  BSC: ['binance-smart-chain', 'binance_smart_chain', 'bsc'],
  AVAX: ['avalanche', 'avalanche-c-chain'],
  BASE: ['base'],
};

const EVM_CHAINS = new Set(['ETH', 'BASE', 'BSC', 'AVAX']);

/** Validates whether a Contract Address format matches the declared blockchain. */
export function validateChainAndContract(chain: string, ca: string): { valid: boolean; reason?: string } {
  const c = chain.toUpperCase();
  const address = ca.trim();

  if (c === 'SOL') {
    // Solana base58: 32-44 alphanumeric chars, excluding 0, O, I, l
    const isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    if (!isSolana) return { valid: false, reason: 'Invalid Solana base58 token address' };
    return { valid: true };
  }

  if (EVM_CHAINS.has(c)) {
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

/** Canonical identity used for cache keys and comparisons: upper-case chain, EVM addresses lower-cased. */
export function normalizeToken(token: MarketToken): MarketToken | null {
  const chain = String(token?.chain ?? '').trim().toUpperCase();
  const ca = String(token?.contractAddress ?? '').trim();
  if (!chain || !ca) return null;
  if (!validateChainAndContract(chain, ca).valid) return null;
  return { chain, contractAddress: EVM_CHAINS.has(chain) ? ca.toLowerCase() : ca };
}

/** EVM addresses compare case-insensitively; Solana base58 addresses are case-sensitive. */
function sameAddress(chain: string, a: string, b: string): boolean {
  return EVM_CHAINS.has(chain) ? a.trim().toLowerCase() === b.trim().toLowerCase() : a.trim() === b.trim();
}

export function marketCacheKey(token: MarketToken): string {
  return `md:v1:${token.chain}:${token.contractAddress}`;
}

// ---------------------------------------------------------------------------------------------
// Numeric validation (missing optional metrics stay null - never 0)
// ---------------------------------------------------------------------------------------------

function finiteNumber(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}
const positiveOrNull = (v: unknown): number | null => {
  const n = finiteNumber(v);
  return n !== null && n > 0 ? n : null;
};
const nonNegativeOrNull = (v: unknown): number | null => {
  const n = finiteNumber(v);
  return n !== null && n >= 0 ? n : null;
};
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const httpUrlOrNull = (v: unknown): string | null =>
  typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null;

/**
 * Final gate for provider data: right token (chain + contract), valid price, no corrupt optional
 * metrics. Accepts `unknown` so it is safe to run on parsed cache entries as well.
 */
export function isValidMarketData(data: unknown, token: MarketToken): data is ProviderData {
  if (!isRecord(data)) return false;
  const expected = normalizeToken(token);
  if (!expected) return false;
  if (String(data.chain).toUpperCase() !== expected.chain) return false;
  if (typeof data.contractAddress !== 'string' || !sameAddress(expected.chain, data.contractAddress, expected.contractAddress)) {
    return false;
  }
  if (positiveOrNull(data.price) === null) return false;
  if (data.marketCap !== null && positiveOrNull(data.marketCap) === null) return false;
  if (data.volume24h !== null && nonNegativeOrNull(data.volume24h) === null) return false;
  if (data.priceChange24h !== null && finiteNumber(data.priceChange24h) === null) return false;
  if (data.liquidity !== null && nonNegativeOrNull(data.liquidity) === null) return false;
  if (typeof data.fetchedAt !== 'string' || Number.isNaN(Date.parse(data.fetchedAt))) return false;
  return true;
}

/** True when the entry is within clock-skew tolerance and no older than the bounded stale window. */
export function isWithinStaleLimit(
  fetchedAt: string | null,
  nowMs: number,
  staleTtlSeconds: number
): boolean {
  if (!fetchedAt) return false;

  const timestamp = Date.parse(fetchedAt);

  if (!Number.isFinite(timestamp) || !Number.isFinite(nowMs)) {
    return false;
  }

  const ageMs = nowMs - timestamp;

  // Reject timestamps that are implausibly ahead of server time.
  if (ageMs < -MAX_FUTURE_CLOCK_SKEW_MS) {
    return false;
  }

  // Accept only data inside the configured stale window.
  return ageMs <= staleTtlSeconds * 1000;
}

// ---------------------------------------------------------------------------------------------
// Shared cache store (Upstash Redis via kv.ts, with in-memory fallback)
// ---------------------------------------------------------------------------------------------

export interface MarketCacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  /** Atomic NX lock. Returns true when acquired. */
  lock(key: string, token: string, ttlSec: number): Promise<boolean>;
  unlock(key: string, token: string): Promise<void>;
  stats?(): { backend: 'redis' | 'memory'; errors: number };
}

/** Process-local store. Used on its own when Redis is not configured, and as the Redis-outage fallback. */
export function createMemoryMarketCacheStore(now: () => number = Date.now): MarketCacheStore {
  const data = new Map<string, { value: string; expiresAt: number }>();
  const locks = new Map<string, { token: string; expiresAt: number }>();
  return {
    async get(key) {
      const hit = data.get(key);
      if (!hit) return null;
      if (hit.expiresAt <= now()) {
        data.delete(key);
        return null;
      }
      return hit.value;
    },
    async set(key, value, ttlSec) {
      if (data.size > 2000) {
        const first = data.keys().next().value;
        if (first !== undefined) data.delete(first);
      }
      data.set(key, { value, expiresAt: now() + ttlSec * 1000 });
    },
    async lock(key, token, ttlSec) {
      const held = locks.get(key);
      if (held && held.expiresAt > now()) return false;
      locks.set(key, { token, expiresAt: now() + ttlSec * 1000 });
      return true;
    },
    async unlock(key, token) {
      if (locks.get(key)?.token === token) locks.delete(key);
    },
    stats: () => ({ backend: 'memory', errors: 0 }),
  };
}

/**
 * Production store: Upstash Redis is the shared source of truth across serverless instances. Every
 * write is mirrored into process memory so a Redis outage degrades to per-instance caching instead of
 * failing. Reads fall back to memory when Redis errors.
 */
export function createDefaultMarketCacheStore(): MarketCacheStore {
  const mem = createMemoryMarketCacheStore();
  if (!KV_CONFIGURED) return mem;
  let errors = 0;
  return {
    async get(key) {
      try {
        const v = await kvGet(key);
        if (v !== null) return v;
      } catch {
        errors++;
      }
      return mem.get(key);
    },
    async set(key, value, ttlSec) {
      await mem.set(key, value, ttlSec);
      try {
        await kvSetEx(key, value, Math.max(1, Math.ceil(ttlSec)));
      } catch {
        errors++;
      }
    },
    async lock(key, token, ttlSec) {
      return kvLock(key, token, Math.max(1, Math.ceil(ttlSec))); // throws on outage -> service fails open
    },
    async unlock(key, token) {
      await kvUnlock(key, token);
    },
    stats: () => ({ backend: 'redis', errors }),
  };
}

interface CacheRecord {
  v: 1;
  data: ProviderData;
  origin: MarketProviderName;
}

// ---------------------------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------------------------

interface ProviderHealth {
  attempts: number;
  successes: number;
  failures: number;
  rateLimited: number;
  skippedBackoff: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureKind: ProviderFailureKind | null;
  lastHttpStatus: number | null;
  lastLatencyMs: number | null;
  backoffUntilMs: number;
}

const newHealth = (): ProviderHealth => ({
  attempts: 0,
  successes: 0,
  failures: 0,
  rateLimited: 0,
  skippedBackoff: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastFailureKind: null,
  lastHttpStatus: null,
  lastLatencyMs: null,
  backoffUntilMs: 0,
});

export interface MarketDiagnostics {
  generatedAt: string;
  /** Counters live in process memory, so on serverless hosts they describe one warm instance. */
  scope: 'per-instance';
  config: {
    coinstats: { state: CoinStatsConfigState; label: string; enabled: boolean };
    dexscreener: { enabled: boolean };
    timeoutMs: number;
    cacheTtlSeconds: number;
    staleTtlSeconds: number;
  };
  cache: {
    backend: 'redis' | 'memory';
    hits: number;
    misses: number;
    staleServed: number;
    unavailableServed: number;
    storeErrors: number;
  };
  providers: Record<
    MarketProviderName,
    Omit<ProviderHealth, 'backoffUntilMs'> & { backoffUntil: string | null; dexFallbackActivations?: number }
  >;
}

/** Logs a provider failure. Only the failure category/status is logged: never keys, headers or URLs. */
export function logProviderFailure(
  provider: MarketProviderName,
  error: unknown,
  token: MarketToken,
  log: Pick<Console, 'warn'> = console
): void {
  const kind = error instanceof ProviderError ? error.kind : 'network';
  const status = error instanceof ProviderError && error.status ? ` status=${error.status}` : '';
  const ca = token.contractAddress ? `${token.contractAddress.slice(0, 6)}…${token.contractAddress.slice(-4)}` : '?';
  log.warn(`[TrenchLabs MarketData] ${provider} failed kind=${kind}${status} chain=${token.chain} ca=${ca}`);
}

// ---------------------------------------------------------------------------------------------
// Provider adapters
// ---------------------------------------------------------------------------------------------

const COINSTATS_BASE = 'https://api.coinstats.app/v1';
const DEXSCREENER_BASE = 'https://api.dexscreener.com/latest/dex/tokens';

function parseRetryAfter(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 300) : undefined;
}

async function fetchJson(
  fetchImpl: typeof fetch,
  provider: MarketProviderName,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetchImpl(url, { headers, signal: ctrl.signal, cache: 'no-store' });
    } catch (e) {
      const aborted = ctrl.signal.aborted || (e as Error | undefined)?.name === 'AbortError';
      throw new ProviderError(provider, aborted ? 'timeout' : 'network');
    }
    if (res.status === 401 || res.status === 403) throw new ProviderError(provider, 'unauthorized', res.status);
    if (res.status === 429) {
      throw new ProviderError(provider, 'rate_limited', 429, parseRetryAfter(res.headers?.get?.('retry-after')));
    }
    if (!res.ok) throw new ProviderError(provider, 'http_error', res.status);
    try {
      return await res.json();
    } catch {
      throw new ProviderError(provider, ctrl.signal.aborted ? 'timeout' : 'malformed', res.status);
    }
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

export interface MarketDataDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  env: NodeJS.ProcessEnv;
  store: MarketCacheStore;
  log: Pick<Console, 'info' | 'warn'>;
  /** Max time to wait for another instance that holds the refresh lock. */
  lockWaitMs: number;
  lockPollMs: number;
}

export interface MarketDataService {
  getMarketData(token: MarketToken): Promise<NormalizedMarketData>;
  fetchCoinStats(token: MarketToken): Promise<ProviderData>;
  fetchDexScreener(token: MarketToken): Promise<ProviderData>;
  getDiagnostics(): MarketDiagnostics;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createMarketDataService(overrides: Partial<MarketDataDeps> = {}): MarketDataService {
  const deps: MarketDataDeps = {
    fetch: (...a) => fetch(...a),
    now: Date.now,
    sleep: defaultSleep,
    env: process.env,
    store: createDefaultMarketCacheStore(),
    log: console,
    lockWaitMs: 2500,
    lockPollMs: 200,
    ...overrides,
  };

  const health: Record<MarketProviderName, ProviderHealth> = { COINSTATS: newHealth(), DEXSCREENER: newHealth() };
  const counters = { hits: 0, misses: 0, staleServed: 0, unavailableServed: 0, storeErrors: 0, dexFallbacks: 0 };
  const inflight = new Map<string, Promise<NormalizedMarketData>>();
  let loggedCoinStatsState = false;

  const config = () => getMarketProviderConfig(deps.env);

  // ---- adapters ----------------------------------------------------------------------------

  async function fetchCoinStats(tokenIn: MarketToken): Promise<ProviderData> {
    const apiKey = getCoinStatsApiKey(deps.env);
    if (!apiKey) throw new ProviderError('COINSTATS', 'not_configured');
    const token = normalizeToken(tokenIn);
    const slug = token ? CHAIN_TO_COINSTATS_SLUG[token.chain] : null;
    if (!token || !slug) throw new ProviderError('COINSTATS', 'unsupported');

    const url =
      `${COINSTATS_BASE}/coins?contractAddresses=${encodeURIComponent(token.contractAddress)}` +
      `&blockchains=${encodeURIComponent(slug)}&currency=USD&limit=20`;
    const json = await fetchJson(
      deps.fetch,
      'COINSTATS',
      url,
      { 'X-API-KEY': apiKey, Accept: 'application/json' },
      config().timeoutMs
    );

    if (!isRecord(json) || !Array.isArray(json.result)) throw new ProviderError('COINSTATS', 'malformed');
    const aliases = COINSTATS_CHAIN_ALIASES[token.chain] ?? [];

    // Identity: only accept a coin that lists THIS contract on THIS chain. Anything else is another token.
    const matches = json.result.filter(
      (item): item is Record<string, unknown> =>
        isRecord(item) &&
        Array.isArray(item.contractAddresses) &&
        item.contractAddresses.some(
          (entry) =>
            isRecord(entry) &&
            typeof entry.blockchain === 'string' &&
            aliases.includes(entry.blockchain.toLowerCase()) &&
            typeof entry.contractAddress === 'string' &&
            sameAddress(token.chain, entry.contractAddress, token.contractAddress)
        )
    );
    if (matches.length === 0) throw new ProviderError('COINSTATS', 'no_match');

    const priced = matches.filter((m) => positiveOrNull(m.price) !== null);
    if (priced.length === 0) throw new ProviderError('COINSTATS', 'invalid_data');
    priced.sort((a, b) => (positiveOrNull(b.marketCap) ?? -1) - (positiveOrNull(a.marketCap) ?? -1));
    const coin = priced[0];

    return {
      chain: token.chain,
      contractAddress: token.contractAddress,
      price: positiveOrNull(coin.price),
      marketCap: positiveOrNull(coin.marketCap),
      volume24h: nonNegativeOrNull(coin.volume),
      priceChange24h: finiteNumber(coin.priceChange1d),
      liquidity: null, // not provided by CoinStats
      imageUrl: httpUrlOrNull(coin.icon),
      fetchedAt: new Date(deps.now()).toISOString(),
    };
  }

  async function fetchDexScreener(tokenIn: MarketToken): Promise<ProviderData> {
    const token = normalizeToken(tokenIn);
    const slug = token ? CHAIN_TO_DEX_SLUG[token.chain] : null;
    if (!token || !slug) throw new ProviderError('DEXSCREENER', 'unsupported');

    const json = await fetchJson(
      deps.fetch,
      'DEXSCREENER',
      `${DEXSCREENER_BASE}/${encodeURIComponent(token.contractAddress)}`,
      { Accept: 'application/json' },
      config().timeoutMs
    );
    if (!isRecord(json)) throw new ProviderError('DEXSCREENER', 'malformed');
    if (json.pairs === null || (Array.isArray(json.pairs) && json.pairs.length === 0)) {
      throw new ProviderError('DEXSCREENER', 'no_match');
    }
    if (!Array.isArray(json.pairs)) throw new ProviderError('DEXSCREENER', 'malformed');

    // Identity: right chain AND the requested token must be the BASE token (priceUsd/marketCap describe
    // the base token; a pair where our token is only the quote would report another token's numbers).
    const pairs = json.pairs.filter(
      (p): p is Record<string, unknown> =>
        isRecord(p) &&
        p.chainId === slug &&
        isRecord(p.baseToken) &&
        typeof p.baseToken.address === 'string' &&
        sameAddress(token.chain, p.baseToken.address, token.contractAddress)
    );
    if (pairs.length === 0) throw new ProviderError('DEXSCREENER', 'no_match');

    const liq = (p: Record<string, unknown>) => (isRecord(p.liquidity) ? nonNegativeOrNull(p.liquidity.usd) : null);
    pairs.sort((a, b) => (liq(b) ?? -1) - (liq(a) ?? -1));
    const pair = pairs.find((p) => positiveOrNull(p.priceUsd) !== null);
    if (!pair) throw new ProviderError('DEXSCREENER', 'invalid_data');

    return {
      chain: token.chain,
      contractAddress: token.contractAddress,
      price: positiveOrNull(pair.priceUsd),
      marketCap: positiveOrNull(pair.marketCap), // deliberately NOT falling back to FDV
      volume24h: isRecord(pair.volume) ? nonNegativeOrNull(pair.volume.h24) : null,
      priceChange24h: isRecord(pair.priceChange) ? finiteNumber(pair.priceChange.h24) : null,
      liquidity: liq(pair),
      imageUrl: isRecord(pair.info) ? httpUrlOrNull(pair.info.imageUrl) : null,
      fetchedAt: new Date(deps.now()).toISOString(),
    };
  }

  // ---- cache -------------------------------------------------------------------------------

  async function readCache(token: MarketToken): Promise<CacheRecord | null> {
    let raw: string | null = null;
    try {
      raw = await deps.store.get(marketCacheKey(token));
    } catch {
      counters.storeErrors++;
      return null;
    }
    if (!raw) return null;
    try {
      const rec = JSON.parse(raw) as CacheRecord;
      if (rec?.v !== 1 || (rec.origin !== 'COINSTATS' && rec.origin !== 'DEXSCREENER')) return null;
      // Never trust a cached value blindly: identity + numbers are re-validated, so a key collision or a
      // corrupted entry can never surface another token's data.
      if (!isValidMarketData(rec.data, token)) return null;
      if (!isWithinStaleLimit(rec.data.fetchedAt, deps.now(), config().staleTtlSeconds)) return null;
      return rec;
    } catch {
      return null;
    }
  }

  async function writeCache(token: MarketToken, data: ProviderData, origin: MarketProviderName): Promise<void> {
    const rec: CacheRecord = { v: 1, data, origin };
    try {
      await deps.store.set(marketCacheKey(token), JSON.stringify(rec), config().staleTtlSeconds);
    } catch {
      counters.storeErrors++;
    }
  }

  const ageMs = (rec: CacheRecord) => Math.max(0, deps.now() - Date.parse(rec.data.fetchedAt));

  // ---- result builders ---------------------------------------------------------------------

  function unavailable(token: MarketToken): NormalizedMarketData {
    counters.unavailableServed++;
    return {
      chain: token.chain,
      contractAddress: token.contractAddress,
      price: null,
      marketCap: null,
      volume24h: null,
      priceChange24h: null,
      liquidity: null,
      imageUrl: null,
      status: 'UNAVAILABLE',
      provider: null,
      originProvider: null,
      fetchedAt: null,
      isFallback: true,
    };
  }

  function fromProvider(data: ProviderData, provider: MarketProviderName): NormalizedMarketData {
    return {
      ...data,
      status: 'LIVE',
      provider,
      originProvider: provider,
      isFallback: provider !== 'COINSTATS',
    };
  }

  function fromCache(rec: CacheRecord, status: 'CACHED' | 'STALE'): NormalizedMarketData {
    return {
      ...rec.data,
      status,
      provider: 'CACHE',
      originProvider: rec.origin,
      isFallback: status === 'STALE' || rec.origin !== 'COINSTATS',
    };
  }

  // ---- health bookkeeping ------------------------------------------------------------------

  function recordSuccess(provider: MarketProviderName, latencyMs: number) {
    const h = health[provider];
    h.attempts++;
    h.successes++;
    h.lastSuccessAt = new Date(deps.now()).toISOString();
    h.lastLatencyMs = latencyMs;
    h.lastHttpStatus = 200;
    if (provider === 'COINSTATS') h.backoffUntilMs = 0;
  }

  function recordFailure(provider: MarketProviderName, error: unknown, latencyMs: number) {
    const h = health[provider];
    const pe = error instanceof ProviderError ? error : new ProviderError(provider, 'network');
    h.attempts++;
    h.failures++;
    h.lastFailureAt = new Date(deps.now()).toISOString();
    h.lastFailureKind = pe.kind;
    h.lastHttpStatus = pe.status ?? null;
    h.lastLatencyMs = latencyMs;
    if (pe.kind === 'rate_limited') h.rateLimited++;
    if (provider === 'COINSTATS') {
      // Stop spending credits / latency on a key that is rejected or rate limited.
      if (pe.kind === 'unauthorized') h.backoffUntilMs = deps.now() + 5 * 60_000;
      else if (pe.kind === 'rate_limited') h.backoffUntilMs = deps.now() + (pe.retryAfterSec ?? 60) * 1000;
    }
  }

  async function runProvider(
    provider: MarketProviderName,
    token: MarketToken,
    adapter: (t: MarketToken) => Promise<ProviderData>
  ): Promise<ProviderData | null> {
    const started = deps.now();
    try {
      const data = await adapter(token);
      if (!isValidMarketData(data, token)) throw new ProviderError(provider, 'invalid_data');
      if (!isWithinStaleLimit(data.fetchedAt, deps.now(), config().staleTtlSeconds)) {
        throw new ProviderError(provider, 'invalid_data');
      }
      recordSuccess(provider, deps.now() - started);
      return data;
    } catch (error) {
      recordFailure(provider, error, deps.now() - started);
      logProviderFailure(provider, error, token, deps.log);
      return null;
    }
  }

  // ---- orchestration -----------------------------------------------------------------------

  async function refresh(token: MarketToken, stale: CacheRecord | null): Promise<NormalizedMarketData> {
    const cfg = config();
    const lockKey = `md:lock:${token.chain}:${token.contractAddress}`;
    const lockToken = Math.random().toString(36).slice(2);
    let lockHeld = false;

    // Cross-instance single flight: if another instance is already refreshing this token, wait briefly
    // for its result instead of hitting the providers again. Redis problems fail OPEN.
    try {
      lockHeld = await deps.store.lock(lockKey, lockToken, Math.ceil((cfg.timeoutMs * 2) / 1000) + 2);
      if (!lockHeld) {
        const deadline = deps.now() + deps.lockWaitMs;
        while (deps.now() < deadline) {
          await deps.sleep(deps.lockPollMs);
          const rec = await readCache(token);
          if (rec && ageMs(rec) < cfg.cacheTtlSeconds * 1000) {
            counters.hits++;
            return fromCache(rec, 'CACHED');
          }
        }
      }
    } catch {
      counters.storeErrors++;
    }

    try {
      let result: NormalizedMarketData | null = null;

      if (!loggedCoinStatsState) {
        loggedCoinStatsState = true;
        deps.log.info(`[TrenchLabs MarketData] ${describeCoinStatsConfig(deps.env).label}`);
      }

      let coinstatsAttempted = false;
      if (cfg.coinstatsEnabled) {
        if (health.COINSTATS.backoffUntilMs > deps.now()) {
          health.COINSTATS.skippedBackoff++;
        } else {
          coinstatsAttempted = true;
          const data = await runProvider('COINSTATS', token, fetchCoinStats);
          if (data) {
            await writeCache(token, data, 'COINSTATS');
            result = fromProvider(data, 'COINSTATS');
          }
        }
      }

      if (!result && cfg.dexscreenerEnabled) {
        if (cfg.coinstatsEnabled) {
          counters.dexFallbacks++;
          deps.log.info(
            `[TrenchLabs MarketData] DexScreener fallback activated (${coinstatsAttempted ? 'CoinStats failed' : 'CoinStats in backoff'}) chain=${token.chain}`
          );
        }
        const data = await runProvider('DEXSCREENER', token, fetchDexScreener);
        if (data) {
          await writeCache(token, data, 'DEXSCREENER');
          result = fromProvider(data, 'DEXSCREENER');
        }
      }

      if (result) return result;

      // Both providers failed/disabled: another instance may have refreshed meanwhile, else serve STALE.
      const latest = (await readCache(token)) ?? stale;
      if (latest) {
        if (ageMs(latest) < cfg.cacheTtlSeconds * 1000) {
          counters.hits++;
          return fromCache(latest, 'CACHED');
        }
        counters.staleServed++;
        deps.log.warn(`[TrenchLabs MarketData] Serving STALE data (age=${Math.round(ageMs(latest) / 1000)}s) chain=${token.chain}`);
        return fromCache(latest, 'STALE');
      }

      deps.log.warn(`[TrenchLabs MarketData] UNAVAILABLE: no provider or cache data for chain=${token.chain}`);
      return unavailable(token);
    } finally {
      if (lockHeld) await deps.store.unlock(lockKey, lockToken).catch(() => undefined);
    }
  }

  async function getMarketData(tokenIn: MarketToken): Promise<NormalizedMarketData> {
    const token = normalizeToken(tokenIn);
    if (!token) {
      return unavailable({
        chain: String(tokenIn?.chain ?? '').toUpperCase(),
        contractAddress: String(tokenIn?.contractAddress ?? ''),
      });
    }
    // No provider covers this chain (e.g. Robinhood): do not spend requests, report it honestly.
    if (CHAIN_TO_DEX_SLUG[token.chain] == null && CHAIN_TO_COINSTATS_SLUG[token.chain] == null) {
      return unavailable(token);
    }

    const cfg = config();
    const cached = await readCache(token);
    if (cached && ageMs(cached) < cfg.cacheTtlSeconds * 1000) {
      counters.hits++;
      return fromCache(cached, 'CACHED');
    }
    counters.misses++;

    const key = marketCacheKey(token);
    let pending = inflight.get(key);
    if (!pending) {
      pending = refresh(token, cached).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    return pending;
  }

  function getDiagnostics(): MarketDiagnostics {
    const cfg = config();
    const cs = describeCoinStatsConfig(deps.env);
    const view = (name: MarketProviderName) => {
      const { backoffUntilMs, ...rest } = health[name];
      return { ...rest, backoffUntil: backoffUntilMs > deps.now() ? new Date(backoffUntilMs).toISOString() : null };
    };
    const storeStats = deps.store.stats?.() ?? { backend: 'memory' as const, errors: 0 };
    return {
      generatedAt: new Date(deps.now()).toISOString(),
      scope: 'per-instance',
      config: {
        coinstats: { state: cs.state, label: cs.label, enabled: cfg.coinstatsEnabled },
        dexscreener: { enabled: cfg.dexscreenerEnabled },
        timeoutMs: cfg.timeoutMs,
        cacheTtlSeconds: cfg.cacheTtlSeconds,
        staleTtlSeconds: cfg.staleTtlSeconds,
      },
      cache: {
        backend: storeStats.backend,
        hits: counters.hits,
        misses: counters.misses,
        staleServed: counters.staleServed,
        unavailableServed: counters.unavailableServed,
        storeErrors: counters.storeErrors + storeStats.errors,
      },
      providers: {
        COINSTATS: view('COINSTATS'),
        DEXSCREENER: { ...view('DEXSCREENER'), dexFallbackActivations: counters.dexFallbacks },
      },
    };
  }

  return { getMarketData, fetchCoinStats, fetchDexScreener, getDiagnostics };
}

// ---------------------------------------------------------------------------------------------
// Default shared instance
// ---------------------------------------------------------------------------------------------

let defaultService: MarketDataService | null = null;
function service(): MarketDataService {
  if (!defaultService) defaultService = createMarketDataService();
  return defaultService;
}

/** Central entry point: validated, cached, provider-prioritised market data for one token. */
export function getMarketData(token: MarketToken): Promise<NormalizedMarketData> {
  return service().getMarketData(token);
}

/** Provider health for the protected admin endpoint. Contains no secrets. */
export function getMarketDiagnostics(): MarketDiagnostics {
  return service().getDiagnostics();
}
