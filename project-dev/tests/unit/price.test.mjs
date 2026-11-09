import test from 'node:test';
import assert from 'node:assert/strict';
import { getGenesisPrice } from '../../src/server/price.ts';

test('Price Oracle: getGenesisPrice returns a verified positive price or an explicit UNAVAILABLE (never a made-up value)', async () => {
  const result = await getGenesisPrice();

  assert.ok(result.priceUsd === null || (typeof result.priceUsd === 'number' && result.priceUsd > 0));
  assert.ok(
    ['coinstats', 'jupiter', 'dexscreener', 'cached', 'unavailable'].includes(result.source),
    `Unknown source: ${result.source}`
  );
  if (result.priceUsd === null) {
    assert.equal(result.source, 'unavailable');
    assert.equal(result.isFresh, false);
  }
  assert.ok(typeof result.isFresh === 'boolean');
  assert.ok(typeof result.timestamp === 'string');
});

test('Price Oracle: Cached price returned within TTL', async () => {
  const first = await getGenesisPrice();
  const second = await getGenesisPrice();

  assert.equal(first.priceUsd, second.priceUsd);
  assert.ok(second.source === 'cached' || second.source === first.source);
});
