import test from 'node:test';
import assert from 'node:assert/strict';
import * as md from '../../src/server/market-data.ts';
import { applyMarketData, hydrateAlphaItems, isMarketDataSupported } from '../../src/server/market-view.ts';
import { formatChangePct, compareChangeDesc } from '../../src/components/dashboard/MarketDataBadge.tsx';
import {
  SOL_TOKEN,
  SOL_OTHER,
  EVM_LOWER,
  EVM_CHECKSUM,
  EVM_OTHER,
  KEY,
  makeClock,
  json,
  hang,
  makeFetch,
  coinstatsBody,
  dexPair,
  dexBody,
  makeService,
  solToken,
  evmToken,
} from './helpers/market-fixtures.mjs';

// ---------------------------------------------------------------------------
// 1. Provider Orchestration Priority & Fallback
// ---------------------------------------------------------------------------

test('Orchestration: CoinStats disabled -> DexScreener is used directly without calling CoinStats', async () => {
  const fetchState = makeFetch({
    coinstats: () => {
      throw new Error('CoinStats should not be called when disabled');
    },
    dex: () => json(dexBody([dexPair({ base: SOL_TOKEN, priceUsd: '1.25', marketCap: 9_000_000 })])),
  });
  const { svc, logs } = makeService({
    env: { COINSTATS_ENABLED: 'false', COINSTATS_API_KEY: '' },
    fetchState,
  });

  const res = await svc.getMarketData(solToken);
  assert.equal(res.status, 'LIVE');
  assert.equal(res.provider, 'DEXSCREENER');
  assert.equal(res.originProvider, 'DEXSCREENER');
  assert.equal(res.isFallback, true);
  assert.equal(res.price, 1.25);
  assert.equal(res.marketCap, 9_000_000);
  assert.equal(fetchState.count('COINSTATS'), 0);
  assert.equal(fetchState.count('DEXSCREENER'), 1);
  assert.ok(logs.some((l) => l.includes('CoinStats: DISABLED / NOT CONFIGURED')));
});

test('Orchestration: CoinStats enabled + valid key -> CoinStats is primary (DexScreener not called)', async () => {
  const fetchState = makeFetch({
    coinstats: () => json(coinstatsBody(SOL_TOKEN, { price: 2.5, marketCap: 25_000_000, volume: 800_000, priceChange1d: 14.2 })),
    dex: () => {
      throw new Error('DexScreener should not be called when CoinStats succeeds');
    },
  });
  const { svc } = makeService({ fetchState });

  const res = await svc.getMarketData(solToken);
  assert.equal(res.status, 'LIVE');
  assert.equal(res.provider, 'COINSTATS');
  assert.equal(res.originProvider, 'COINSTATS');
  assert.equal(res.isFallback, false);
  assert.equal(res.price, 2.5);
  assert.equal(res.marketCap, 25_000_000);
  assert.equal(res.volume24h, 800_000);
  assert.equal(res.priceChange24h, 14.2);
  assert.equal(fetchState.count('COINSTATS'), 1);
  assert.equal(fetchState.count('DEXSCREENER'), 0);
});

