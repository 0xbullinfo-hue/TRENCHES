// Provider config, validation helpers and the CoinStats / DexScreener adapters (all mocked).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as md from '../../src/server/market-data.ts';
import * as cfg from '../../src/server/market-config.ts';
import {
  EVM_CHECKSUM, EVM_LOWER, EVM_OTHER, KEY, SOL_OTHER, SOL_TOKEN,
  coinstatsBody, dexBody, dexPair, evmToken, hang, json, makeFetch, makeService, solToken,
} from './helpers/market-fixtures.mjs';

const kindOf = (kind, status) => (e) => {
  assert.ok(e instanceof md.ProviderError, `expected ProviderError, got ${e}`);
  assert.equal(e.kind, kind);
  if (status !== undefined) assert.equal(e.status, status);
  return true;
};

// ------------------------------------------------------------------ configuration

test('config: defaults apply when no market env vars are set (CoinStats is optional)', () => {
  const c = cfg.getMarketProviderConfig({});
  assert.deepEqual(c, {
    coinstatsEnabled: false,
    dexscreenerEnabled: true,
    timeoutMs: 8000,
    cacheTtlSeconds: 30,
    staleTtlSeconds: 180,
  });
});

test('config: CoinStats needs BOTH the explicit flag and an API key', () => {
  assert.equal(cfg.getMarketProviderConfig({ COINSTATS_ENABLED: 'true' }).coinstatsEnabled, false);
  assert.equal(cfg.getMarketProviderConfig({ COINSTATS_API_KEY: 'k' }).coinstatsEnabled, false);
  assert.equal(cfg.getMarketProviderConfig({ COINSTATS_ENABLED: 'true', COINSTATS_API_KEY: '   ' }).coinstatsEnabled, false);
  assert.equal(cfg.getMarketProviderConfig({ COINSTATS_ENABLED: 'false', COINSTATS_API_KEY: 'k' }).coinstatsEnabled, false);
  assert.equal(cfg.getMarketProviderConfig({ COINSTATS_ENABLED: 'true', COINSTATS_API_KEY: 'k' }).coinstatsEnabled, true);
});

test('config: DexScreener stays on unless explicitly disabled', () => {
  assert.equal(cfg.getMarketProviderConfig({ DEXSCREENER_ENABLED: 'false' }).dexscreenerEnabled, false);
  assert.equal(cfg.getMarketProviderConfig({ DEXSCREENER_ENABLED: 'true' }).dexscreenerEnabled, true);
  assert.equal(cfg.getMarketProviderConfig({ DEXSCREENER_ENABLED: 'banana' }).dexscreenerEnabled, true);
});

test('config: invalid or non-positive numerics fall back to safe defaults', () => {
  for (const bad of ['abc', '-5', '0', '', 'NaN', 'Infinity', '  ']) {
    const c = cfg.getMarketProviderConfig({
      MARKET_DATA_TIMEOUT_MS: bad,
      MARKET_DATA_CACHE_TTL_SECONDS: bad,
      MARKET_DATA_STALE_TTL_SECONDS: bad,
    });
    assert.equal(c.timeoutMs, 8000, `timeout for ${JSON.stringify(bad)}`);
    assert.equal(c.cacheTtlSeconds, 30);
    assert.equal(c.staleTtlSeconds, 180);
  }
  const ok = cfg.getMarketProviderConfig({
    MARKET_DATA_TIMEOUT_MS: '1500',
    MARKET_DATA_CACHE_TTL_SECONDS: '10',
    MARKET_DATA_STALE_TTL_SECONDS: '60',
  });
  assert.deepEqual([ok.timeoutMs, ok.cacheTtlSeconds, ok.staleTtlSeconds], [1500, 10, 60]);
});

test('config: timeout is capped and the stale window is never shorter than the fresh window', () => {
  assert.equal(cfg.getMarketProviderConfig({ MARKET_DATA_TIMEOUT_MS: '999999999' }).timeoutMs, cfg.MAX_TIMEOUT_MS);
  const c = cfg.getMarketProviderConfig({ MARKET_DATA_CACHE_TTL_SECONDS: '120', MARKET_DATA_STALE_TTL_SECONDS: '30' });
  assert.equal(c.staleTtlSeconds, 120);
});

test('config: the API key is never part of the config object', () => {
  const c = cfg.getMarketProviderConfig({ COINSTATS_ENABLED: 'true', COINSTATS_API_KEY: KEY });
  assert.ok(!JSON.stringify(c).includes(KEY));
  assert.equal(cfg.getCoinStatsApiKey({ COINSTATS_API_KEY: KEY }), KEY);
  assert.equal(cfg.getCoinStatsApiKey({}), null);
});

