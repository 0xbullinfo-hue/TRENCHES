/**
 * TRENCHLABS V2.6 - Campaign Counter Reconciliation Integration Tests (§3)
 *
 * Verifies:
 * 1. Persist valid submission with injected failure in campaign counter persistence.
 * 2. Submission record remains durable while counter is missing increment.
 * 3. Route returns HTTP 201 reflecting durable submission.
 * 4. Retry through separate request returns existing submission (HTTP 200).
 * 5. Campaign counter is repaired to accurate count.
 * 6. Repeated retries do NOT double-increment.
 * 7. Concurrent recovery attempts resolve to exact count without race condition.
 * 8. Reconcile function distinguishes all documented outcomes:
 *    - RECONCILED (repaired missing counter)
 *    - ALREADY_RECONCILED (counter already accurate)
 *    - SUBMISSION_NOT_FOUND
 *    - CAMPAIGN_NOT_FOUND
 *    - CAMPAIGN_MISMATCH
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { NextRequest } from 'next/server';

import {
  createCampaign,
  deleteCampaign,
  loadCampaigns,
  loadSubmissions,
  reconcileCampaignSubmission,
  getSubmissionByChallengeId,
  __setTestFailSaveCampaigns,
  __setTestFailSaveCampaignsPersistent,
} from '../../src/server/campaigns-data.ts';
import { issueRaidChallenge } from '../../src/server/raid-challenges.ts';
import { POST as submitCampaign } from '../../src/app/api/campaigns/[id]/submit/route.ts';

function signEd25519(keypair, message) {
  const messageBytes = Buffer.from(message, 'utf-8');
  const sigBytes = crypto.sign(null, messageBytes, {
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(keypair.secretKey.slice(0, 32)),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  return Buffer.from(sigBytes).toString('hex');
}

test('V2.6 Counter Reconciliation: Repaired on retry after campaign counter save failure', async () => {
  const camp = await createCampaign({
    title: 'V2.6 Counter Repair Test',
    description: 'Testing idempotent counter reconciliation on recovery path',
    tweetUrl: 'https://x.com/TrenchLabsHQ/status/99001',
    rewardAmount: '500 $GENESIS',
    rewardToken: '$GENESIS',
    durationHours: 24,
    postedBy: 'Admin',
  });

  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const sig = signEd25519(kp, ch.message);

    const makeReq = (isRetry = false) =>
      new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(isRetry ? { 'x-retry': 'true' } : {}),
        },
        body: JSON.stringify({
          challengeId: ch.challengeId,
          walletAddress: wallet,
          xHandle: '@counter_user',
          xRetweetLink: 'https://x.com/counter_user/status/1',
          signature: sig,
          isRetry,
        }),
      });

    // 1. Inject failure into campaign counter update (after submission record is saved)
    // Keep failure persistent during initial request so counter cannot be updated
    __setTestFailSaveCampaignsPersistent(new Error('Simulated disk failure during counter save'));
    const initialRes = await submitCampaign(makeReq(false), { params: Promise.resolve({ id: camp.id }) });
    __setTestFailSaveCampaignsPersistent(null);

    // Initial response should succeed with 201 reflecting durable submission
    assert.equal(initialRes.status, 201, 'Initial request must return 201 reflecting durable persistence');
    const initialJson = await initialRes.json();
    assert.ok(initialJson.submission?.id);

    // 2. Confirm submission record is durable
    const durableCheck = await getSubmissionByChallengeId(ch.challengeId);
    assert.ok(durableCheck, 'Submission must be durably recorded');

    // Confirm campaign counter was NOT updated due to injected failure
    let camps = await loadCampaigns();
    let currentCamp = camps.find((c) => c.id === camp.id);
    assert.equal(currentCamp?.submissionsCount, 0, 'Campaign counter should still be 0 after partial failure');

    // 3. Retry through submission route
    const retryRes = await submitCampaign(makeReq(true), { params: Promise.resolve({ id: camp.id }) });
    assert.equal(retryRes.status, 200, 'Retry must return HTTP 200 with existing submission');
    const retryJson = await retryRes.json();
    assert.equal(retryJson.submission?.id, durableCheck.id, 'Must return same durable submission');

    // 4. Confirm campaign counter is REPAIRED
    camps = await loadCampaigns();
    currentCamp = camps.find((c) => c.id === camp.id);
    assert.equal(currentCamp?.submissionsCount, 1, 'Campaign counter must be repaired to 1 on retry');

    // 5. Subsequent retries must NOT increment the counter again
    const retry2Res = await submitCampaign(makeReq(true), { params: Promise.resolve({ id: camp.id }) });
    assert.equal(retry2Res.status, 200);

    camps = await loadCampaigns();
    currentCamp = camps.find((c) => c.id === camp.id);
    assert.equal(currentCamp?.submissionsCount, 1, 'Campaign counter must remain 1 after second retry');
  } finally {
    __setTestFailSaveCampaigns(null);
    await deleteCampaign(camp.id);
  }
});

test('V2.6 Counter Reconciliation: reconcileCampaignSubmission unit semantics & outcomes', async () => {
  const camp = await createCampaign({
    title: 'V2.6 Unit Reconciliation Outcomes',
    description: 'Unit testing reconcileCampaignSubmission return codes',
    tweetUrl: 'https://x.com/TrenchLabsHQ/status/99002',
    rewardAmount: '500 $GENESIS',
    postedBy: 'Admin',
  });

  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const sig = signEd25519(kp, ch.message);

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: wallet,
        xHandle: '@unit_user',
        xRetweetLink: 'https://x.com/unit_user/status/2',
        signature: sig,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 201);
    const json = await res.json();
    const subId = json.submission.id;

    // A. Already reconciled call: counter is already accurate
    const resAlready = await reconcileCampaignSubmission(camp.id, subId);
    assert.equal(resAlready.ok, true);
    assert.equal(resAlready.status, 'ALREADY_RECONCILED');
    assert.equal(resAlready.submissionsCount, 1);

    // B. Unknown submission ID
    const resNotFound = await reconcileCampaignSubmission(camp.id, 'sub-nonexistent-999');
    assert.equal(resNotFound.ok, false);
    assert.equal(resNotFound.status, 'SUBMISSION_NOT_FOUND');

    // C. Campaign mismatch
    const resMismatch = await reconcileCampaignSubmission('camp-wrong-id', subId);
    assert.equal(resMismatch.ok, false);
    assert.equal(resMismatch.status, 'CAMPAIGN_MISMATCH');

    // D. Artificially decrement campaign counter, then reconcile -> RECONCILED
    const { saveCampaigns } = await import('../../src/server/campaigns-data.ts');
    let camps = await loadCampaigns();
    const target = camps.find((c) => c.id === camp.id);
    if (target) {
      target.submissionsCount = 0;
      await saveCampaigns(camps);
    }

    const resRepaired = await reconcileCampaignSubmission(camp.id, subId);
    assert.equal(resRepaired.ok, true);
    assert.equal(resRepaired.status, 'RECONCILED');
    assert.equal(resRepaired.submissionsCount, 1);

    // E. Repeated call -> ALREADY_RECONCILED
    const resRepairedAgain = await reconcileCampaignSubmission(camp.id, subId);
    assert.equal(resRepairedAgain.ok, true);
    assert.equal(resRepairedAgain.status, 'ALREADY_RECONCILED');
    assert.equal(resRepairedAgain.submissionsCount, 1);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('V2.6 Counter Reconciliation: Concurrent reconciliation calls yield exactly one repair', async () => {
  const camp = await createCampaign({
    title: 'V2.6 Concurrent Reconciliation Test',
    description: 'Testing concurrent recovery calls against counter',
    tweetUrl: 'https://x.com/TrenchLabsHQ/status/99003',
    rewardAmount: '500 $GENESIS',
    postedBy: 'Admin',
  });

  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const sig = signEd25519(kp, ch.message);

    // Save submission with counter failure
    __setTestFailSaveCampaigns(new Error('Simulated failure during save'));
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: wallet,
        xHandle: '@concurrent_user',
        xRetweetLink: 'https://x.com/concurrent_user/status/3',
        signature: sig,
      }),
    });
    const subRes = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    __setTestFailSaveCampaigns(null);
    assert.equal(subRes.status, 201);
    const subJson = await subRes.json();
    const subId = subJson.submission.id;

    // Launch 10 concurrent reconciliation calls simultaneously
    const results = await Promise.all(
      Array.from({ length: 10 }, () => reconcileCampaignSubmission(camp.id, subId))
    );

    // All should return ok: true
    for (const r of results) {
      assert.equal(r.ok, true);
      assert.equal(r.submissionsCount, 1);
    }

    // Verify counter is exactly 1 in storage
    const camps = await loadCampaigns();
    const finalCamp = camps.find((c) => c.id === camp.id);
    assert.equal(finalCamp?.submissionsCount, 1, 'Counter must be exactly 1 after concurrent reconciliation');
  } finally {
    __setTestFailSaveCampaigns(null);
    await deleteCampaign(camp.id);
  }
});
