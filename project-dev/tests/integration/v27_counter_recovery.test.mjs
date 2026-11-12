import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { Keypair } from '@solana/web3.js';
import {
  createCampaign,
  deleteCampaign,
  loadCampaigns,
  getSubmissionByChallengeId,
  __setTestFailSaveCampaignsPersistent,
  getPendingCounterReconciliations,
  reconcileAllPendingCampaignCounters,
  reconcileCampaignSubmission,
} from '../../src/server/campaigns-data.ts';
import { issueRaidChallenge } from '../../src/server/raid-challenges.ts';
import { POST as submitCampaign } from '../../src/app/api/campaigns/[id]/submit/route.ts';

function signEd25519(keypair, message) {
  const der = crypto.sign(null, Buffer.from(message, 'utf8'), {
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(keypair.secretKey.slice(0, 32)),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  return Buffer.from(der).toString('hex');
}

test('V2.7 Counter: Injected failure surfaces PENDING_RECONCILIATION, repaired on retry without duplicates (§7)', async () => {
  const camp = await createCampaign({
    title: 'V27 Counter Recovery Test',
    description: 'Testing explicit response states and counter recovery',
    tweetUrl: 'https://x.com/trench/status/1111',
    rewardAmount: '100',
    postedBy: 'AdminWallet11111111111111111111111111111111',
  });

  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
  const sig = signEd25519(kp, ch.message);

  const makeReq = (isRetry = false) =>
    new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: wallet,
        xHandle: '@counter_v27_user',
        xRetweetLink: 'https://x.com/counter_v27_user/status/123',
        signature: sig,
        isRetry,
      }),
    });

  try {
    // 1. Inject failure into campaign counter save
    __setTestFailSaveCampaignsPersistent(new Error('Simulated disk error during counter update'));
    const initialRes = await submitCampaign(makeReq(false), { params: Promise.resolve({ id: camp.id }) });
    __setTestFailSaveCampaignsPersistent(null);

    // Initial response must report PERSISTED and PENDING_RECONCILIATION with HTTP 201
    assert.equal(initialRes.status, 201, 'Initial request must return 201 reflecting durable persistence');
    const initialJson = await initialRes.json();
    assert.equal(initialJson.ok, true);
    assert.equal(initialJson.submissionStatus, 'PERSISTED');
    assert.equal(initialJson.counterStatus, 'PENDING_RECONCILIATION');
    assert.match(initialJson.message, /Counter reconciliation pending retry/);
    assert.ok(initialJson.submission?.id);

    // 2. Confirm submission record is durable in store
    const durable = await getSubmissionByChallengeId(ch.challengeId);
    assert.ok(durable);
    assert.equal(durable.id, initialJson.submission.id);

    // Confirm campaign counter was NOT updated yet
    let camps = await loadCampaigns();
    let currentCamp = camps.find((c) => c.id === camp.id);
    assert.equal(currentCamp?.submissionsCount, 0, 'Campaign counter must remain 0 before repair');

    // 3. Confirm pending reconciliation tracker recorded this item
    const pendingList = await getPendingCounterReconciliations();
    const recordedPending = pendingList.find(
      (p) => p.campaignId === camp.id && p.submissionId === durable.id
    );
    assert.ok(recordedPending, 'Durable pending reconciliation queue must contain the failed record');

    // 4. Retry through API route: must reconcile and return 200 RECONCILED
    const retryRes = await submitCampaign(makeReq(true), { params: Promise.resolve({ id: camp.id }) });
    assert.equal(retryRes.status, 200, 'Retry must return 200');
    const retryJson = await retryRes.json();
    assert.equal(retryJson.submissionStatus, 'PERSISTED');
    assert.equal(retryJson.counterStatus, 'RECONCILED');
    assert.equal(retryJson.submissionsCount, 1, 'Counter must be reconciled to 1');

    // Confirm campaign counter is now 1 in storage
    camps = await loadCampaigns();
    currentCamp = camps.find((c) => c.id === camp.id);
    assert.equal(currentCamp?.submissionsCount, 1, 'Counter must be 1 in storage');

    // 5. Subsequent retry does NOT increment again
    const secondRetry = await submitCampaign(makeReq(true), { params: Promise.resolve({ id: camp.id }) });
    assert.equal(secondRetry.status, 200);
    const secondJson = await secondRetry.json();
    assert.equal(secondJson.counterStatus, 'RECONCILED');
    assert.equal(secondJson.submissionsCount, 1, 'Second retry must not double-count');
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('V2.7 Counter: Background worker reconcileAllPendingCampaignCounters repairs pending items', async () => {
  const camp = await createCampaign({
    title: 'V27 Worker Reconciliation Test',
    description: 'Testing background worker repairs',
    tweetUrl: 'https://x.com/trench/status/333',
    rewardAmount: '20',
    postedBy: 'AdminWallet11111111111111111111111111111111',
  });

  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
  const sig = signEd25519(kp, ch.message);

  try {
    __setTestFailSaveCampaignsPersistent(new Error('Disk fault'));
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: wallet,
        xHandle: '@worker_repair_user',
        xRetweetLink: 'https://x.com/worker_repair_user/status/1',
        signature: sig,
      }),
    });
    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    __setTestFailSaveCampaignsPersistent(null);
    assert.equal(res.status, 201);

    // Call background reconciliation worker
    const workerRes = await reconcileAllPendingCampaignCounters();
    assert.equal(workerRes.reconciled >= 1, true, 'Worker must reconcile pending counters');

    const camps = await loadCampaigns();
    const updatedCamp = camps.find((c) => c.id === camp.id);
    assert.equal(updatedCamp?.submissionsCount, 1, 'Worker must have repaired campaign counter to 1');
  } finally {
    await deleteCampaign(camp.id);
  }
});

