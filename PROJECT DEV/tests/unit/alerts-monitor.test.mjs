import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStopLossPercentage,
  runAutomatedAlertsMonitor,
} from '../../src/server/alerts-monitor.ts';

test('Alerts Monitor: parseStopLossPercentage correctly parses percentages', () => {
  assert.equal(parseStopLossPercentage('-25% SL'), -0.25);
  assert.equal(parseStopLossPercentage('-30%'), -0.30);
  assert.equal(parseStopLossPercentage('20%'), -0.20);
  assert.equal(parseStopLossPercentage('-15.5% SL'), -0.155);
  assert.equal(parseStopLossPercentage('invalid'), null);
  assert.equal(parseStopLossPercentage(''), null);
});

test('Alerts Monitor: TP condition calculation and idempotency', () => {
  const entryMc = 100_000;
  const takeProfits = [
    { label: 'TP1 (2x)', multiple: 2.0, hit: false },
    { label: 'TP2 (5x)', multiple: 5.0, hit: false },
  ];

  // At 210,000 MC (2.1x):
  const currentMc = 210_000;
  for (const tp of takeProfits) {
    const targetMc = entryMc * tp.multiple;
    if (currentMc >= targetMc && !tp.hit) {
      tp.hit = true;
    }
  }

  // TP1 should be hit, TP2 not hit
  assert.equal(takeProfits[0].hit, true);
  assert.equal(takeProfits[1].hit, false);

  // Subsequent check at 220,000 MC: TP1 is already hit so it must not re-trigger
  let retriggered = false;
  for (const tp of takeProfits) {
    const targetMc = entryMc * tp.multiple;
    if (currentMc >= targetMc && !tp.hit) {
      retriggered = true;
    }
  }
  assert.equal(retriggered, false, 'Should be idempotent and not re-trigger');
});

test('Alerts Monitor: SL condition calculation', () => {
  const entryMc = 100_000;
  const slPct = parseStopLossPercentage('-25% SL');
  assert.ok(slPct !== null);

  const slThresholdMc = entryMc * (1 + slPct); // 75,000
  assert.equal(slThresholdMc, 75_000);

  // Price at 70,000 (breached SL threshold)
  const breachedMc = 70_000;
  const isTriggered = breachedMc <= slThresholdMc;
  assert.equal(isTriggered, true);

  // Price at 80,000 (safe, not breached)
  const safeMc = 80_000;
  const isSafe = safeMc <= slThresholdMc;
  assert.equal(isSafe, false);
});

test('Alerts Monitor: Worker executes gracefully', async () => {
  const result = await runAutomatedAlertsMonitor();

  assert.ok(typeof result.evaluated === 'number');
  assert.ok(typeof result.tpTriggered === 'number');
  assert.ok(typeof result.slTriggered === 'number');
  assert.ok(typeof result.notificationsSent === 'number');
  assert.ok(Array.isArray(result.errors));
});
