import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  alphasForTier,
  getCallType,
} from '../../src/server/alphas-data.ts';
import { TIERS } from '../../src/lib/tiers.ts';

test('Dashboard Tabs & Classification: getCallType defaults legacy calls properly (§6)', () => {
  // Legacy record without callType or isMaxAlpha defaults to ALPHA
  assert.equal(getCallType({}), 'ALPHA');
  assert.equal(getCallType({ isMaxAlpha: false }), 'ALPHA');

  // Legacy record with isMaxAlpha=true defaults to MAX_ALPHA
  assert.equal(getCallType({ isMaxAlpha: true }), 'MAX_ALPHA');

  // Explicit classifications are authoritative
  assert.equal(getCallType({ callType: 'ALPHA', isMaxAlpha: true }), 'ALPHA');
  assert.equal(getCallType({ callType: 'WATCHLIST', isMaxAlpha: false }), 'WATCHLIST');
  assert.equal(getCallType({ callType: 'MAX_ALPHA', isMaxAlpha: false }), 'MAX_ALPHA');
});

test('Backend Membership Matrix: FREE user receives 0 alpha, watchlist, or max alpha records (§2 & §7)', async () => {
  const dummyRegistry = [
    {
      id: 'call-1',
      name: 'Alpha Token',
      ticker: '$ALPHA',
      chain: 'SOL',
      quoteToken: 'SOL',
      status: 'LIVE',
      statusLabel: 'LIVE CALL',
      category: 'NEW',
      allocationLabel: 'Allocation',
      allocation: '15.0 SOL',
      risk: 3,
      riskRewardRatio: '1:4 R:R',
      stopLoss: '-25% SL',
      takeProfits: [],
      pinned: false,
      entryMarketCap: '$400K',
      entryMarketCapUsd: 400000,
      minTier: 'LAB_MEMBER',
      ca: '11111111111111111111111111111111',
      links: [],
      summary: 'Test summary',
      marketCap: '$450K',
      marketCapUsd: 450000,
      volume24h: '$100K',
      netInflow24h: '—',
      change24hPct: 10,
      age: '10m',
      ageMinutes: 10,
      caller: '@Tester',
      callerWinRate: '—',
      deployedVia: 'web',
      sparkline: [],
      art: { bgFrom: '#000', bgTo: '#111', accent: '#0f0', secondary: '#0a0', motif: 'pill' },
      callType: 'ALPHA',
    },
    {
      id: 'call-2',
      name: 'Max Alpha Token',
      ticker: '$MAX',
      chain: 'SOL',
      quoteToken: 'SOL',
      status: 'LIVE',
      statusLabel: 'LIVE CALL',
      category: 'NEW',
      allocationLabel: 'Allocation',
      allocation: '15.0 SOL',
      risk: 4,
      riskRewardRatio: '1:4 R:R',
      stopLoss: '-25% SL',
      takeProfits: [],
      pinned: false,
      entryMarketCap: '$500K',
      entryMarketCapUsd: 500000,
      minTier: 'PRO',
      ca: '22222222222222222222222222222222',
      links: [],
      summary: 'Test summary',
      marketCap: '$600K',
      marketCapUsd: 600000,
      volume24h: '$200K',
      netInflow24h: '—',
      change24hPct: 20,
      age: '5m',
      ageMinutes: 5,
      caller: '@Tester',
      callerWinRate: '—',
      deployedVia: 'web',
      sparkline: [],
      art: { bgFrom: '#000', bgTo: '#111', accent: '#f00', secondary: '#a00', motif: 'pill' },
      callType: 'MAX_ALPHA',
      isMaxAlpha: true,
    },
    {
      id: 'call-3',
      name: 'Watchlist Token',
      ticker: '$WATCH',
      chain: 'SOL',
      quoteToken: 'SOL',
      status: 'LIVE',
      statusLabel: 'LIVE CALL',
      category: 'NEW',
      allocationLabel: 'Allocation',
      allocation: '15.0 SOL',
      risk: 2,
      riskRewardRatio: '1:4 R:R',
      stopLoss: '-25% SL',
      takeProfits: [],
      pinned: false,
      entryMarketCap: '$1M',
      entryMarketCapUsd: 1000000,
      minTier: 'PRO',
      ca: '33333333333333333333333333333333',
      links: [],
      summary: 'Test summary',
      marketCap: '$1.1M',
      marketCapUsd: 1100000,
      volume24h: '$500K',
      netInflow24h: '—',
      change24hPct: 5,
      age: '1h',
      ageMinutes: 60,
      caller: '@Tester',
      callerWinRate: '—',
      deployedVia: 'web',
      sparkline: [],
      art: { bgFrom: '#000', bgTo: '#111', accent: '#ff0', secondary: '#aa0', motif: 'pill' },
      callType: 'WATCHLIST',
    },
  ];

  // FREE user (rank 0 / LOCKED) must receive an empty array
  const freeItems = await alphasForTier('LOCKED', Date.now(), dummyRegistry, false);
  assert.equal(freeItems.length, 0, 'FREE users must never receive any trade calls from the backend');
});