test('config: missing CoinStats key is reported as DISABLED / NOT CONFIGURED, not as a failure', () => {
  assert.deepEqual(cfg.describeCoinStatsConfig({}), {
    state: 'DISABLED_NOT_CONFIGURED',
    label: 'CoinStats: DISABLED / NOT CONFIGURED',
  });
  assert.equal(cfg.describeCoinStatsConfig({ COINSTATS_ENABLED: 'true' }).state, 'DISABLED_NOT_CONFIGURED');
  assert.equal(cfg.describeCoinStatsConfig({ COINSTATS_API_KEY: 'k' }).state, 'DISABLED');
  assert.equal(cfg.describeCoinStatsConfig({ COINSTATS_ENABLED: 'true', COINSTATS_API_KEY: 'k' }).state, 'ENABLED');
});

// ------------------------------------------------------------------ identity / validation helpers

test('normalizeToken: EVM addresses are lower-cased, Solana addresses are case-preserved, junk is rejected', () => {
  assert.deepEqual(md.normalizeToken({ chain: 'eth', contractAddress: EVM_CHECKSUM }), { chain: 'ETH', contractAddress: EVM_LOWER });
  assert.deepEqual(md.normalizeToken({ chain: 'sol', contractAddress: ` ${SOL_TOKEN} ` }), { chain: 'SOL', contractAddress: SOL_TOKEN });
  assert.equal(md.normalizeToken({ chain: 'SOL', contractAddress: EVM_LOWER }), null);
  assert.equal(md.normalizeToken({ chain: 'ETH', contractAddress: SOL_TOKEN }), null);
  assert.equal(md.normalizeToken({ chain: 'DOGE', contractAddress: SOL_TOKEN }), null);
  assert.equal(md.normalizeToken({ chain: '', contractAddress: '' }), null);
});

test('isValidMarketData: rejects wrong token, wrong chain, bad price and corrupt optional metrics', () => {
  const good = {
    chain: 'SOL', contractAddress: SOL_TOKEN, price: 1, marketCap: 10, volume24h: 0, priceChange24h: -5,
    liquidity: null, imageUrl: null, fetchedAt: new Date().toISOString(),
  };
  assert.equal(md.isValidMarketData(good, solToken), true);
  assert.equal(md.isValidMarketData({ ...good, marketCap: null, volume24h: null, priceChange24h: null }, solToken), true, 'null optional metrics are valid');
  assert.equal(md.isValidMarketData({ ...good, contractAddress: SOL_OTHER }, solToken), false);
  assert.equal(md.isValidMarketData({ ...good, chain: 'ETH' }, solToken), false);
  for (const price of [0, -1, NaN, Infinity, '0', 'abc', null, undefined]) {
    assert.equal(md.isValidMarketData({ ...good, price }, solToken), false, `price ${String(price)}`);
  }
  assert.equal(md.isValidMarketData({ ...good, marketCap: 0 }, solToken), false);
  assert.equal(md.isValidMarketData({ ...good, volume24h: -1 }, solToken), false);
  assert.equal(md.isValidMarketData({ ...good, priceChange24h: NaN }, solToken), false);
  assert.equal(md.isValidMarketData({ ...good, fetchedAt: 'not a date' }, solToken), false);
  assert.equal(md.isValidMarketData(null, solToken), false);
  assert.equal(md.isValidMarketData('x', solToken), false);
});

test('isWithinStaleLimit: bounded window and clock-skew protection', () => {
  const now = Date.parse('2026-01-01T00:10:00.000Z');
  assert.equal(md.MAX_FUTURE_CLOCK_SKEW_MS, 30_000);
  assert.equal(md.MAX_FUTURE_CLOCK_SKEW_MS, cfg.MAX_FUTURE_CLOCK_SKEW_MS);

  // Valid current timestamp -> Accepted
  assert.equal(md.isWithinStaleLimit(new Date(now).toISOString(), now, 180), true);
  // Valid recent timestamp inside staleTtlSeconds -> Accepted
  assert.equal(md.isWithinStaleLimit('2026-01-01T00:08:00.000Z', now, 180), true);
  // Minor future clock skew (+10s and +30s boundary) -> Accepted
  assert.equal(md.isWithinStaleLimit(new Date(now + 10_000).toISOString(), now, 180), true);
  assert.equal(md.isWithinStaleLimit(new Date(now + 30_000).toISOString(), now, 180), true);
  // Future timestamp beyond tolerance (+31s) -> Rejected
  assert.equal(md.isWithinStaleLimit(new Date(now + 31_000).toISOString(), now, 180), false);
  // Expired cache entry (> 180s) -> Rejected
  assert.equal(md.isWithinStaleLimit('2026-01-01T00:06:00.000Z', now, 180), false);
  // Missing date -> Rejected
  assert.equal(md.isWithinStaleLimit(null, now, 180), false);
  assert.equal(md.isWithinStaleLimit('', now, 180), false);
  // Invalid date -> Rejected
  assert.equal(md.isWithinStaleLimit('garbage', now, 180), false);
  assert.equal(md.isWithinStaleLimit(new Date(now).toISOString(), Number.NaN, 180), false);
});

