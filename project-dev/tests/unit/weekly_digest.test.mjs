import test from 'node:test';
import assert from 'node:assert/strict';

const { generateWeeklyPerformanceDigest, formatTelegramDigest } = await import(
  '../../src/lib/ledger/digest.ts'
);

const NOW = new Date('2026-11-15T12:00:00.000Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();

const entries = [
  { ticker: 'AAA', chain: 'solana', contract_address: 'CA_AAA_1111', multiplier: '4.5000', closed_at: daysAgo(1) },
  { ticker: 'BBB', chain: 'base', contract_address: '0xBBB', multiplier: '0.6000', closed_at: daysAgo(3) },
  { ticker: 'CCC', chain: 'solana', contract_address: 'CA_CCC', multiplier: '2.0000', closed_at: daysAgo(6) },
  // Outside the 7-day window: must be excluded
  { ticker: 'OLD', chain: 'solana', contract_address: 'CA_OLD', multiplier: '50.0000', closed_at: daysAgo(9) },
  // Excluded categories
  { ticker: 'WCH', chain: 'solana', contract_address: 'CA_W', multiplier: '9.0000', closed_at: daysAgo(1), callType: 'WATCHLIST' },
  { ticker: 'CXL', chain: 'solana', contract_address: 'CA_X', multiplier: '9.0000', closed_at: daysAgo(1), status: 'CANCELLED' },
  // Missing closed_at: excluded
  { ticker: 'NOD', chain: 'solana', contract_address: 'CA_N', multiplier: '3.0000' },
];

test('Digest: enforces the 7-day window and excludes WATCHLIST / CANCELLED / undated entries', () => {
  const d = generateWeeklyPerformanceDigest(entries, 'PRO', NOW);
  assert.equal(d.resolvedCalls, 3);
  assert.equal(d.profitableCalls, 2);
  assert.equal(d.losses, 1);
  assert.equal(d.winRateFormatted, '66.7%');
  assert.equal(d.topMultiplier, 4.5);
  assert.deepEqual(d.calls.map((c) => c.ticker), ['$AAA', '$CCC', '$BBB']);
  assert.equal(d.calls[0].contractAddress, 'CA_AAA_1111');
  assert.equal(d.isSanitized, false);
});

test('Digest: FREE tier gets the sanitized variant (masked tickers, no contract addresses)', () => {
  const d = generateWeeklyPerformanceDigest(entries, 'FREE', NOW);
  assert.equal(d.isSanitized, true);
  assert.deepEqual(d.calls.map((c) => c.ticker), ['$A***', '$C***', '$B***']);
  assert.ok(d.calls.every((c) => c.contractAddress === null));
  // Aggregate stats are identical across tiers
  assert.equal(d.winRateFormatted, '66.7%');
});

test('Digest: empty window yields null top multiple and em-dash win rate', () => {
  const d = generateWeeklyPerformanceDigest([entries[3]], 'MEMBER', NOW);
  assert.equal(d.resolvedCalls, 0);
  assert.equal(d.topMultiplier, null);
  assert.equal(d.calls.length, 0);
});

test('Digest: Telegram formatter escapes HTML and omits CAs when sanitized', () => {
  const pro = formatTelegramDigest(
    generateWeeklyPerformanceDigest(
      [{ ticker: '<X&Y>', chain: 'solana', contract_address: 'CA<1>', multiplier: '2', closed_at: daysAgo(1) }],
      'PRO',
      NOW
    )
  );
  assert.ok(pro.includes('$&lt;X&amp;Y&gt;'));
  assert.ok(pro.includes('<code>CA&lt;1&gt;</code>'));

  const free = formatTelegramDigest(generateWeeklyPerformanceDigest(entries, 'FREE', NOW));
  assert.ok(!free.includes('<code>'));
  assert.ok(free.includes('Free preview'));
});