test('Orchestration: CoinStats failures (401, 429, 500, timeout, malformed, wrong token) fall back to DexScreener', async () => {
  const scenarios = [
    { name: '401 unauthorized', handler: () => json({ message: 'Invalid key' }, 401), expectsBackoff: true },
    { name: '429 rate limited', handler: () => json({ message: 'Too many requests' }, 429, { 'retry-after': '120' }), expectsBackoff: true },
    { name: '500 server error', handler: () => json({ error: 'internal' }, 500), expectsBackoff: false },
    { name: 'timeout', handler: (_u, init) => hang(init), expectsBackoff: false },
    { name: 'malformed JSON', handler: () => json('not-json{{{', 200), expectsBackoff: false },
    { name: 'wrong contract identity', handler: () => json(coinstatsBody(SOL_OTHER)), expectsBackoff: false },
  ];

  for (const s of scenarios) {
    const fetchState = makeFetch({
      coinstats: s.handler,
      dex: () => json(dexBody([dexPair({ base: SOL_TOKEN, priceUsd: '0.42', marketCap: 4_200_000 })])),
    });
    const { svc } = makeService({ fetchState });

    const res = await svc.getMarketData(solToken);
    assert.equal(res.status, 'LIVE', `${s.name}: expected LIVE from fallback`);
    assert.equal(res.provider, 'DEXSCREENER', `${s.name}: expected DEXSCREENER`);
    assert.equal(res.isFallback, true, `${s.name}: expected isFallback=true`);
    assert.equal(res.price, 0.42);
    assert.equal(fetchState.count('COINSTATS'), 1);
    assert.equal(fetchState.count('DEXSCREENER'), 1);

    // If backoff applies (401 / 429), a second request for another token should skip CoinStats during backoff window
    if (s.expectsBackoff) {
      fetchState.dex = () => json(dexBody([dexPair({ chainId: 'ethereum', base: EVM_LOWER, priceUsd: '1.00', marketCap: 10_000_000 })]));
      const res2 = await svc.getMarketData(evmToken);
      assert.equal(res2.provider, 'DEXSCREENER');
      assert.equal(fetchState.count('COINSTATS'), 1, `${s.name}: CoinStats should be skipped while in backoff`);
      assert.equal( svc.getDiagnostics().providers.COINSTATS.skippedBackoff, 1);
    }
  }
});

test('Orchestration: Both live providers fail -> serves shared cached data as STALE within staleTtlSeconds', async () => {
  const clock = makeClock();
  const fetchState = makeFetch({
    coinstats: () => json(coinstatsBody(SOL_TOKEN, { price: 3.0, marketCap: 30_000_000 })),
    dex: () => json(dexBody([dexPair({ base: SOL_TOKEN, priceUsd: '3.0', marketCap: 30_000_000 })])),
  });
  const { svc } = makeService({
    clock,
    fetchState,
    env: {
      COINSTATS_ENABLED: 'true',
      COINSTATS_API_KEY: KEY,
      MARKET_DATA_CACHE_TTL_SECONDS: '30',
      MARKET_DATA_STALE_TTL_SECONDS: '180',
    },
  });

  // 1. Prime cache with LIVE response
  const live = await svc.getMarketData(solToken);
  assert.equal(live.status, 'LIVE');
  assert.equal(live.provider, 'COINSTATS');

  // 2. Advance past live cache TTL (30s) into stale window (e.g. 60s), and make both providers fail
  clock.advance(60_000);
  fetchState.coinstats = () => json({ error: 'down' }, 503);
  fetchState.dex = () => json({ error: 'down' }, 503);

  const stale = await svc.getMarketData(solToken);
  assert.equal(stale.status, 'STALE');
  assert.equal(stale.provider, 'CACHE');
  assert.equal(stale.originProvider, 'COINSTATS');
  assert.equal(stale.isFallback, true);
  assert.equal(stale.price, 3.0);
  assert.equal(stale.marketCap, 30_000_000);
  assert.equal(stale.fetchedAt, live.fetchedAt);

  // 3. Advance past staleTtlSeconds (180s total) -> must return UNAVAILABLE, never expired stale data
  clock.advance(130_000);
  const unavail = await svc.getMarketData(solToken);
  assert.equal(unavail.status, 'UNAVAILABLE');
  assert.equal(unavail.provider, null);
  assert.equal(unavail.price, null);
  assert.equal(unavail.marketCap, null);
  assert.equal(unavail.volume24h, null);
  assert.equal(unavail.priceChange24h, null);
  assert.equal(unavail.fetchedAt, null);
  assert.equal(unavail.isFallback, true);
});