// ------------------------------------------------------------------ CoinStats adapter

test('CoinStats: uses the documented endpoint, auth header and maps the documented response', async () => {
  const f = makeFetch({ coinstats: () => json(coinstatsBody(SOL_TOKEN)) });
  const { svc } = makeService({ fetchState: f });
  const data = await svc.fetchCoinStats(solToken);

  const call = f.calls[0];
  assert.ok(call.url.startsWith('https://api.coinstats.app/v1/coins?'), call.url);
  assert.ok(call.url.includes(`contractAddresses=${SOL_TOKEN}`));
  assert.ok(call.url.includes('blockchains=solana'));
  assert.ok(call.url.includes('currency=USD'));
  assert.equal(call.headers['X-API-KEY'], KEY, 'key is sent as the X-API-KEY header');
  assert.ok(!call.url.includes(KEY), 'key must never be in the URL');

  assert.equal(data.price, 0.5);
  assert.equal(data.marketCap, 5_000_000);
  assert.equal(data.volume24h, 1234.5);
  assert.equal(data.priceChange24h, 12.5);
  assert.equal(data.liquidity, null, 'CoinStats supplies no liquidity: null, not 0');
  assert.equal(data.imageUrl, 'https://static.coinstats.app/coins/some_32.png');
  assert.equal(data.chain, 'SOL');
});

test('CoinStats: valid price with missing optional metrics keeps the price and reports the rest as null', async () => {
  const f = makeFetch({
    coinstats: () => json(coinstatsBody(SOL_TOKEN, { volume: undefined, marketCap: undefined, priceChange1d: undefined, icon: undefined })),
  });
  const { svc } = makeService({ fetchState: f });
  const data = await svc.fetchCoinStats(solToken);
  assert.equal(data.price, 0.5);
  assert.equal(data.volume24h, null);
  assert.equal(data.marketCap, null);
  assert.equal(data.priceChange24h, null);
  assert.equal(data.imageUrl, null);
});

test('CoinStats: zero / negative / non-numeric price is rejected', async () => {
  for (const price of [0, -2, 'abc', null, Infinity]) {
    const f = makeFetch({ coinstats: () => json(coinstatsBody(SOL_TOKEN, { price })) });
    const { svc } = makeService({ fetchState: f });
    await assert.rejects(() => svc.fetchCoinStats(solToken), kindOf('invalid_data'), `price=${String(price)}`);
  }
});

test('CoinStats: a coin listing a DIFFERENT contract is rejected (wrong contract address)', async () => {
  const f = makeFetch({ coinstats: () => json(coinstatsBody(SOL_TOKEN, { entryCa: SOL_OTHER })) });
  const { svc } = makeService({ fetchState: f });
  await assert.rejects(() => svc.fetchCoinStats(solToken), kindOf('no_match'));
});

test('CoinStats: the right contract on a DIFFERENT blockchain is rejected (wrong chain)', async () => {
  const f = makeFetch({ coinstats: () => json(coinstatsBody(SOL_TOKEN, { blockchain: 'ethereum' })) });
  const { svc } = makeService({ fetchState: f });
  await assert.rejects(() => svc.fetchCoinStats(solToken), kindOf('no_match'));
});

test('CoinStats: EVM addresses match case-insensitively, Solana addresses do not', async () => {
  const evm = makeFetch({ coinstats: () => json(coinstatsBody(EVM_CHECKSUM, { blockchain: 'ethereum' })) });
  const a = makeService({ fetchState: evm });
  assert.equal((await a.svc.fetchCoinStats(evmToken)).contractAddress, EVM_LOWER);

  const swapped = SOL_TOKEN.toLowerCase();
  const sol = makeFetch({ coinstats: () => json(coinstatsBody(swapped, { entryCa: swapped })) });
  const b = makeService({ fetchState: sol });
  await assert.rejects(() => b.svc.fetchCoinStats(solToken), kindOf('no_match'));
});

