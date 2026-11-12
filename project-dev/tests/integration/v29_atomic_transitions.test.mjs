import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  isKvConfigured,
  KV_CONFIGURED,
  kvSet,
  kvGet,
  kvAdvanceSubmissionReservation,
} from '../../src/server/kv.ts';

const isKvActive = () => Boolean(KV_CONFIGURED || isKvConfigured());

test('V2.9 Atomic Transitions: Rejects state mismatch, attempt ID mismatch, and fencing violations (§4)', async () => {
  if (!isKvActive()) {
    return; // KV specific atomic tests
  }

  const challengeId = `v29_trans_${crypto.randomBytes(6).toString('hex')}`;
  const resKey = `trench:sub:reservation:${challengeId}`;

  const initialRecord = {
    challengeId,
    campaignId: 'camp-v29-1',
    walletAddress: 'SolanaWallet11111111111111111111111111111111',
    submissionId: 'sub-v29-alpha',
    idempotencyKey: `idem-${challengeId}`,
    state: 'RESERVED',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attemptId: 'att-first',
    fencingGeneration: 5,
  };

  await kvSet(resKey, JSON.stringify(initialRecord));

  // 1. Rejects when expectedState does not match current state
  const failState = await kvAdvanceSubmissionReservation(resKey, 'PERSISTED', 'COMPLETED', {
    attemptId: 'att-first',
    fencingGeneration: 5,
  });
  assert.equal(failState.ok, false);
  assert.equal(failState.reason, 'STATE_MISMATCH');

  // 2. Rejects when attemptId does not match current attempt
  const failAttempt = await kvAdvanceSubmissionReservation(resKey, 'RESERVED', 'PERSISTED', {
    attemptId: 'att-wrong-stale',
    fencingGeneration: 5,
  });
  assert.equal(failAttempt.ok, false);
  assert.equal(failAttempt.reason, 'ATTEMPT_MISMATCH');

  // 3. Rejects when provided fencing generation is older than record generation
  const failFencing = await kvAdvanceSubmissionReservation(resKey, 'RESERVED', 'PERSISTED', {
    attemptId: 'att-first',
    fencingGeneration: 3, // older than 5
  });
  assert.equal(failFencing.ok, false);
  assert.equal(failFencing.reason, 'FENCING_VIOLATION');

  // 4. Valid transition with matching expectedState, attemptId, and fencing succeeds
  const validAdv = await kvAdvanceSubmissionReservation(resKey, 'RESERVED', 'PERSISTED', {
    attemptId: 'att-first',
    fencingGeneration: 6, // newer fencing
  });
  assert.equal(validAdv.ok, true);
  assert.equal(validAdv.reservation.state, 'PERSISTED');
  assert.equal(validAdv.reservation.fencingGeneration, 6);
});
