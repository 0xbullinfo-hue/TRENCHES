/**
 * TRENCHLABS V2.6 - Side-Effect Idempotency & Failure Recovery Tests (§7)
 *
 * Verifies all 7 failure scenarios from §7.3:
 * 1. Submission persisted, reward not written -> recovered without duplicate submission or reward.
 * 2. Reward persisted, notification not written -> retry enqueues notification without duplicate reward.
 * 3. Notification event persisted, dispatch fails -> retry preserves event without duplicate creation.
 * 4. External provider accepts notification but response lost -> idempotent retry prevents duplicate external send.
 * 5. Worker crashes during dispatch -> event state reflects attempt, recoverable on retry.
 * 6. Recovery worker processes the same event twice -> idempotent check returns existing event.
 * 7. Two workers attempt the same reward simultaneously -> exactly one reward is allocated.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  recordCampaignRewardAllocation,
  enqueueCampaignNotification,
  dispatchCampaignNotification,
  getSideEffectEvent,
  buildRewardIdempotencyKey,
  buildNotificationIdempotencyKey,
  __setTestFailNextRewardRecord,
  __setTestFailNextNotificationEnqueue,
  __setTestFailNextNotificationDispatch,
} from '../../src/server/campaign-side-effects.ts';

function createDummySubmission(id = `sub-test-${crypto.randomUUID()}`) {
  return {
    id,
    campaignId: 'camp-test-sideeffect',
    walletAddress: '4Nd1mBQtrMJVYVfKf2PJy9NZRa2rKKy79xU58N56pump',
    xHandle: '@trench_tester',
    xRetweetLink: 'https://x.com/trench/status/100',
    status: 'PENDING',
    submittedAt: new Date().toISOString(),
  };
}

const dummyCampaign = {
  id: 'camp-test-sideeffect',
  title: 'Side Effect Test Campaign',
  description: 'Testing side effect idempotency and failure recovery',
  tweetUrl: 'https://x.com/trench/status/100',
  rewardAmount: '1,000 $GENESIS',
  rewardToken: '$GENESIS',
  status: 'ACTIVE',
  createdAt: new Date().toISOString(),
  postedBy: 'Admin',
};

test('V2.6 Side Effects Scenario 1: Submission persisted, reward write failure is recoverable without duplicate', async () => {
  const sub = createDummySubmission();
  // Step 1: Inject failure during reward allocation
  __setTestFailNextRewardRecord(new Error('Simulated database failure during reward write'));

  let threw = false;
  try {
    await recordCampaignRewardAllocation({
      submission: sub,
      campaign: dummyCampaign,
      rewardType: 'airdrop',
    });
  } catch (err) {
    threw = true;
    assert.equal(err.message, 'Simulated database failure during reward write');
  }
  assert.equal(threw, true);

  // Reward record should not exist yet
  const key = buildRewardIdempotencyKey(sub.id, 'airdrop');
  let event = await getSideEffectEvent(key);
  assert.equal(event, null);

  // Step 2: Retry succeeds
  const retryRes = await recordCampaignRewardAllocation({
    submission: sub,
    campaign: dummyCampaign,
    rewardType: 'airdrop',
  });
  assert.equal(retryRes.ok, true);
  assert.equal(retryRes.isExisting, false);
  assert.equal(retryRes.event.status, 'CREATED');

  // Step 3: Second retry returns existing record without duplicating
  const retry2Res = await recordCampaignRewardAllocation({
    submission: sub,
    campaign: dummyCampaign,
    rewardType: 'airdrop',
  });
  assert.equal(retry2Res.ok, true);
  assert.equal(retry2Res.isExisting, true);
  assert.equal(retry2Res.event.idempotencyKey, key);
});

test('V2.6 Side Effects Scenario 2: Reward persisted, notification enqueue failure retried without duplicate reward', async () => {
  const sub = createDummySubmission();

  // 1. Reward successfully written
  const rewardRes = await recordCampaignRewardAllocation({
    submission: sub,
    campaign: dummyCampaign,
    rewardType: 'airdrop',
  });
  assert.equal(rewardRes.ok, true);
  assert.equal(rewardRes.isExisting, false);

  // 2. Notification write fails
  __setTestFailNextNotificationEnqueue(new Error('Simulated outbox write failure'));
  let notifyThrew = false;
  try {
    await enqueueCampaignNotification({
      submission: sub,
      campaign: dummyCampaign,
      notificationType: 'proof_submitted',
    });
  } catch {
    notifyThrew = true;
  }
  assert.equal(notifyThrew, true);

  // 3. Retry reward -> returns existing without modifying
  const rewardRetry = await recordCampaignRewardAllocation({
    submission: sub,
    campaign: dummyCampaign,
    rewardType: 'airdrop',
  });
  assert.equal(rewardRetry.ok, true);
  assert.equal(rewardRetry.isExisting, true);

  // 4. Retry notification enqueue -> succeeds
  const notifyRetry = await enqueueCampaignNotification({
    submission: sub,
    campaign: dummyCampaign,
    notificationType: 'proof_submitted',
  });
  assert.equal(notifyRetry.ok, true);
  assert.equal(notifyRetry.isExisting, false);
});

test('V2.6 Side Effects Scenario 3: Notification event persisted, dispatch fails; retried safely', async () => {
  const sub = createDummySubmission();
  const notifyKey = buildNotificationIdempotencyKey(sub.id, 'proof_submitted');

  // 1. Enqueue event
  await enqueueCampaignNotification({
    submission: sub,
    campaign: dummyCampaign,
    notificationType: 'proof_submitted',
  });

  // 2. Dispatch fails (e.g. network timeout or 5xx from provider)
  let attempts = 0;
  const failingDispatcher = async () => {
    attempts++;
    return { accepted: false, error: 'Telegram 502 Bad Gateway' };
  };

  const dispatchRes = await dispatchCampaignNotification(notifyKey, failingDispatcher);
  assert.equal(dispatchRes.ok, false);
  assert.equal(dispatchRes.status, 'FAILED');
  assert.equal(attempts, 1);

  // Event is preserved in durable store with FAILED status and attemptCount = 1
  const storedEvent = await getSideEffectEvent(notifyKey);
  assert.equal(storedEvent?.status, 'FAILED');
  assert.equal(storedEvent?.attemptCount, 1);

  // 3. Subsequent retry succeeds
  const succeedingDispatcher = async () => {
    attempts++;
    return { accepted: true, delivered: true, externalRef: 'msg-999' };
  };

  const retryDispatch = await dispatchCampaignNotification(notifyKey, succeedingDispatcher);
  assert.equal(retryDispatch.ok, true);
  assert.equal(retryDispatch.status, 'DELIVERED');
  assert.equal(attempts, 2);

  const finalEvent = await getSideEffectEvent(notifyKey);
  assert.equal(finalEvent?.status, 'DELIVERED');
  assert.equal(finalEvent?.attemptCount, 2);
  assert.equal(finalEvent?.externalRef, 'msg-999');
});

test('V2.6 Side Effects Scenario 4: External provider accepts notification; repeated dispatch is idempotent', async () => {
  const sub = createDummySubmission();
  const notifyKey = buildNotificationIdempotencyKey(sub.id, 'proof_submitted');

  await enqueueCampaignNotification({
    submission: sub,
    campaign: dummyCampaign,
    notificationType: 'proof_submitted',
  });

  let networkSends = 0;
  const dispatcher = async () => {
    networkSends++;
    return { accepted: true, delivered: true, externalRef: 'msg-101' };
  };

  // First dispatch: provider accepts
  const res1 = await dispatchCampaignNotification(notifyKey, dispatcher);
  assert.equal(res1.ok, true);
  assert.equal(res1.status, 'DELIVERED');
  assert.equal(networkSends, 1);

  // Second dispatch attempt (e.g. caller retries after lost HTTP response):
  // Idempotency check detects DELIVERED status and skips re-sending to avoid duplicate external messages!
  const res2 = await dispatchCampaignNotification(notifyKey, dispatcher);
  assert.equal(res2.ok, true);
  assert.equal(res2.status, 'DELIVERED');
  assert.equal(networkSends, 1, 'Provider must not be called a second time after acceptance');
});

test('V2.6 Side Effects Scenario 5 & 6: Worker interruption during dispatch; recovery worker processes same event idempotently', async () => {
  const sub = createDummySubmission();
  const notifyKey = buildNotificationIdempotencyKey(sub.id, 'proof_submitted');

  await enqueueCampaignNotification({
    submission: sub,
    campaign: dummyCampaign,
    notificationType: 'proof_submitted',
  });

  // Inject failure during dispatch execution
  __setTestFailNextNotificationDispatch(new Error('Simulated worker process crash during dispatch'));
  const crashDispatch = await dispatchCampaignNotification(notifyKey, async () => ({ accepted: true }));
  assert.equal(crashDispatch.ok, false);
  assert.equal(crashDispatch.status, 'FAILED');

  // Recovery worker processes the same event twice
  let recoveryCalls = 0;
  const recoveryDispatcher = async () => {
    recoveryCalls++;
    return { accepted: true, delivered: true };
  };

  const rec1 = await dispatchCampaignNotification(notifyKey, recoveryDispatcher);
  assert.equal(rec1.ok, true);
  assert.equal(rec1.status, 'DELIVERED');
  assert.equal(recoveryCalls, 1);

  // Second recovery worker runs
  const rec2 = await dispatchCampaignNotification(notifyKey, recoveryDispatcher);
  assert.equal(rec2.ok, true);
  assert.equal(rec2.status, 'DELIVERED');
  assert.equal(recoveryCalls, 1, 'Second recovery run must not re-dispatch');
});

test('V2.6 Side Effects Scenario 7: Two workers attempt the same reward simultaneously; exactly one is created', async () => {
  const sub = createDummySubmission();

  // Run 10 concurrent reward allocation attempts simultaneously
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      recordCampaignRewardAllocation({
        submission: sub,
        campaign: dummyCampaign,
        rewardType: 'airdrop',
      })
    )
  );

  const createdCount = results.filter((r) => r.isExisting === false).length;
  const existingCount = results.filter((r) => r.isExisting === true).length;

  assert.equal(createdCount, 1, 'Exactly one initial reward must be created');
  assert.equal(existingCount, 9, 'Remaining 9 concurrent callers must receive existing record');
});
