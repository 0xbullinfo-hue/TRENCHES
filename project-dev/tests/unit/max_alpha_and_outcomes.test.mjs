import test from 'node:test';
import assert from 'node:assert/strict';
import { alphasForTier } from '../../src/server/alphas-data.ts';

test('Max Alpha and Outcome Resolution: correctly reflects isMaxAlpha and outcome states', async () => {
  const mockCalls = [
    {
      id: 'test-call-1',
      name: 'Alpha One',
      ticker: '$A1',
      chain: 'SOL',
      quoteToken: 'SOL',
      status: 'LIVE',
      statusLabel: 'PRIORITY CALL',
      category: 'NEW',
      allocationLabel: 'Allocation',
      allocation: '10 SOL',
      risk: 3,
      riskRewardRatio: '1:4 R:R',
      stopLoss: '-25% SL',
      takeProfits: [{ label: '2x', multiple: 2, hit: false }],
      pinned: true,
      entryMarketCap: '$100K',
      entryMarketCapUsd: 100000,
      minTier: 'LAB_MEMBER',
      ca: '11111111111111111111111111111111',
      links: [],
      summary: 'Test summary',
      marketCap: '$200K',
      marketCapUsd: 200000,
      volume24h: '$50K',
      netInflow24h: '+$10K',
      change24hPct: 100,
      age: '10m',
      ageMinutes: 10,
      caller: '@Admin',
      callerWinRate: '80%',
      deployedVia: 'https://trenchlabshq.xyz',
      sparkline: [],
      art: {
        bgFrom: '#000',
        bgTo: '#111',
        accent: '#34D399',
        secondary: '#6EE7B7',
        motif: 'pill',
      },
      // Call 1: Max Alpha active, Marked as Achieved (In Profit)
      isMaxAlpha: true,
      outcome: 'PROFIT',
    },
    {
      id: 'test-call-2',
      name: 'Alpha Two',
      ticker: '$A2',
      chain: 'SOL',
      quoteToken: 'SOL',
      status: 'LIVE',
      statusLabel: 'LIVE CALL',
      category: 'NEW',
      allocationLabel: 'Allocation',
      allocation: '10 SOL',
      risk: 4,
      riskRewardRatio: '1:3 R:R',
      stopLoss: '-20% SL',
      takeProfits: [{ label: '2x', multiple: 2, hit: true }],
      pinned: false,
      entryMarketCap: '$50K',
      entryMarketCapUsd: 50000,
      minTier: 'LAB_MEMBER',
      ca: '22222222222222222222222222222222',
      links: [],
      summary: 'Test summary',
      marketCap: '$40K',
      marketCapUsd: 40000,
      volume24h: '$20K',
      netInflow24h: '-$5K',
      change24hPct: -20,
      age: '30m',
      ageMinutes: 30,
      caller: '@Admin',
      callerWinRate: '80%',
      deployedVia: 'https://trenchlabshq.xyz',
      sparkline: [],
      art: {
        bgFrom: '#000',
        bgTo: '#111',
        accent: '#34D399',
        secondary: '#6EE7B7',
        motif: 'pill',
      },
      // Call 2: Marked by admin as At Loss (even if TP was previously hit)
      isMaxAlpha: false,
      outcome: 'LOSS',
    },
    {
      id: 'test-call-3',
      name: 'Alpha Three',
      ticker: '$A3',
      chain: 'SOL',
      quoteToken: 'SOL',
      status: 'LIVE',
      statusLabel: 'LIVE CALL',
      category: 'NEW',
      allocationLabel: 'Allocation',
      allocation: '10 SOL',
      risk: 2,
      riskRewardRatio: '1:5 R:R',
      stopLoss: '-15% SL',
      takeProfits: [{ label: '2x', multiple: 2, hit: false }],
      pinned: false,
      entryMarketCap: '$100K',
      entryMarketCapUsd: 100000,
      minTier: 'LAB_MEMBER',
      ca: '33333333333333333333333333333333',
      links: [],
      summary: 'Test summary',
      marketCap: '$110K',
      marketCapUsd: 110000,
      volume24h: '$15K',
      netInflow24h: '+$2K',
      change24hPct: 10,
      age: '5m',
      ageMinutes: 5,
      caller: '@Admin',
      callerWinRate: '80%',
      deployedVia: 'https://trenchlabshq.xyz',
      sparkline: [],
      art: {
        bgFrom: '#000',
        bgTo: '#111',
        accent: '#34D399',
        secondary: '#6EE7B7',
        motif: 'pill',
      },
      // Call 3: Unmarked outcome (Pending / Open)
      isMaxAlpha: false,
      outcome: 'PENDING',
    },
  ];

  // Member tier: Max Alpha calls are strictly hidden from standard members
  const memberResults = await alphasForTier('LAB_MEMBER', Date.now(), mockCalls);
  assert.equal(memberResults.find((r) => r.id === 'test-call-1'), undefined, 'Max Alpha call must NOT be visible to standard LAB_MEMBER');

  // Pro tier & Admin: Max Alpha calls are visible
  const proResults = await alphasForTier('PRO', Date.now(), mockCalls);
  const call1 = proResults.find((r) => r.id === 'test-call-1');
  assert.ok(call1, 'Call 1 should exist for PRO viewer');
  assert.equal(call1.isMaxAlpha, true, 'Call 1 should be marked as Max Alpha');
  assert.equal(call1.outcome, 'PROFIT', 'Call 1 outcome should be PROFIT (Achieved)');

  // Call 2
  const call2 = memberResults.find((r) => r.id === 'test-call-2');
  assert.ok(call2, 'Call 2 should exist');
  assert.equal(call2.isMaxAlpha, false, 'Call 2 should NOT be Max Alpha');
  assert.equal(call2.outcome, 'LOSS', 'Call 2 outcome should be LOSS (At Loss) despite TP hit');

  // Call 3
  const call3 = memberResults.find((r) => r.id === 'test-call-3');
  assert.ok(call3, 'Call 3 should exist');
  assert.equal(call3.isMaxAlpha, false, 'Call 3 should NOT be Max Alpha');
  assert.equal(call3.outcome, 'PENDING', 'Call 3 outcome should be PENDING (Open)');
});

test('Card Outline: isMaxAlpha triggers unique orange outline indicator', () => {
  const getOutlineClass = (call) => {
    if (call.isMaxAlpha) {
      return 'border-2 border-orange-500 shadow-[0_0_20px_rgba(249,115,22,0.35)] ring-1 ring-orange-500/50 hover:border-orange-400';
    }
    if (call.pinned) {
      return 'border-2 border-pump hover:border-pump-hover';
    }
    return 'border border-line hover:border-pump';
  };

  const normalCall = { isMaxAlpha: false, pinned: false };
  const pinnedCall = { isMaxAlpha: false, pinned: true };
  const maxAlphaCall = { isMaxAlpha: true, pinned: false };
  const maxAlphaAndPinnedCall = { isMaxAlpha: true, pinned: true };

  assert.ok(getOutlineClass(normalCall).includes('border-line'));
  assert.ok(getOutlineClass(pinnedCall).includes('border-pump'));
  assert.ok(getOutlineClass(maxAlphaCall).includes('border-orange-500'));
  assert.ok(getOutlineClass(maxAlphaAndPinnedCall).includes('border-orange-500'), 'Max Alpha orange outline takes precedence');
});