test('CoinStats: empty result list is no_match; one coin of several is chosen only if it matches the token', async () => {
  const f = makeFetch({ coinstats: () => json({ meta: {}, result: [] }) });
  await assert.rejects(() => makeService({ fetchState: f }).svc.fetchCoinStats(solToken), kindOf('no_match'));

  const other = coinstatsBody(SOL_OTHER, { price: 99 }).result[0];
  const mine = coinstatsBody(SOL_TOKEN, { price: 0.5 }).result[0];
  const g = makeFetch({ coinstats: () => json({ meta: {}, result: [other, mine] }) });
  assert.equal((await makeService({ fetchState: g }).svc.fetchCoinStats(solToken)).price, 0.5);
});

test('CoinStats: HTTP 401 and 403 are reported as unauthorized (invalid / expired key)', async () => {
  for (const status of [401, 403]) {
    const f = makeFetch({ coinstats: () => json({ statusCode: status, message: 'nope' }, status) });
    await assert.rejects(() => makeService({ fetchState: f }).svc.fetchCoinStats(solToken), kindOf('unauthorized', status));
  }
});

test('CoinStats: HTTP 429 is reported as rate_limited and honours Retry-After', async () => {
  const f = makeFetch({ coinstats: () => json({ message: 'Rate limit exceeded' }, 429, { 'retry-after': '120' }) });
  await assert.rejects(
    () => makeService({ fetchState: f }).svc.fetchCoinStats(solToken),
    (e) => kindOf('rate_limited', 429)(e) && e.retryAfterSec === 120
  );
});

