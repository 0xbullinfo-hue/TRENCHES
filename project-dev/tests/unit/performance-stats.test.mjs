import test from 'node:test';
import assert from 'node:assert/strict';
import { computePerformanceStats } from '../../src/lib/ledger/performance-stats.ts';

test('Performance & Trust Stats: No records returns zero counts and unavailable win rate', () => {
  const stats = computePerformanceStats([], []);
  assert.equal(stats.totalRecordedCalls, 0);
  assert.equal(stats.profitableCalls, 0);
  assert.equal(stats.losses, 0);
  assert.equal(stats.openCalls, 0);
  assert.equal(stats.resolvedCalls, 0);
  assert.equal(stats.winRate, null);
  assert.equal(stats.winRateFormatted, '—');
});

test('Performance & Trust Stats: One profitable call gives 100% win rate', () => {
  const ledger = [
    { ticker: 'BONK', multiplier: '5.2000', closed_at: '2026-11-05T10:00:00.000Z' },
  ];
  const stats = computePerformanceStats(ledger, []);
  assert.equal(stats.totalRecordedCalls, 1);
  assert.equal(stats.profitableCalls, 1);
  assert.equal(stats.losses, 0);
  assert.equal(stats.resolvedCalls, 1);
  assert.equal(stats.winRate, 100);
  assert.equal(stats.winRateFormatted, '100%');
});

test('Performance & Trust Stats: One losing call gives 0% win rate', () => {
  const ledger = [
    { ticker: 'FLOP', multiplier: '0.7500', closed_at: '2026-11-05T10:00:00.000Z' },
  ];
  const stats = computePerformanceStats(ledger, []);
  assert.equal(stats.totalRecordedCalls, 1);
  assert.equal(stats.profitableCalls, 0);
  assert.equal(stats.losses, 1);
  assert.equal(stats.resolvedCalls, 1);
  assert.equal(stats.winRate, 0);
  assert.equal(stats.winRateFormatted, '0%');
});

test('Performance & Trust Stats: Mixed resolved calls calculates correct ratio', () => {
  const ledger = [
    { ticker: 'WIN1', multiplier: '2.5000' },
    { ticker: 'WIN2', multiplier: '3.0000' },
    { ticker: 'WIN3', multiplier: '1.2000' },
    { ticker: 'LOSS1', multiplier: '0.8000' },
  ];
  // 3 wins, 1 loss = 3 / 4 = 75%
  const stats = computePerformanceStats(ledger, []);
  assert.equal(stats.totalRecordedCalls, 4);
  assert.equal(stats.profitableCalls, 3);
  assert.equal(stats.losses, 1);
  assert.equal(stats.resolvedCalls, 4);
  assert.equal(stats.winRate, 75);
  assert.equal(stats.winRateFormatted, '75%');
});

test('Performance & Trust Stats: Pending and active calls are strictly excluded from resolved denominator', () => {
  const ledger = [
    { ticker: 'WIN1', multiplier: '2.0000' },
  ];
  const calls = [
    { ticker: 'OPEN1', status: 'LIVE', outcome: 'PENDING' },
    { ticker: 'OPEN2', status: 'LIVE', outcome: 'PENDING' },
  ];
  const stats = computePerformanceStats(ledger, calls);
  assert.equal(stats.totalRecordedCalls, 1);
  assert.equal(stats.profitableCalls, 1);
  assert.equal(stats.losses, 0);
  assert.equal(stats.openCalls, 2);
  assert.equal(stats.resolvedCalls, 1);
  assert.equal(stats.winRate, 100);
  assert.equal(stats.winRateFormatted, '100%');
});

test('Performance & Trust Stats: Cancelled and invalid records are safely ignored', () => {
  const ledger = [
    null,
    {},
    { ticker: '', multiplier: '2.0' },
    { ticker: 'CANC', multiplier: '2.0000', status: 'CANCELLED' },
    { ticker: 'VALID', multiplier: '4.0000' },
  ];
  const calls = [
    null,
    { ticker: 'CANC_CALL', status: 'CANCELLED' },
    { ticker: 'VALID_OPEN', status: 'LIVE' },
  ];
  const stats = computePerformanceStats(ledger, calls);
  assert.equal(stats.totalRecordedCalls, 1);
  assert.equal(stats.profitableCalls, 1);
  assert.equal(stats.losses, 0);
  assert.equal(stats.openCalls, 1);
  assert.equal(stats.resolvedCalls, 1);
  assert.equal(stats.winRate, 100);
});

test('Performance & Trust Stats: Zero resolved calls returns unavailable state without NaN or Infinity', () => {
  const calls = [
    { ticker: 'OPEN1', status: 'LIVE', outcome: 'PENDING' },
    { ticker: 'OPEN2', status: 'LIVE', outcome: 'PENDING' },
  ];
  const stats = computePerformanceStats([], calls);
  assert.equal(stats.totalRecordedCalls, 0);
  assert.equal(stats.profitableCalls, 0);
  assert.equal(stats.losses, 0);
  assert.equal(stats.openCalls, 2);
  assert.equal(stats.resolvedCalls, 0);
  assert.equal(stats.winRate, null);
  assert.equal(stats.winRateFormatted, '—');
  assert.equal(Number.isNaN(stats.winRate), false);
});