test('Backend Membership Matrix: MEMBER user receives ALPHA calls only, never WATCHLIST or MAX_ALPHA (§2 & §7)', async () => {
  const dummyRegistry = [
    {
      id: 'call-1',
      name: 'Alpha Token',
      ticker: '$ALPHA',
      chain: 'SOL',
      quoteToken: 'SOL',
      status: 'LIVE',
      statusLabel: 'LIVE CALL',
      category: 'NEW',
      allocationLabel: 'Allocation',
      allocation: '15.0 SOL',
      risk: 3,
      riskRewardRatio: '1:4 R:R',
      stopLoss: '-25% SL',
      takeProfits: [],
      pinned: false,
      entryMarketCap: '$400K',
      entryMarketCapUsd: 400000,
      minTier: 'LAB_MEMBER',
      ca: '11111111111111111111111111111111',
      links: [],
      summary: 'Test summary',
      marketCap: '$450K',
      marketCapUsd: 450000,
      volume24h: '$100K',
      netInflow24h: '—',
      change24hPct: 10,
      age: '10m',
      ageMinutes: 10,
      caller: '@Tester',
      callerWinRate: '—',
      deployedVia: 'web',
      sparkline: [],
      art: { bgFrom: '#000', bgTo: '#111', accent: '#0f0', secondary: '#0a0', motif: 'pill' },
      callType: 'ALPHA',
    },
    {
      id: 'call-2',
      name: 'Max Alpha Token',
      ticker: '$MAX',
      chain: 'SOL',
      quoteToken: 'SOL',
      status: 'LIVE',
      statusLabel: 'LIVE CALL',
      category: 'NEW',
      allocationLabel: 'Allocation',
      allocation: '15.0 SOL',
      risk: 4,
      riskRewardRatio: '1:4 R:R',
      stopLoss: '-25% SL',
      takeProfits: [],
      pinned: false,
      entryMarketCap: '$500K',
      entryMarketCapUsd: 500000,
      minTier: 'PRO',
      ca: '22222222222222222222222222222222',
      links: [],
      summary: 'Test summary',
      marketCap: '$600K',
      marketCapUsd: 600000,
      volume24h: '$200K',
      netInflow24h: '—',
      change24hPct: 20,
      age: '5m',
      ageMinutes: 5,
      caller: '@Tester',
      callerWinRate: '—',
      deployedVia: 'web',
      sparkline: [],
      art: { bgFrom: '#000', bgTo: '#111', accent: '#f00', secondary: '#a00', motif: 'pill' },
      callType: 'MAX_ALPHA',
      isMaxAlpha: true,
    },
    {
      id: 'call-3',
      name: 'Watchlist Token',
      ticker: '$WATCH',
      chain: 'SOL',
      quoteToken: 'SOL',
      status: 'LIVE',
      statusLabel: 'LIVE CALL',
      category: 'NEW',
      allocationLabel: 'Allocation',
      allocation: '15.0 SOL',
      risk: 2,
      riskRewardRatio: '1:4 R:R',
      stopLoss: '-25% SL',
      takeProfits: [],
      pinned: false,
      entryMarketCap: '$1M',
      entryMarketCapUsd: 1000000,
      minTier: 'PRO',
      ca: '33333333333333333333333333333333',
      links: [],
      summary: 'Test summary',
      marketCap: '$1.1M',
      marketCapUsd: 1100000,
      volume24h: '$500K',
      netInflow24h: '—',
      change24hPct: 5,
      age: '1h',
      ageMinutes: 60,
      caller: '@Tester',
      callerWinRate: '—',
      deployedVia: 'web',
      sparkline: [],
      art: { bgFrom: '#000', bgTo: '#111', accent: '#ff0', secondary: '#aa0', motif: 'pill' },
      callType: 'WATCHLIST',
    },
  ];

  const memberItems = await alphasForTier('LAB_MEMBER', Date.now(), dummyRegistry, false);
  assert.equal(memberItems.length, 1, 'MEMBER should only receive 1 item');
  assert.equal(memberItems[0].ticker, '$ALPHA');
  assert.equal(memberItems[0].callType, 'ALPHA');

  // Verify MAX_ALPHA and WATCHLIST are strictly excluded
  assert.ok(!memberItems.some((it) => it.callType === 'MAX_ALPHA'), 'MAX_ALPHA must not leak to MEMBER');
  assert.ok(!memberItems.some((it) => it.callType === 'WATCHLIST'), 'WATCHLIST must not leak to MEMBER');
  assert.ok(!memberItems.some((it) => it.isMaxAlpha), 'isMaxAlpha must not leak to MEMBER');
});

