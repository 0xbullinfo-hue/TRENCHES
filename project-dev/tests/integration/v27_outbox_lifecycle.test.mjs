import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { Keypair } from '@solana/web3.js';
import {
  createCampaign,
  deleteCampaign,
  getSubmissionByChallengeId,
} from '../../src/server/campaigns-data.ts';
import {
  ensureCampaignSubmissionSideEffects,
  recordCampaignRewardAllocation,
  enqueueCampaignNotification,
  dispatchCampaignNotification,
  claimNotificationDispatch,
  completeNotificationDispatch,
  getSideEffectEvent,
  buildRewardIdempotencyKey,
  buildNotificationIdempotencyKey,
} from '../../src/server/campaign-side-effects.ts';
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

test('V2.7 Outbox: Production submission lifecycle automatically creates durable reward and notification events (§8)', async () => {
  const camp = await createCampaign({
    title: 'V27 Outbox Lifecycle Test',
    description: 'Testing integrated outbox events on submission',
    tweetUrl: 'https://x.com/trench/status/4444',
    rewardAmount: '150',
    postedBy: 'AdminWallet11111111111111111111111111111111',
  });

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
      xHandle: '@outbox_user',
      xRetweetLink: 'https://x.com/outbox_user/status/1',
      signature: sig,
    }),
  });

  try {
    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.submissionStatus, 'PERSISTED');
    assert.equal(json.sideEffectsStatus, 'DURABLE');
    const submissionId = json.submission.id;

    // Verify durable reward event exists
    const rewardKey = buildRewardIdempotencyKey(submissionId);
    const rewardEvent = await getSideEffectEvent(rewardKey);
    assert.ok(rewardEvent);
    assert.equal(rewardEvent.type, 'REWARD');
    assert.equal(rewardEvent.status, 'CREATED');
    assert.equal(rewardEvent.submissionId, submissionId);

    // Verify durable notification event exists
    const notifyKey = buildNotificationIdempotencyKey(submissionId);
    const notifyEvent = await getSideEffectEvent(notifyKey);
    assert.ok(notifyEvent);
    assert.equal(notifyEvent.type, 'NOTIFICATION');
    assert.equal(notifyEvent.status, 'CREATED');
    assert.equal(notifyEvent.submissionId, submissionId);

    // Verify retry returns existing events without duplication
    const retryReq = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: wallet,
        xHandle: '@outbox_user',
        xRetweetLink: 'https://x.com/outbox_user/status/1',
        signature: sig,
        isRetry: true,
      }),
    });
    const retryRes = await submitCampaign(retryReq, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(retryRes.status, 200);

    const rewardAfter = await getSideEffectEvent(rewardKey);
    assert.equal(rewardAfter.attemptCount, 0, 'Retry must not recreate or duplicate reward');
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('V2.7 Outbox: Competing dispatch workers and stale worker rejection (§8)', async () => {
  const camp = { id: `camp_${Date.now()}`, title: 'Dispatch Test', rewardAmount: '10' };
  const sub = {
    id: `sub_${crypto.randomUUID()}`,
    campaignId: camp.id,
    walletAddress: Keypair.generate().publicKey.toBase58(),
    xHandle: '@dispatch_worker_test',
  };

  const enqueueRes = await enqueueCampaignNotification({ submission: sub, campaign: camp });
  assert.equal(enqueueRes.ok, true);
  const notifyKey = enqueueRes.event.idempotencyKey;

  // 1. Worker 1 claims dispatch lease
  const claim1 = await claimNotificationDispatch(notifyKey, 'worker-1', 1000);
  assert.equal(claim1.ok, true);
  assert.equal(claim1.event?.status, 'DISPATCHING');

  // 2. Competing Worker 2 attempts claim while Worker 1 lease is active: must be BUSY
  const claim2 = await claimNotificationDispatch(notifyKey, 'worker-2', 1000);
  assert.equal(claim2.ok, false);
  assert.equal(claim2.reason, 'BUSY');

  // 3. Worker 1 lease expires (wait 1100ms)
  await new Promise((r) => setTimeout(r, 1100));

  // 4. Worker 2 now successfully claims expired lease
  const claim2AfterExpiry = await claimNotificationDispatch(notifyKey, 'worker-2', 5000);
  assert.equal(claim2AfterExpiry.ok, true);
  const gen2 = claim2AfterExpiry.dispatchGeneration;
  assert.equal(gen2, 2, 'Worker 2 must obtain next generation');

  // 5. Stale Worker 1 attempts to finalize with obsolete generation 1: REJECTED!
  const staleComplete = await completeNotificationDispatch(notifyKey, 'worker-1', 1, 'DELIVERED');
  assert.equal(staleComplete.ok, false, 'Stale worker finalize must be rejected');
  assert.equal(staleComplete.reason, 'STALE_DISPATCH_WORKER');

  // 6. Worker 2 successfully finalizes with valid generation 2: ACCEPTED
  const validComplete = await completeNotificationDispatch(
    notifyKey,
    'worker-2',
    gen2,
    'DELIVERED',
    'provider-msg-999'
  );
  assert.equal(validComplete.ok, true);
  assert.equal(validComplete.event?.status, 'DELIVERED');
  assert.equal(validComplete.event?.externalRef, 'provider-msg-999');
});

