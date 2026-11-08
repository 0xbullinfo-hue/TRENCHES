import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStopLossPercentage,
  assessTelemetryForAlerts,
  evaluateTargets,
  runAutomatedAlertsMonitor,
} from '../../src/server/alerts-monitor.ts';
import { SOL_TOKEN, SOL_OTHER, EVM_LOWER } from './helpers/market-fixtures.mjs';

const NOW = Date.parse('2026-01-01T00:05:00.000Z');
const FRESH_ISO = new Date(NOW - 5_000).toISOString();

function makeCall(overrides = {}) {
  return {
    id: 'call-sol-1',
    ticker: '$SOLX',
    chain: 'SOL',
    ca: SOL_TOKEN,
    marketCap: '$100K',
    marketCapUsd: 100_000,
    entryMarketCapUsd: 100_000,
    change24hPct: 0,
    calledAt: '2026-01-01T00:00:00.000Z',
    caller: 'Admin',
    status: 'LIVE',
    statusLabel: 'ACTIVE',
    outcome: 'NEUTRAL',
    tier: 'PRO',
    takeProfits: [
      { label: 'TP1 (2x)', multiple: 2.0, hit: false },
      { label: 'TP2 (5x)', multiple: 5.0, hit: false },
    ],
    stopLoss: '-25% SL',
    ...overrides,
  };
}

function makeTelemetry(overrides = {}) {
  return {
    chain: 'SOL',
    contractAddress: SOL_TOKEN,
    price: 0.25,
    marketCap: 250_000,
    volume24h: 50_000,
    priceChange24h: 15,
    liquidity: 40_000,
    imageUrl: null,
    status: 'LIVE',
    provider: 'COINSTATS',
    originProvider: 'COINSTATS',
    fetchedAt: FRESH_ISO,
    isFallback: false,
    ...overrides,
  };
}

test('Alerts Monitor: parseStopLossPercentage correctly parses percentages', () => {
  assert.equal(parseStopLossPercentage('-25% SL'), -0.25);
  assert.equal(parseStopLossPercentage('-30%'), -0.30);
  assert.equal(parseStopLossPercentage('20%'), -0.20);
  assert.equal(parseStopLossPercentage('-15.5% SL'), -0.155);
  assert.equal(parseStopLossPercentage('invalid'), null);
  assert.equal(parseStopLossPercentage(''), null);
});

test('Alerts Monitor: valid target crossing triggers TP and SL only once (idempotent)', async () => {
  const registry = [makeCall()];
  const tpEvents = [];
  const slEvents = [];

  const deps = {
    now: () => NOW,
    maxDataAgeMs: 60_000,
    withLock: async (fn) => fn(),
    loadRegistry: async () => registry,
    saveRegistry: async () => ({ success: true }),
    getMarketData: async () => makeTelemetry({ marketCap: 220_000 }), // 2.2x -> hits TP1, not TP2
    notifyTp: async (alpha, label, mcLabel) => {
      tpEvents.push({ ticker: alpha.ticker, label, mcLabel });
      return { sent: 1, failed: 0, total: 1 };
    },
    notifySl: async (alpha, mcLabel) => {
      slEvents.push({ ticker: alpha.ticker, mcLabel });
      return { sent: 1, failed: 0, total: 1 };
    },
  };

  // Run 1: TP1 crossed
  const r1 = await runAutomatedAlertsMonitor(deps);
  assert.equal(r1.evaluated, 1);
  assert.equal(r1.tpTriggered, 1);
  assert.equal(r1.slTriggered, 0);
  assert.equal(r1.notificationsSent, 1);
  assert.equal(tpEvents.length, 1);
  assert.equal(tpEvents[0].label, 'TP1 (2x)');
  assert.equal(registry[0].takeProfits[0].hit, true);
  assert.equal(registry[0].takeProfits[1].hit, false);

  // Run 2 at same 220K MC: TP1 is already hit -> must not re-trigger
  const r2 = await runAutomatedAlertsMonitor(deps);
  assert.equal(r2.tpTriggered, 0);
  assert.equal(r2.notificationsSent, 0);
  assert.equal(tpEvents.length, 1, 'Duplicate TP alert must not fire');

  // Run 3 at 70K MC (-30% vs -25% SL): triggers SL and closes call
  deps.getMarketData = async () => makeTelemetry({ marketCap: 70_000 });
  const r3 = await runAutomatedAlertsMonitor(deps);
  assert.equal(r3.slTriggered, 1);
  assert.equal(r3.notificationsSent, 1);
  assert.equal(slEvents.length, 1);
  assert.equal(registry[0].status, 'CLOSED');
  assert.equal(registry[0].outcome, 'LOSS');

  // Run 4: call is now CLOSED -> skipped, no duplicate SL alert
  const r4 = await runAutomatedAlertsMonitor(deps);
  assert.equal(r4.evaluated, 0);
  assert.equal(r4.slTriggered, 0);
  assert.equal(slEvents.length, 1, 'Duplicate SL alert must not fire');
});

test('Alerts Monitor: rejects invalid market data (null, 0, negative, NaN marketCap)', async () => {
  const call = makeCall();
  for (const badMc of [null, 0, -50_000, Number.NaN, Number.POSITIVE_INFINITY]) {
    const verdict = assessTelemetryForAlerts(makeTelemetry({ marketCap: badMc }), call, NOW, 60_000);
    assert.deepEqual(verdict, { eligible: false, reason: 'invalid_market_cap' });
  }

  let notified = 0;
  const res = await runAutomatedAlertsMonitor({
    now: () => NOW,
    maxDataAgeMs: 60_000,
    withLock: async (fn) => fn(),
    loadRegistry: async () => [makeCall()],
    saveRegistry: async () => ({ success: true }),
    getMarketData: async () => makeTelemetry({ marketCap: null }), // e.g., partial response with price only
    notifyTp: async () => ({ sent: ++notified, failed: 0, total: 1 }),
    notifySl: async () => ({ sent: ++notified, failed: 0, total: 1 }),
  });
  assert.equal(res.tpTriggered, 0);
  assert.equal(res.slTriggered, 0);
  assert.equal(res.skippedByReason.invalid_market_cap, 1);
  assert.equal(notified, 0);
});