test('Backend Membership Matrix: PRO user & Admin receive all four categories (§2 & §7)', async () => {
  const dummyRegistry = [
    {
      id: 'call-1',
      name: 'Alpha Token',
      ticker: '$ALPHA',
      chain: 'SOL',
      quoteToken: 'SOL',
      status: 'LIVE',
      statusLabel: 'LIVE CALL',
      category: 'NEW',
      allocationLabel: 'Allocation',
      allocation: '15.0 SOL',
      risk: 3,
      riskRewardRatio: '1:4 R:R',
      stopLoss: '-25% SL',
      takeProfits: [],
      pinned: false,
      entryMarketCap: '$400K',
      entryMarketCapUsd: 400000,
      minTier: 'LAB_MEMBER',
      ca: '11111111111111111111111111111111',
      links: [],
      summary: 'Test summary',
      marketCap: '$450K',
      marketCapUsd: 450000,
      volume24h: '$100K',
      netInflow24h: '—',
      change24hPct: 10,
      age: '10m',
      ageMinutes: 10,
      caller: '@Tester',
      callerWinRate: '—',
      deployedVia: 'web',
      sparkline: [],
      art: { bgFrom: '#000', bgTo: '#111', accent: '#0f0', secondary: '#0a0', motif: 'pill' },
      callType: 'ALPHA',
    },
    {
      id: 'call-2',
      name: 'Max Alpha Token',
      ticker: '$MAX',
      chain: 'SOL',
      quoteToken: 'SOL',
      status: 'LIVE',
      statusLabel: 'LIVE CALL',
      category: 'NEW',
      allocationLabel: 'Allocation',
      allocation: '15.0 SOL',
      risk: 4,
      riskRewardRatio: '1:4 R:R',
      stopLoss: '-25% SL',
      takeProfits: [],
      pinned: false,
      entryMarketCap: '$500K',
      entryMarketCapUsd: 500000,
      minTier: 'PRO',
      ca: '22222222222222222222222222222222',
      links: [],
      summary: 'Test summary',
      marketCap: '$600K',
      marketCapUsd: 600000,
      volume24h: '$200K',
      netInflow24h: '—',
      change24hPct: 20,
      age: '5m',
      ageMinutes: 5,
      caller: '@Tester',
      callerWinRate: '—',
      deployedVia: 'web',
      sparkline: [],
      art: { bgFrom: '#000', bgTo: '#111', accent: '#f00', secondary: '#a00', motif: 'pill' },
      callType: 'MAX_ALPHA',
      isMaxAlpha: true,
    },
    {
      id: 'call-3',
      name: 'Watchlist Token',
      ticker: '$WATCH',
      chain: 'SOL',
      quoteToken: 'SOL',
      status: 'LIVE',
      statusLabel: 'LIVE CALL',
      category: 'NEW',
      allocationLabel: 'Allocation',
      allocation: '15.0 SOL',
      risk: 2,
      riskRewardRatio: '1:4 R:R',
      stopLoss: '-25% SL',
      takeProfits: [],
      pinned: false,
      entryMarketCap: '$1M',
      entryMarketCapUsd: 1000000,
      minTier: 'PRO',
      ca: '33333333333333333333333333333333',
      links: [],
      summary: 'Test summary',
      marketCap: '$1.1M',
      marketCapUsd: 1100000,
      volume24h: '$500K',
      netInflow24h: '—',
      change24hPct: 5,
      age: '1h',
      ageMinutes: 60,
      caller: '@Tester',
      callerWinRate: '—',
      deployedVia: 'web',
      sparkline: [],
      art: { bgFrom: '#000', bgTo: '#111', accent: '#ff0', secondary: '#aa0', motif: 'pill' },
      callType: 'WATCHLIST',
    },
  ];

  const proItems = await alphasForTier('PRO', Date.now(), dummyRegistry, false);
  assert.equal(proItems.length, 3, 'PRO user must receive all 3 calls');
  assert.ok(proItems.some((it) => it.callType === 'ALPHA'));
  assert.ok(proItems.some((it) => it.callType === 'MAX_ALPHA'));
  assert.ok(proItems.some((it) => it.callType === 'WATCHLIST'));

  const adminItems = await alphasForTier('LOCKED', Date.now(), dummyRegistry, true);
  assert.equal(adminItems.length, 3, 'Admin must bypass tier restrictions and receive all 3 calls');
});