test('Orchestration: No valid provider and no cache -> returns UNAVAILABLE with null metrics (never fabricates 0)', async () => {
  const fetchState = makeFetch({
    coinstats: () => json({ error: 'down' }, 500),
    dex: () => json({ pairs: [] }, 200),
  });
  const { svc } = makeService({ fetchState });

  const res = await svc.getMarketData(solToken);
  assert.deepEqual(res, {
    chain: 'SOL',
    contractAddress: SOL_TOKEN,
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
  });
});

// ---------------------------------------------------------------------------
// 2. Shared Cache Behavior (Hit, Miss, TTL, Isolation, Outage, Single-Flight)
// ---------------------------------------------------------------------------

test('Cache: hit within cacheTtlSeconds returns CACHED without calling providers again', async () => {
  const clock = makeClock();
  const fetchState = makeFetch({
    coinstats: () => json(coinstatsBody(SOL_TOKEN, { price: 1.5, marketCap: 15_000_000 })),
    dex: () => json({ pairs: [] }),
  });
  const { svc } = makeService({
    clock,
    fetchState,
    env: { COINSTATS_ENABLED: 'true', COINSTATS_API_KEY: KEY, MARKET_DATA_CACHE_TTL_SECONDS: '30' },
  });

  const first = await svc.getMarketData(solToken);
  assert.equal(first.status, 'LIVE');
  assert.equal(fetchState.count('COINSTATS'), 1);

  clock.advance(10_000); // 10s < 30s TTL
  const second = await svc.getMarketData(solToken);
  assert.equal(second.status, 'CACHED');
  assert.equal(second.provider, 'CACHE');
  assert.equal(second.originProvider, 'COINSTATS');
  assert.equal(second.isFallback, false);
  assert.equal(second.price, 1.5);
  assert.equal(fetchState.count('COINSTATS'), 1, 'No second network call on cache hit');

  const diag = svc.getDiagnostics();
  assert.equal(diag.cache.misses, 1);
  assert.equal(diag.cache.hits, 1);
});

test('Cache: clock-skew tolerance (+10s, +30s accepted; +31s future, expired, invalid, missing rejected)', async () => {
  const clock = makeClock();
  const store = md.createMemoryMarketCacheStore(clock.now);
  const fetchState = makeFetch({
    coinstats: () => json(coinstatsBody(SOL_TOKEN, { price: 8.88, marketCap: 88_800_000 })),
    dex: () => json({ pairs: [] }),
  });
  const { svc } = makeService({
    clock,
    store,
    fetchState,
    env: { COINSTATS_ENABLED: 'true', COINSTATS_API_KEY: KEY, MARKET_DATA_CACHE_TTL_SECONDS: '30', MARKET_DATA_STALE_TTL_SECONDS: '180' },
  });

  const key = md.marketCacheKey(solToken);
  const putRecord = async (fetchedAt, price = 2.0) => {
    await store.set(
      key,
      JSON.stringify({
        v: 1,
        origin: 'COINSTATS',
        data: {
          chain: 'SOL',
          contractAddress: SOL_TOKEN,
          price,
          marketCap: 20_000_000,
          volume24h: 1000,
          priceChange24h: 5,
          liquidity: null,
          imageUrl: null,
          fetchedAt,
        },
      }),
      300
    );
  };

  // 1. Valid current timestamp -> Accepted as CACHED
  await putRecord(new Date(clock.now()).toISOString(), 2.0);
  const currentHit = await svc.getMarketData(solToken);
  assert.equal(currentHit.status, 'CACHED');
  assert.equal(currentHit.price, 2.0);
  assert.equal(fetchState.count('COINSTATS'), 0);

  // 2. Minor future clock skew (+10s and +30s boundary) -> Accepted as CACHED
  await putRecord(new Date(clock.now() + 10_000).toISOString(), 2.1);
  const skew10 = await svc.getMarketData(solToken);
  assert.equal(skew10.status, 'CACHED');
  assert.equal(skew10.price, 2.1);

  await putRecord(new Date(clock.now() + 30_000).toISOString(), 2.3);
  const skew30 = await svc.getMarketData(solToken);
  assert.equal(skew30.status, 'CACHED');
  assert.equal(skew30.price, 2.3);
  assert.equal(fetchState.count('COINSTATS'), 0);

  // 3. Future timestamp beyond tolerance (+31s) -> Rejected (never returned as CACHED; triggers fresh provider fetch)
  await putRecord(new Date(clock.now() + 31_000).toISOString(), 99.99);
  const beyondSkew = await svc.getMarketData(solToken);
  assert.equal(beyondSkew.status, 'LIVE');
  assert.equal(beyondSkew.price, 8.88, 'Future-dated cached record must be rejected and refetched');
  assert.equal(fetchState.count('COINSTATS'), 1);

  // 4. Expired cache entry (> 180s stale TTL) -> Rejected
  await putRecord(new Date(clock.now() - 181_000).toISOString(), 77.77);
  const expired = await svc.getMarketData(solToken);
  assert.equal(expired.status, 'LIVE');
  assert.equal(expired.price, 8.88);
  assert.equal(fetchState.count('COINSTATS'), 2);

  // 5. Invalid date -> Rejected
  await putRecord('not-a-valid-date', 66.66);
  const invalidDate = await svc.getMarketData(solToken);
  assert.equal(invalidDate.status, 'LIVE');
  assert.equal(invalidDate.price, 8.88);
  assert.equal(fetchState.count('COINSTATS'), 3);

  // 6. Missing date -> Rejected
  await putRecord(null, 55.55);
  const missingDate = await svc.getMarketData(solToken);
  assert.equal(missingDate.status, 'LIVE');
  assert.equal(missingDate.price, 8.88);
  assert.equal(fetchState.count('COINSTATS'), 4);
});