test('CoinStats: timeout, HTTP 500 and network errors are classified', async () => {
  const slow = makeFetch({ coinstats: (_u, init) => hang(init) });
  await assert.rejects(() => makeService({ fetchState: slow, env: { MARKET_DATA_TIMEOUT_MS: '30' } }).svc.fetchCoinStats(solToken), kindOf('timeout'));

  const five = makeFetch({ coinstats: () => json({ message: 'boom' }, 500) });
  await assert.rejects(() => makeService({ fetchState: five }).svc.fetchCoinStats(solToken), kindOf('http_error', 500));

  const down = makeFetch({ coinstats: () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(() => makeService({ fetchState: down }).svc.fetchCoinStats(solToken), kindOf('network'));
});

test('CoinStats: malformed bodies are rejected (HTML, wrong shape, non-array result)', async () => {
  for (const body of ['<html>gateway</html>', { coin: { price: 1 } }, { result: 'nope' }, [], 'null']) {
    const f = makeFetch({ coinstats: () => json(body) });
    await assert.rejects(() => makeService({ fetchState: f }).svc.fetchCoinStats(solToken), kindOf('malformed'), JSON.stringify(body));
  }
});

test('CoinStats: refuses to run without a key or for an unsupported chain', async () => {
  const f = makeFetch({ coinstats: () => json(coinstatsBody(SOL_TOKEN)) });
  const noKey = makeService({ fetchState: f, env: { COINSTATS_API_KEY: '' } });
  await assert.rejects(() => noKey.svc.fetchCoinStats(solToken), kindOf('not_configured'));
  assert.equal(f.count('COINSTATS'), 0, 'no request without a key');

  const { svc } = makeService({ fetchState: f });
  await assert.rejects(() => svc.fetchCoinStats({ chain: 'ROBIN', contractAddress: 'robinhood-token-address' }), kindOf('unsupported'));
});

// ------------------------------------------------------------------ DexScreener adapter

test('DexScreener: maps a successful response; market cap is NOT inferred from FDV', async () => {
  const f = makeFetch({ dex: () => json(dexBody([dexPair()])) });
  const { svc } = makeService({ fetchState: f });
  const data = await svc.fetchDexScreener(solToken);
  assert.ok(f.calls[0].url.endsWith(`/latest/dex/tokens/${SOL_TOKEN}`));
  assert.equal(data.price, 0.25);
  assert.equal(data.marketCap, 2_000_000);
  assert.equal(data.volume24h, 50_000);
  assert.equal(data.priceChange24h, -3.5);
  assert.equal(data.liquidity, 100_000);
  assert.equal(data.imageUrl, 'https://cdn.dexscreener.com/img.png');
});

test('DexScreener: empty or null pairs are no_match', async () => {
  for (const body of [dexBody([]), dexBody(null)]) {
    const f = makeFetch({ dex: () => json(body) });
    await assert.rejects(() => makeService({ fetchState: f }).svc.fetchDexScreener(solToken), kindOf('no_match'));
  }
});

test('DexScreener: with multiple matching pairs the highest-liquidity pair is used', async () => {
  const f = makeFetch({
    dex: () => json(dexBody([
      dexPair({ priceUsd: '0.10', liquidity: { usd: 500 } }),
      dexPair({ priceUsd: '0.30', liquidity: { usd: 900_000 } }),
      dexPair({ priceUsd: '0.20', liquidity: { usd: 20_000 } }),
    ])),
  });
  const data = await makeService({ fetchState: f }).svc.fetchDexScreener(solToken);
  assert.equal(data.price, 0.3);
  assert.equal(data.liquidity, 900_000);
});

test('DexScreener: pairs on the wrong chain are rejected', async () => {
  const f = makeFetch({ dex: () => json(dexBody([dexPair({ chainId: 'ethereum' }), dexPair({ chainId: 'base' })])) });
  await assert.rejects(() => makeService({ fetchState: f }).svc.fetchDexScreener(solToken), kindOf('no_match'));
});

test('DexScreener: pairs where the token is only the QUOTE (or another token) are rejected', async () => {
  const f = makeFetch({
    dex: () => json(dexBody([
      dexPair({ base: SOL_OTHER, quote: SOL_TOKEN, priceUsd: '1.00' }), // our token is the quote: price belongs to another token
      dexPair({ base: SOL_OTHER, quote: SOL_OTHER }),
    ])),
  });
  await assert.rejects(() => makeService({ fetchState: f }).svc.fetchDexScreener(solToken), kindOf('no_match'));
});

test('DexScreener: missing liquidity keeps the data valid with liquidity = null', async () => {
  const f = makeFetch({ dex: () => json(dexBody([dexPair({ liquidity: undefined })])) });
  const data = await makeService({ fetchState: f }).svc.fetchDexScreener(solToken);
  assert.equal(data.liquidity, null);
  assert.equal(data.price, 0.25);
});

test('DexScreener: missing market cap keeps the price and reports marketCap = null (no FDV substitution)', async () => {
  const f = makeFetch({ dex: () => json(dexBody([dexPair({ marketCap: undefined, fdv: 9_999_999 })])) });
  const data = await makeService({ fetchState: f }).svc.fetchDexScreener(solToken);
  assert.equal(data.marketCap, null);
  assert.equal(data.price, 0.25);
});

test('DexScreener: invalid price on every matching pair is invalid_data', async () => {
  for (const priceUsd of ['0', '-1', 'abc', undefined]) {
    const f = makeFetch({ dex: () => json(dexBody([dexPair({ priceUsd })])) });
    await assert.rejects(() => makeService({ fetchState: f }).svc.fetchDexScreener(solToken), kindOf('invalid_data'), String(priceUsd));
  }
});

test('DexScreener: timeout, provider errors, rate limit and malformed bodies are classified', async () => {
  const slow = makeFetch({ dex: (_u, init) => hang(init) });
  await assert.rejects(() => makeService({ fetchState: slow, env: { MARKET_DATA_TIMEOUT_MS: '30' } }).svc.fetchDexScreener(solToken), kindOf('timeout'));

  const five = makeFetch({ dex: () => json({}, 503) });
  await assert.rejects(() => makeService({ fetchState: five }).svc.fetchDexScreener(solToken), kindOf('http_error', 503));

  const limited = makeFetch({ dex: () => json({}, 429) });
  await assert.rejects(() => makeService({ fetchState: limited }).svc.fetchDexScreener(solToken), kindOf('rate_limited', 429));

  const bad = makeFetch({ dex: () => json('<html>') });
  await assert.rejects(() => makeService({ fetchState: bad }).svc.fetchDexScreener(solToken), kindOf('malformed'));

  const shape = makeFetch({ dex: () => json({ pairs: 'x' }) });
  await assert.rejects(() => makeService({ fetchState: shape }).svc.fetchDexScreener(solToken), kindOf('malformed'));
});

test('DexScreener: EVM matching is case-insensitive and chain-specific', async () => {
  const f = makeFetch({ dex: () => json(dexBody([dexPair({ chainId: 'ethereum', base: EVM_CHECKSUM, quote: EVM_OTHER })])) });
  const data = await makeService({ fetchState: f }).svc.fetchDexScreener(evmToken);
  assert.equal(data.contractAddress, EVM_LOWER);
  assert.equal(data.chain, 'ETH');
});

