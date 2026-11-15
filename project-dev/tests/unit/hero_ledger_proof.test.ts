import test from 'node:test';
import assert from 'node:assert/strict';
import { formatProofLine } from '../../src/components/landing/HeroLedgerProof';

test('formatProofLine returns proof string only for finite positive numbers', () => {
  assert.equal(formatProofLine(42), '42 calls recorded on the public ledger');
  assert.equal(formatProofLine(1), '1 calls recorded on the public ledger');
  assert.equal(formatProofLine(0), null);
  assert.equal(formatProofLine(-5), null);
  assert.equal(formatProofLine(Number.NaN), null);
  assert.equal(formatProofLine(Number.POSITIVE_INFINITY), null);
  assert.equal(formatProofLine('42'), null);
  assert.equal(formatProofLine(undefined), null);
  assert.equal(formatProofLine(null), null);
});