test('Cache: chain and contract address isolation prevents cross-token collisions', async () => {
  const clock = makeClock();
  const store = md.createMemoryMarketCacheStore(clock.now);
  const fetchState = makeFetch({
    coinstats: (url) => {
      if (url.includes(encodeURIComponent(SOL_TOKEN))) {
        return json(coinstatsBody(SOL_TOKEN, { blockchain: 'solana', price: 1.11, marketCap: 1_110_000 }));
      }
      if (url.includes(encodeURIComponent(EVM_LOWER))) {
        return json(coinstatsBody(EVM_CHECKSUM, { blockchain: 'ethereum', entryCa: EVM_CHECKSUM, price: 2.22, marketCap: 2_220_000 }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
    dex: () => json({ pairs: [] }),
  });
  const { svc } = makeService({ clock, store, fetchState });

  const solRes = await svc.getMarketData(solToken);
  const ethRes = await svc.getMarketData({ chain: 'ETH', contractAddress: EVM_CHECKSUM });
  assert.equal(solRes.price, 1.11);
  assert.equal(ethRes.price, 2.22);

  // Even if someone tampers with the underlying store to put ETH data under SOL's key, readCache rejects it
  const tamperedKey = md.marketCacheKey(solToken);
  await store.set(
    tamperedKey,
    JSON.stringify({
      v: 1,
      origin: 'COINSTATS',
      data: {
        chain: 'ETH',
        contractAddress: EVM_LOWER,
        price: 999,
        marketCap: 999_000_000,
        volume24h: 100,
        priceChange24h: 1,
        liquidity: null,
        imageUrl: null,
        fetchedAt: new Date(clock.now()).toISOString(),
      },
    }),
    180
  );

  const afterTamper = await svc.getMarketData(solToken);
  assert.equal(afterTamper.chain, 'SOL');
  assert.equal(afterTamper.contractAddress, SOL_TOKEN);
  assert.equal(afterTamper.price, 1.11, 'Mismatched cached token must be rejected and refetched');
});

test('Cache: Redis/store outage is handled gracefully without breaking market data retrieval', async () => {
  const brokenStore = {
    async get() {
      throw new Error('Redis connection refused');
    },
    async set() {
      throw new Error('Redis connection refused');
    },
    async lock() {
      throw new Error('Redis connection refused');
    },
    async unlock() {
      throw new Error('Redis connection refused');
    },
    stats: () => ({ backend: 'redis', errors: 4 }),
  };

  const fetchState = makeFetch({
    coinstats: () => json(coinstatsBody(SOL_TOKEN, { price: 0.75, marketCap: 7_500_000 })),
    dex: () => json({ pairs: [] }),
  });
  const { svc } = makeService({ store: brokenStore, fetchState });

  const res = await svc.getMarketData(solToken);
  assert.equal(res.status, 'LIVE');
  assert.equal(res.price, 0.75);
  assert.ok(svc.getDiagnostics().cache.storeErrors >= 3);
});

test('Cache: simultaneous requests for the same token share a single in-flight provider request', async () => {
  const fetchState = makeFetch({
    coinstats: async () => {
      await new Promise((r) => setTimeout(r, 15));
      return json(coinstatsBody(SOL_TOKEN, { price: 4.5, marketCap: 45_000_000 }));
    },
    dex: () => json({ pairs: [] }),
  });
  const { svc } = makeService({ fetchState });

  const [a, b, c] = await Promise.all([
    svc.getMarketData(solToken),
    svc.getMarketData(solToken),
    svc.getMarketData(solToken),
  ]);

  assert.equal(fetchState.count('COINSTATS'), 1, 'Concurrent calls must deduplicate into 1 provider request');
  assert.equal(a.price, 4.5);
  assert.equal(b.price, 4.5);
  assert.equal(c.price, 4.5);
});

// ---------------------------------------------------------------------------
// 3. View Projection, UI Formatting & Diagnostics Secret Safety
// ---------------------------------------------------------------------------

test('View & UI: applyMarketData and MarketDataBadge helpers never fabricate $0 or 0% for missing values', () => {
  const baseItem = {
    id: 'call-1',
    ticker: '$TEST',
    chain: 'SOL',
    ca: SOL_TOKEN,
    marketCap: '$500K',
    marketCapUsd: 500_000,
    entryMarketCapUsd: 500_000,
    change24hPct: null,
    calledAt: '2026-01-01T00:00:00.000Z',
    caller: 'Admin',
    status: 'LIVE',
    statusLabel: 'ACTIVE',
    outcome: 'NEUTRAL',
    tier: 'PRO',
    takeProfits: [],
    stopLoss: '-25%',
  };

  // Partial live data (price valid, marketCap & priceChange24h null)
  const partial = applyMarketData(baseItem, {
    chain: 'SOL',
    contractAddress: SOL_TOKEN,
    price: 0.01,
    marketCap: null,
    volume24h: 1000,
    priceChange24h: null,
    liquidity: null,
    imageUrl: null,
    status: 'LIVE',
    provider: 'COINSTATS',
    originProvider: 'COINSTATS',
    fetchedAt: '2026-01-01T00:01:00.000Z',
    isFallback: false,
  });
  assert.equal(partial.marketCap, '—');
  assert.equal(partial.marketCapUsd, 0);
  assert.equal(partial.volume24h, '$1.0K');
  assert.equal(partial.change24hPct, null);
  assert.equal(partial.dataFreshness, 'LIVE');
  assert.equal(partial.marketDataSource, 'COINSTATS');
  assert.equal(formatChangePct(partial.change24hPct), '—');

  // Unavailable data for a supported token preserves entryMarketCap, sets current marketCap/volume24h to '—', and drops 24h change
  const unavail = applyMarketData(baseItem, null);
  assert.equal(unavail.dataFreshness, 'UNAVAILABLE');
  assert.equal(unavail.marketDataSource, null);
  assert.equal(unavail.entryMarketCap, '$500K');
  assert.equal(unavail.marketCap, '—');
  assert.equal(unavail.marketCapUsd, 0);
  assert.equal(unavail.volume24h, '—');
  assert.equal(unavail.change24hPct, null);
  assert.equal(formatChangePct(unavail.change24hPct), '—');

  // Unsupported chain (e.g. ROBINHOOD or missing CA) -> MANUAL keeps admin-entered values
  assert.equal(isMarketDataSupported('ROBINHOOD', 'HOOD'), false);
  const manual = applyMarketData({ ...baseItem, chain: 'ROBINHOOD', ca: '' }, null);
  assert.equal(manual.dataFreshness, 'MANUAL');
  assert.equal(manual.marketDataSource, 'RECORDED');
  assert.equal(manual.marketCap, '$500K');

  // Sorting places null 24h change after negative numbers
  assert.ok(compareChangeDesc({ change24hPct: -50 }, { change24hPct: null }) < 0);
  assert.ok(compareChangeDesc({ change24hPct: null }, { change24hPct: -50 }) > 0);
  assert.equal(compareChangeDesc({ change24hPct: null }, { change24hPct: null }), 0);
});

test('View & UI: hydrateAlphaItems projects telemetry across all items consistently', async () => {
  const items = [
    {
      id: 'sol-1',
      ticker: '$SOL1',
      chain: 'SOL',
      ca: SOL_TOKEN,
      marketCap: '$100K',
      marketCapUsd: 100_000,
      entryMarketCap: '$100K',
      entryMarketCapUsd: 100_000,
      volume24h: '—',
      change24hPct: null,
    },
    {
      id: 'robin-1',
      ticker: '$HOOD',
      chain: 'ROBIN',
      ca: '',
      marketCap: '$250K',
      marketCapUsd: 250_000,
      entryMarketCap: '$250K',
      entryMarketCapUsd: 250_000,
      volume24h: '—',
      change24hPct: null,
    },
  ];

  const hydrated = await hydrateAlphaItems(items, async () => ({
    chain: 'SOL',
    contractAddress: SOL_TOKEN,
    price: 1.5,
    marketCap: 1_500_000,
    volume24h: 250_000,
    priceChange24h: 45,
    liquidity: 100_000,
    imageUrl: 'https://cdn.dexscreener.com/logo.png',
    status: 'LIVE',
    provider: 'DEXSCREENER',
    originProvider: 'DEXSCREENER',
    fetchedAt: '2026-01-01T00:02:00.000Z',
    isFallback: true,
  }));

  assert.equal(hydrated[0].dataFreshness, 'LIVE');
  assert.equal(hydrated[0].marketDataSource, 'DEXSCREENER');
  assert.equal(hydrated[0].marketCap, '$1.50M');
  assert.equal(hydrated[0].volume24h, '$250.0K');
  assert.equal(hydrated[0].change24hPct, 45);
  assert.equal(hydrated[0].logoUrl, 'https://cdn.dexscreener.com/logo.png');

  assert.equal(hydrated[1].dataFreshness, 'MANUAL');
  assert.equal(hydrated[1].marketDataSource, 'RECORDED');
  assert.equal(hydrated[1].marketCap, '$250K');
});

test('Diagnostics: never leaks COINSTATS_API_KEY in logs or diagnostics output', async () => {
  const fetchState = makeFetch({
    coinstats: () => json({ message: `bad key ${KEY}` }, 401),
    dex: () => json(dexBody([dexPair({ base: SOL_TOKEN })])),
  });
  const { svc, logs } = makeService({ fetchState });

  await svc.getMarketData(solToken);
  const diagJson = JSON.stringify(svc.getDiagnostics());
  const logsJoined = logs.join('\n');

  assert.equal(diagJson.includes(KEY), false, 'API key must never appear in diagnostics');
  assert.equal(logsJoined.includes(KEY), false, 'API key must never appear in server logs');
});
