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
} from '../../src/server/campaigns-data.ts';
import {
  reconcilePendingCampaignOperations,
  getSideEffectEvent,
  buildRewardIdempotencyKey,
  buildNotificationIdempotencyKey,
  enqueueCampaignNotification,
} from '../../src/server/campaign-side-effects.ts';

test('V2.7 Recovery: reconcilePendingCampaignOperations repairs missing outbox events and expired dispatch (§9)', async () => {
  const camp = await createCampaign({
    title: 'V27 Full Recovery Suite Test',
    description: 'Testing complete background reconciliation',
    tweetUrl: 'https://x.com/trench/status/777',
    rewardAmount: '75',
    postedBy: 'AdminWallet11111111111111111111111111111111',
  });

  const challengeId = `v27_rec_${crypto.randomBytes(8).toString('hex')}`;
  const wallet = Keypair.generate().publicKey.toBase58();

  try {
    // 1. Create a submission
    const subRes = await submitCampaignCompletion({
      campaignId: camp.id,
      walletAddress: wallet,
      xHandle: '@recovery_user',
      xRetweetLink: 'https://x.com/recovery_user/status/1',
      challengeId,
    });
    assert.equal(subRes.ok, true);
    const subId = subRes.submission.id;
    await enqueueCampaignNotification({ submission: subRes.submission, campaign: camp });

    // 2. Deliberately delete the reward outbox file to simulate interrupted process after submission
    const rewardKey = buildRewardIdempotencyKey(subId);
    const rewardFile = path.join(process.cwd(), 'data', 'campaign_side_effects', `${encodeURIComponent(rewardKey)}.json`);
    if (fs.existsSync(rewardFile)) {
      fs.unlinkSync(rewardFile);
    }
    assert.equal(await getSideEffectEvent(rewardKey), null, 'Reward event deleted to simulate interruption');

    // 3. Mark notification as stuck in DISPATCHING with expired lease
    const notifyKey = buildNotificationIdempotencyKey(subId);
    const notifyEvent = await getSideEffectEvent(notifyKey);
    if (notifyEvent) {
      notifyEvent.status = 'DISPATCHING';
      notifyEvent.dispatchLeaseExpiresAt = Date.now() - 5000; // Expired 5 seconds ago
      notifyEvent.dispatchWorkerId = 'crashed-worker';
      const notifyFile = path.join(process.cwd(), 'data', 'campaign_side_effects', `${encodeURIComponent(notifyKey)}.json`);
      fs.writeFileSync(notifyFile, JSON.stringify(notifyEvent, null, 2), 'utf8');
    }

    // 4. Also simulate undercounted campaign counter
    const camps = await loadCampaigns();
    const c = camps.find((item) => item.id === camp.id);
    if (c) {
      c.submissionsCount = 0;
      await saveCampaigns(camps);
    }

    // 5. Run the authoritative recovery manager
    const recoveryReport = await reconcilePendingCampaignOperations();
    assert.equal(recoveryReport.reconciledCounters >= 1, true, 'Must repair campaign counter');
    assert.equal(recoveryReport.reconciledRewards >= 1, true, 'Must recreate missing reward event');
    assert.equal(recoveryReport.recoveredDispatchEvents >= 1, true, 'Must reset expired dispatch event');

    // 6. Verify restored states
    const restoredReward = await getSideEffectEvent(rewardKey);
    assert.ok(restoredReward, 'Missing reward event must be restored');
    assert.equal(restoredReward.status, 'CREATED');

    const resetNotify = await getSideEffectEvent(notifyKey);
    assert.ok(resetNotify);
    assert.equal(resetNotify.status, 'CREATED', 'Expired DISPATCHING event must be reset to CREATED');

    const updatedCamps = await loadCampaigns();
    const updatedC = updatedCamps.find((item) => item.id === camp.id);
    assert.equal(updatedC?.submissionsCount, 1, 'Campaign counter must be restored to 1');
  } finally {
    await deleteCampaign(camp.id);
  }
});