test('Admin Classification & Category Moving: updating callType moves destination cleanly without duplicates (§5 & §6)', () => {
  const record = {
    id: 'post-1',
    ticker: '$TEST',
    callType: 'ALPHA',
    isMaxAlpha: false,
    minTier: 'LAB_MEMBER',
  };

  // Move from ALPHA to MAX_ALPHA
  record.callType = 'MAX_ALPHA';
  record.isMaxAlpha = true;
  record.minTier = 'PRO';

  assert.equal(getCallType(record), 'MAX_ALPHA');
  assert.equal(record.minTier, 'PRO');

  // Move from MAX_ALPHA to WATCHLIST
  record.callType = 'WATCHLIST';
  record.isMaxAlpha = false;
  record.minTier = 'PRO';

  assert.equal(getCallType(record), 'WATCHLIST');
  assert.equal(record.minTier, 'PRO');
  assert.equal(record.isMaxAlpha, false);

  // Move from WATCHLIST back to ALPHA
  record.callType = 'ALPHA';
  record.isMaxAlpha = false;
  record.minTier = 'LAB_MEMBER';

  assert.equal(getCallType(record), 'ALPHA');
  assert.equal(record.minTier, 'LAB_MEMBER');
});

test('Restriction Screen Copy Matrix (§4.1 - §4.5): verified in MembershipRestrictionScreen source', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/components/dashboard/MembershipRestrictionScreen.tsx'),
    'utf-8'
  );

  // 4.1 FREE user opening ALPHA
  assert.ok(src.includes('ALPHA CALLS'));
  assert.ok(src.includes('Access curated Alpha Calls, including token entries, market intelligence and trading opportunities.'));
  assert.ok(src.includes('Alpha Calls are available to verified Members and PRO users.'));
  assert.ok(src.includes('Upgrade to Member or PRO to unlock Alpha Calls.'));
  assert.ok(src.includes('BECOME A MEMBER'));

  // 4.2 & 4.3 WATCHLIST
  assert.ok(src.includes('Discover curated long-term projects selected by the TRENCHLABS team for ongoing monitoring.'));
  assert.ok(src.includes('WATCHLIST access is exclusive to PRO members.'));
  assert.ok(src.includes('This category is available exclusively to PRO members.'));
  assert.ok(src.includes('Upgrade your membership to PRO to unlock WATCHLIST.'));
  assert.ok(src.includes('UPGRADE TO PRO'));

  // 4.4 & 4.5 MAX ALPHA
  assert.ok(src.includes('Access premium Alpha Calls reserved for TRENCHLABS PRO members.'));
  assert.ok(src.includes('MAX ALPHA is a PRO-exclusive category.'));
  assert.ok(src.includes('Your current membership does not include MAX ALPHA access.'));
  assert.ok(src.includes('Upgrade to PRO to unlock this category.'));
});

