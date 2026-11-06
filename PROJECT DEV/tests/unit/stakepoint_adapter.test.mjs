import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStakePointIntegrationStatus,
  verifyAndRecordStakePointPosition,
} from '../../src/server/stakepoint.ts';
import { createStake } from '../../src/server/db.ts';

test('StakePoint Adapter: getStakePointIntegrationStatus reports BLOCKED when program ID is unconfigured', () => {
  const orig = process.env.NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID;
  delete process.env.NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID;
  delete process.env.STAKEPOINT_PROGRAM_ID;

  const status = getStakePointIntegrationStatus();
  assert.equal(status.status, 'BLOCKED');
  assert.equal(status.programId, null);
  assert.ok(status.message.includes('not configured'));

  if (orig) process.env.NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID = orig;
});

test('StakePoint Adapter: Rejects signature with invalid format', async () => {
  const result = await verifyAndRecordStakePointPosition({
    walletAddress: 'TestWallet11111111111111111111111111111111111',
    txSignature: 'short-invalid-sig',
    lockDays: 90,
  });

  assert.equal(result.success, false);
  assert.equal(result.status, 'REJECTED');
  assert.ok(result.error?.includes('signature format'));
});

test('StakePoint Adapter: Rejects lock period less than 90 days', async () => {
  const result = await verifyAndRecordStakePointPosition({
    walletAddress: 'TestWallet11111111111111111111111111111111111',
    txSignature: '5J4...validLengthSignatureMustBeAtLeast64CharactersLongForTestValidationPurpose11111',
    lockDays: 30, // Less than required 90 days
  });

  assert.equal(result.success, false);
  assert.equal(result.status, 'REJECTED');
  assert.ok(result.error?.includes('90 days'));
});

test('StakePoint Adapter: Replay prevention rejects duplicate transaction signature', async () => {
  const duplicateSig = `5J4...replay_test_${Date.now()}_validLengthSignatureMustBeAtLeast64CharactersLong11111`;
  // Seed a stake with this signature directly into db
  await createStake({
    wallet_address: 'TestWallet11111111111111111111111111111111111',
    amount_raw: '16000000000000',
    lock_days: 90,
    tx_signature: duplicateSig,
    staking_provider: 'stakepoint',
  });

  // Attempt to verify with the same signature
  const result = await verifyAndRecordStakePointPosition({
    walletAddress: 'TestWallet22222222222222222222222222222222222',
    txSignature: duplicateSig,
    lockDays: 90,
  });

  assert.equal(result.success, false);
  assert.equal(result.status, 'REJECTED');
  assert.ok(result.error?.includes('already been registered'));
});