test('Alerts Monitor: rejects wrong token identity (wrong contract address or wrong chain)', async () => {
  const call = makeCall();

  // Wrong contract address on same chain
  const wrongCa = assessTelemetryForAlerts(
    makeTelemetry({ contractAddress: SOL_OTHER, marketCap: 900_000 }),
    call,
    NOW,
    60_000
  );
  assert.deepEqual(wrongCa, { eligible: false, reason: 'identity_mismatch' });

  // Wrong chain
  const wrongChain = assessTelemetryForAlerts(
    makeTelemetry({ chain: 'ETH', contractAddress: EVM_LOWER, marketCap: 900_000 }),
    call,
    NOW,
    60_000
  );
  assert.deepEqual(wrongChain, { eligible: false, reason: 'identity_mismatch' });

  // Unverified call contract
  const unverified = assessTelemetryForAlerts(
    makeTelemetry({ marketCap: 900_000 }),
    { chain: 'SOL', ca: 'not-a-valid-ca' },
    NOW,
    60_000
  );
  assert.deepEqual(unverified, { eligible: false, reason: 'unverified_token' });
});

test('Alerts Monitor: rejects stale telemetry (status STALE or fetchedAt older than maxDataAgeMs)', async () => {
  const call = makeCall();

  // Provider status is STALE (shared cache fallback during outage)
  const staleStatus = assessTelemetryForAlerts(
    makeTelemetry({ status: 'STALE', marketCap: 500_000 }),
    call,
    NOW,
    60_000
  );
  assert.deepEqual(staleStatus, { eligible: false, reason: 'status_not_live' });

  // Status is LIVE/CACHED but timestamp exceeds maxAgeMs
  const oldTimestamp = assessTelemetryForAlerts(
    makeTelemetry({ status: 'CACHED', fetchedAt: new Date(NOW - 120_000).toISOString(), marketCap: 500_000 }),
    call,
    NOW,
    60_000
  );
  assert.deepEqual(oldTimestamp, { eligible: false, reason: 'stale_data' });
});

test('Alerts Monitor: provider outage (UNAVAILABLE or thrown error) never triggers false TP/SL alerts', async () => {
  let notified = 0;

  // Case A: getMarketData returns UNAVAILABLE
  const rUnavail = await runAutomatedAlertsMonitor({
    now: () => NOW,
    maxDataAgeMs: 60_000,
    withLock: async (fn) => fn(),
    loadRegistry: async () => [makeCall()],
    saveRegistry: async () => ({ success: true }),
    getMarketData: async () =>
      makeTelemetry({
        status: 'UNAVAILABLE',
        provider: null,
        originProvider: null,
        price: null,
        marketCap: null,
        fetchedAt: null,
      }),
    notifyTp: async () => ({ sent: ++notified, failed: 0, total: 1 }),
    notifySl: async () => ({ sent: ++notified, failed: 0, total: 1 }),
  });
  assert.equal(rUnavail.tpTriggered, 0);
  assert.equal(rUnavail.slTriggered, 0);
  assert.equal(rUnavail.skippedByReason.status_not_live, 1);
  assert.equal(notified, 0);

  // Case B: getMarketData rejects
  const rThrown = await runAutomatedAlertsMonitor({
    now: () => NOW,
    maxDataAgeMs: 60_000,
    withLock: async (fn) => fn(),
    loadRegistry: async () => [makeCall()],
    saveRegistry: async () => ({ success: true }),
    getMarketData: async () => {
      throw new Error('upstream failure');
    },
    notifyTp: async () => ({ sent: ++notified, failed: 0, total: 1 }),
    notifySl: async () => ({ sent: ++notified, failed: 0, total: 1 }),
  });
  assert.equal(rThrown.tpTriggered, 0);
  assert.equal(rThrown.slTriggered, 0);
  assert.equal(rThrown.skippedByReason.lookup_error, 1);
  assert.equal(notified, 0);

  // Case C: saveRegistry fails -> notifications are suppressed so next run won't duplicate
  const rSaveFail = await runAutomatedAlertsMonitor({
    now: () => NOW,
    maxDataAgeMs: 60_000,
    withLock: async (fn) => fn(),
    loadRegistry: async () => [makeCall()],
    saveRegistry: async () => ({ success: false, error: 'kv write error' }),
    getMarketData: async () => makeTelemetry({ marketCap: 300_000 }),
    notifyTp: async () => ({ sent: ++notified, failed: 0, total: 1 }),
    notifySl: async () => ({ sent: ++notified, failed: 0, total: 1 }),
  });
  assert.equal(rSaveFail.tpTriggered, 0);
  assert.equal(rSaveFail.notificationsSent, 0);
  assert.equal(notified, 0);
});

test('Alerts Monitor: evaluateTargets requires positive finite entry and current USD market caps', () => {
  const call = makeCall({ entryMarketCapUsd: 0, marketCapUsd: 0 });
  assert.equal(evaluateTargets(call, 200_000), null);
  assert.equal(evaluateTargets(makeCall(), 0), null);
  assert.equal(evaluateTargets(makeCall(), -100), null);
});
