// Shared fixtures for market-data tests. All provider traffic is MOCKED: nothing here talks to the network.
import * as md from '../../../src/server/market-data.ts';

export const SOL_TOKEN = 'So11111111111111111111111111111111111111112';
export const SOL_OTHER = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const EVM_LOWER = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
export const EVM_CHECKSUM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
export const EVM_OTHER = '0xdac17f958d2ee523a2206206994597c13d831ec7';
export const KEY = 'test-secret-key-abc123';

export function makeClock(start = Date.parse('2026-01-01T00:00:00.000Z')) {
  let t = start;
  return { now: () => t, advance: (ms) => void (t += ms) };
}

export function json(body, status = 200, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A fetch that never answers until its AbortSignal fires (simulates a provider timeout). */
export function hang(init) {
  return new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      reject(e);
    });
  });
}

/** Routes by hostname. Each handler may be reassigned between calls through the returned object. */
export function makeFetch(handlers) {
  const calls = [];
  const state = { ...handlers, calls };
  state.fetch = async (url, init = {}) => {
    const u = String(url);
    const provider = u.includes('api.coinstats.app') ? 'COINSTATS' : u.includes('api.dexscreener.com') ? 'DEXSCREENER' : null;
    if (!provider) throw new Error(`unexpected URL ${u}`);
    calls.push({ provider, url: u, headers: init.headers ?? {} });
    const handler = provider === 'COINSTATS' ? state.coinstats : state.dex;
    if (!handler) throw new Error(`no handler for ${provider}`);
    return handler(u, init);
  };
  state.count = (provider) => calls.filter((c) => c.provider === provider).length;
  return state;
}

export function coinstatsBody(ca, { blockchain = 'solana', entryCa = ca, ...coin } = {}) {
  return {
    meta: { page: 1, limit: 20, itemCount: 1, pageCount: 1, hasPreviousPage: false, hasNextPage: false },
    result: [
      {
        id: 'some-token',
        icon: 'https://static.coinstats.app/coins/some_32.png',
        name: 'Some Token',
        symbol: 'SOME',
        rank: 900,
        price: 0.5,
        volume: 1234.5,
        marketCap: 5_000_000,
        priceChange1d: 12.5,
        contractAddress: ca,
        contractAddresses: [{ blockchain, contractAddress: entryCa }],
        ...coin,
      },
    ],
  };
}

export function dexPair({ chainId = 'solana', base = SOL_TOKEN, quote = SOL_OTHER, ...over } = {}) {
  return {
    chainId,
    dexId: 'raydium',
    pairAddress: `pair-${Math.random().toString(36).slice(2)}`,
    baseToken: { address: base, name: 'Base', symbol: 'BASE' },
    quoteToken: { address: quote, name: 'Quote', symbol: 'QUOTE' },
    priceUsd: '0.25',
    marketCap: 2_000_000,
    fdv: 2_500_000,
    liquidity: { usd: 100_000 },
    volume: { h24: 50_000 },
    priceChange: { h24: -3.5 },
    info: { imageUrl: 'https://cdn.dexscreener.com/img.png' },
    ...over,
  };
}

export const dexBody = (pairs) => ({ schemaVersion: '1.0.0', pairs });

export function makeService({ env = {}, fetchState, clock = makeClock(), store, log } = {}) {
  const logs = [];
  const logger = log ?? {
    info: (m) => logs.push(`info ${m}`),
    warn: (m) => logs.push(`warn ${m}`),
  };
  const svc = md.createMarketDataService({
    fetch: fetchState.fetch,
    now: clock.now,
    sleep: async (ms) => clock.advance(ms),
    env: { COINSTATS_ENABLED: 'true', COINSTATS_API_KEY: KEY, MARKET_DATA_TIMEOUT_MS: '60', ...env },
    store: store ?? md.createMemoryMarketCacheStore(clock.now),
    log: logger,
    lockWaitMs: 50,
    lockPollMs: 10,
  });
  return { svc, clock, logs };
}

export const solToken = { chain: 'SOL', contractAddress: SOL_TOKEN };
export const evmToken = { chain: 'ETH', contractAddress: EVM_LOWER };

