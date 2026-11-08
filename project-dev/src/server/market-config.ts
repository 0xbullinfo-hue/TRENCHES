/**
 * Shared market-data provider configuration (server-only).
 *
 * CoinStats is an OPTIONAL primary provider. It is used only when it is explicitly enabled
 * (COINSTATS_ENABLED=true) AND an API key exists. DexScreener is the independent fallback and
 * needs no credentials. Nothing in here may throw: a missing/invalid value must fall back to a
 * safe default so that build, deploy and startup never depend on CoinStats.
 *
 * The API key is deliberately NOT part of the config object, so it can never be serialised into a
 * diagnostics response, a log line or a client bundle by accident. Read it via getCoinStatsApiKey().
 */

export interface MarketProviderConfig {
  /** True only when COINSTATS_ENABLED === 'true' AND COINSTATS_API_KEY is non-empty. */
  coinstatsEnabled: boolean;
  /** True unless DEXSCREENER_ENABLED === 'false'. */
  dexscreenerEnabled: boolean;
  /** Per-provider request timeout. */
  timeoutMs: number;
  /** How long a cached entry is considered fresh (served as CACHED). */
  cacheTtlSeconds: number;
  /** How long a cached entry may still be served as STALE when every live provider fails. */
  staleTtlSeconds: number;
}

export const DEFAULT_TIMEOUT_MS = 8000;
export const DEFAULT_CACHE_TTL_SECONDS = 30;
export const DEFAULT_STALE_TTL_SECONDS = 180;
/** Upper bound so a typo cannot make a request hang past the serverless function limit. */
export const MAX_TIMEOUT_MS = 30_000;

/** Parses a positive, finite number; anything else (undefined, '', NaN, 0, negative) yields the fallback. */
export function positiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getMarketProviderConfig(env: NodeJS.ProcessEnv = process.env): MarketProviderConfig {
  const cacheTtlSeconds = positiveNumber(env.MARKET_DATA_CACHE_TTL_SECONDS, DEFAULT_CACHE_TTL_SECONDS);
  const rawStale = positiveNumber(env.MARKET_DATA_STALE_TTL_SECONDS, DEFAULT_STALE_TTL_SECONDS);
  return {
    coinstatsEnabled: env.COINSTATS_ENABLED === 'true' && Boolean(env.COINSTATS_API_KEY?.trim()),
    dexscreenerEnabled: env.DEXSCREENER_ENABLED !== 'false',
    timeoutMs: Math.min(positiveNumber(env.MARKET_DATA_TIMEOUT_MS, DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS),
    cacheTtlSeconds,
    // The stale window must never be shorter than the fresh window.
    staleTtlSeconds: Math.max(rawStale, cacheTtlSeconds),
  };
}

/** Snapshot taken at import time. Runtime code calls getMarketProviderConfig() so tests/env changes apply. */
export const marketProviderConfig: MarketProviderConfig = getMarketProviderConfig();

/** Server-side only. Never log, return or expose this value. */
export function getCoinStatsApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.COINSTATS_API_KEY?.trim();
  return key ? key : null;
}

export type CoinStatsConfigState = 'ENABLED' | 'DISABLED' | 'DISABLED_NOT_CONFIGURED';

/** Human-readable CoinStats state for diagnostics. A missing key is "not configured", not a failure. */
export function describeCoinStatsConfig(env: NodeJS.ProcessEnv = process.env): {
  state: CoinStatsConfigState;
  label: string;
} {
  const flag = env.COINSTATS_ENABLED === 'true';
  const hasKey = Boolean(env.COINSTATS_API_KEY?.trim());
  if (flag && hasKey) return { state: 'ENABLED', label: 'CoinStats: ENABLED' };
  if (!hasKey) return { state: 'DISABLED_NOT_CONFIGURED', label: 'CoinStats: DISABLED / NOT CONFIGURED' };
  return { state: 'DISABLED', label: 'CoinStats: DISABLED (API key present, COINSTATS_ENABLED is not "true")' };
}

