import test from 'node:test';
import assert from 'node:assert/strict';
import { getGenesisPrice, FALLBACK_GENESIS_PRICE } from '../../src/server/price.ts';

test('Price Oracle: getGenesisPrice returns valid result structure', async () => {
  const result = await getGenesisPrice();

  assert.ok(typeof result.priceUsd === 'number');
  assert.ok(result.priceUsd > 0, 'Price must be greater than zero');
  assert.ok(
    ['jupiter', 'dexscreener', 'cached', 'fallback', 'unavailable'].includes(result.source),
    `Unknown source: ${result.source}`
  );
  assert.ok(typeof result.isFresh === 'boolean');
  assert.ok(typeof result.timestamp === 'string');
});

test('Price Oracle: Cached price returned within TTL', async () => {
  // First call may fetch or fallback
  const first = await getGenesisPrice();
  // Second call within TTL should return cached
  const second = await getGenesisPrice();

  assert.equal(first.priceUsd, second.priceUsd);
  assert.ok(second.source === 'cached' || second.source === first.source);
});

test('Price Oracle: Fallback constant is well-defined and positive', () => {
  assert.equal(FALLBACK_GENESIS_PRICE, 0.0000164);
  assert.ok(FALLBACK_GENESIS_PRICE > 0);
});
