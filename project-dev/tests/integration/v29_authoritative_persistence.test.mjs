import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Keypair } from '@solana/web3.js';
import {
  createCampaign,
  deleteCampaign,
  submitCampaignCompletion,
  loadCampaigns,
  loadSubmissions,
  saveSubmissions,
  saveCampaigns,
  getSubmissionByChallengeId,
  saveSubmissionReservation,
  recoverSubmissionReservation,
  reconcileCampaignSubmission,
} from '../../src/server/campaigns-data.ts';

test('V2.9 Authoritative Persistence: getSubmissionByChallengeId requires canonical store presence (§3)', async () => {
  const camp = await createCampaign({
    title: 'V29 Authoritative Persistence Test',
    description: 'Testing canonical store verification and payload rejection',
    tweetUrl: 'https://x.com/trench/status/2901',
    rewardAmount: '100',
    postedBy: 'AdminWallet11111111111111111111111111111111',
  });

  const challengeId = `v29_auth_${crypto.randomBytes(8).toString('hex')}`;
  const wallet = Keypair.generate().publicKey.toBase58();
  const subId = `sub_${crypto.randomBytes(8).toString('hex')}`;
  const idemKey = `idem_${challengeId}`;

  try {
    const fakePayload = {
      id: subId,
      campaignId: camp.id,
      walletAddress: wallet,
      xHandle: '@auth_user',
      xRetweetLink: 'https://x.com/auth_user/status/1',
      challengeId,
      idempotencyKey: idemKey,
      status: 'PENDING',
      submittedAt: new Date().toISOString(),
    };

    // 1. Create a COMPLETED reservation with submissionPayload but DO NOT persist to authoritative collection
    await saveSubmissionReservation({
      challengeId,
      campaignId: camp.id,
      walletAddress: wallet,
      submissionId: subId,
      idempotencyKey: idemKey,
      state: 'COMPLETED',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attemptId: 'att_v29_test',
      fencingGeneration: 1,
      submissionPayload: fakePayload,
    });

    // 2. Lookup MUST return null because record is NOT in authoritative store (no payload fallback!)
    const lookupBefore = await getSubmissionByChallengeId(challengeId);
    assert.equal(lookupBefore, null, 'getSubmissionByChallengeId must NEVER return payload when missing from canonical store');

    // 3. Perform controlled recovery under lock
    const recoverRes = await recoverSubmissionReservation(challengeId);
    assert.equal(recoverRes.ok, true, 'Recovery must succeed');
    assert.equal(recoverRes.status, 'RECOVERED_AND_PERSISTED');

    // 4. Re-read canonical store directly to verify persistence
    const reloaded = await loadSubmissions();
    const verified = reloaded.find((s) => s.id === subId);
    assert.ok(verified, 'Canonical store must contain recovered submission');
    assert.equal(verified.challengeId, challengeId);

    // 5. Lookup MUST now succeed and match canonical record
    const lookupAfter = await getSubmissionByChallengeId(challengeId);
    assert.ok(lookupAfter, 'Lookup succeeds now that record is authoritative');
    assert.equal(lookupAfter.id, subId);
    assert.equal(lookupAfter.walletAddress.toLowerCase(), wallet.toLowerCase());
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('V2.9 Counter Reconciliation: Deduplicates matching submissions strictly without naive increment (§7)', async () => {
  const camp = await createCampaign({
    title: 'V29 Counter Deduplication Test',
    description: 'Testing idempotent counter recalculation',
    tweetUrl: 'https://x.com/trench/status/2902',
    rewardAmount: '50',
    postedBy: 'AdminWallet11111111111111111111111111111111',
  });

  const wallet = Keypair.generate().publicKey.toBase58();
  const subId = `sub_${crypto.randomBytes(8).toString('hex')}`;

  try {
    // Write 1 submission
    const subs = await loadSubmissions();
    subs.unshift({
      id: subId,
      campaignId: camp.id,
      walletAddress: wallet,
      xHandle: '@dedup_user',
      xRetweetLink: 'https://x.com/dedup_user/status/1',
      challengeId: `ch_${Date.now()}`,
      idempotencyKey: `idem_${subId}`,
      status: 'PENDING',
      submittedAt: new Date().toISOString(),
    });
    await saveSubmissions(subs);

    // Reconcile twice sequentially
    const rec1 = await reconcileCampaignSubmission(camp.id, subId);
    assert.equal(rec1.ok, true);
    assert.equal(rec1.submissionsCount, 1);

    const rec2 = await reconcileCampaignSubmission(camp.id, subId);
    assert.equal(rec2.ok, true);
    assert.equal(rec2.submissionsCount, 1);
    assert.equal(rec2.status, 'ALREADY_RECONCILED');

    // Verify counter is exactly 1, not 2
    const camps = await loadCampaigns();
    const c = camps.find((item) => item.id === camp.id);
    assert.equal(c?.submissionsCount, 1, 'Counter must be exactly 1 after duplicate reconciliations');
  } finally {
    await deleteCampaign(camp.id);
  }
});
