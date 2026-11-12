import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Keypair } from '@solana/web3.js';
import {
  createCampaign,
  deleteCampaign,
  submitCampaignCompletion,
  loadSubmissions,
  getSubmissionByChallengeId,
} from '../../src/server/campaigns-data.ts';

test('V2.7 Uniqueness: 20 concurrent requests for same challenge yield exactly ONE submission (§6)', async () => {
  const camp = await createCampaign({
    title: 'V27 20-Concurrent Uniqueness Test',
    description: 'Testing high concurrency uniqueness',
    tweetUrl: 'https://x.com/trench/status/12345',
    rewardAmount: '100',
    postedBy: 'AdminWallet11111111111111111111111111111111',
  });

  const challengeId = `v27_chal_${crypto.randomBytes(12).toString('hex')}`;
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();

  try {
    // Fire 20 simultaneous submissions for the exact same challenge
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(
        submitCampaignCompletion({
          campaignId: camp.id,
          walletAddress: wallet,
          xHandle: `@user_${i}`,
          xRetweetLink: `https://x.com/user_${i}/status/999`,
          challengeId,
        })
      );
    }

    const results = await Promise.all(promises);

    // All must resolve to success (either created or existing recovered)
    for (const res of results) {
      assert.equal(res.ok, true);
      assert.ok(res.submission);
    }

    // Verify exactly ONE newly created, and remaining 19 are isExisting: true
    const newlyCreated = results.filter((r) => !r.isExisting);
    const existingRecovered = results.filter((r) => r.isExisting);
    assert.equal(newlyCreated.length, 1, 'Exactly one request must create the submission');
    assert.equal(existingRecovered.length, 19, 'All other 19 requests must return existing submission');

    // All must reference the exact same submission ID
    const canonicalId = newlyCreated[0].submission.id;
    for (const r of results) {
      assert.equal(r.submission.id, canonicalId);
    }

    // Verify durable store has exactly 1 submission
    const durable = await getSubmissionByChallengeId(challengeId);
    assert.ok(durable);
    assert.equal(durable.id, canonicalId);

    const allSubs = await loadSubmissions();
    const matching = allSubs.filter((s) => s.challengeId === challengeId);
    assert.equal(matching.length, 1, 'Store must contain exactly one submission record for challenge');
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('V2.7 Uniqueness: Independent challenges do not conflict and both succeed', async () => {
  const camp = await createCampaign({
    title: 'V27 Independent Challenges Test',
    description: 'Testing independent challenges',
    tweetUrl: 'https://x.com/trench/status/222',
    rewardAmount: '50',
    postedBy: 'AdminWallet11111111111111111111111111111111',
  });

  const chal1 = `v27_chal_A_${crypto.randomBytes(8).toString('hex')}`;
  const chal2 = `v27_chal_B_${crypto.randomBytes(8).toString('hex')}`;
  const wallet1 = Keypair.generate().publicKey.toBase58();
  const wallet2 = Keypair.generate().publicKey.toBase58();

  try {
    const [res1, res2] = await Promise.all([
      submitCampaignCompletion({
        campaignId: camp.id,
        walletAddress: wallet1,
        xHandle: '@user_a',
        xRetweetLink: 'https://x.com/user_a/status/1',
        challengeId: chal1,
      }),
      submitCampaignCompletion({
        campaignId: camp.id,
        walletAddress: wallet2,
        xHandle: '@user_b',
        xRetweetLink: 'https://x.com/user_b/status/2',
        challengeId: chal2,
      }),
    ]);

    assert.equal(res1.ok, true);
    assert.equal(res2.ok, true);
    assert.notEqual(res1.submission.id, res2.submission.id);
  } finally {
    await deleteCampaign(camp.id);
  }
});

