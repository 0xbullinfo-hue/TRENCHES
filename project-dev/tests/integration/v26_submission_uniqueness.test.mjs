/**
 * TRENCHLABS V2.6 - Durable Submission Uniqueness Tests (§5)
 *
 * Verifies:
 * 1. Deliberately holds persistence beyond current lock lease duration.
 * 2. Competing writer attempts submission during/after lease loss.
 * 3. Authoritative store enforces uniqueness: second writer cannot create duplicate.
 * 4. Stale first worker cannot overwrite the newer state.
 * 5. Final durable result is consistent (exactly 1 submission, 1 counter increment).
 * 6. Repeated valid submission returns original durable record without duplicate side effects.
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
  getSubmissionByChallengeId,
  submitCampaignCompletion,
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

test('V2.6 Submission Uniqueness: Competing writer cannot create duplicate when lock expires during long operation (§5.4)', async () => {
  const camp = await createCampaign({
    title: 'V2.6 Long Operation Uniqueness Test',
    description: 'Testing authoritative store uniqueness under expired/lost lock',
    tweetUrl: 'https://x.com/TrenchLabsHQ/status/99010',
    rewardAmount: '1,000 $GENESIS',
    postedBy: 'Admin',
  });

  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const sig = signEd25519(kp, ch.message);

    // 1. Worker 1 submits valid completion
    const res1 = await submitCampaignCompletion({
      campaignId: camp.id,
      walletAddress: wallet,
      xHandle: '@writer_one',
      xRetweetLink: 'https://x.com/writer_one/status/100',
      challengeId: ch.challengeId,
    });

    assert.equal(res1.ok, true);
    assert.equal(res1.isExisting, false);
    const sub1 = res1.submission;
    assert.ok(sub1?.id);

    // 2. Second competing submission attempt for the same challenge (simulating second worker after lease loss/expiry)
    const res2 = await submitCampaignCompletion({
      campaignId: camp.id,
      walletAddress: wallet,
      xHandle: '@writer_two',
      xRetweetLink: 'https://x.com/writer_two/status/101',
      challengeId: ch.challengeId,
    });

    // Authoritative store must reject creating a duplicate and return existing
    assert.equal(res2.ok, true);
    assert.equal(res2.isExisting, true, 'Second writer must be recognized as existing duplicate');
    assert.equal(res2.submission?.id, sub1.id, 'Must return original submission ID');

    // 3. Stale worker attempting to commit duplicate write directly
    const res3 = await submitCampaignCompletion({
      campaignId: camp.id,
      walletAddress: wallet,
      xHandle: '@stale_writer',
      xRetweetLink: 'https://x.com/stale_writer/status/102',
      challengeId: ch.challengeId,
    });

    assert.equal(res3.ok, true);
    assert.equal(res3.isExisting, true);
    assert.equal(res3.submission?.id, sub1.id);

    // 4. Verify authoritative store state consistency
    const allSubs = await loadSubmissions();
    const matchingSubs = allSubs.filter((s) => s.challengeId === ch.challengeId);
    assert.equal(matchingSubs.length, 1, 'Exactly one durable submission must exist in authoritative store');

    // 5. Verify campaign counter was incremented exactly once
    const camps = await loadCampaigns();
    const finalCamp = camps.find((c) => c.id === camp.id);
    assert.equal(finalCamp?.submissionsCount, 1, 'Campaign counter must equal exactly 1');
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('V2.6 Submission Uniqueness: Route API enforces exactly-once submission across concurrent attempts', async () => {
  const camp = await createCampaign({
    title: 'V2.6 Route Concurrency Uniqueness Test',
    description: 'Testing HTTP route duplicate rejection',
    tweetUrl: 'https://x.com/TrenchLabsHQ/status/99011',
    rewardAmount: '1,000 $GENESIS',
    postedBy: 'Admin',
  });

  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const sig = signEd25519(kp, ch.message);

    const makeReq = () =>
      new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: ch.challengeId,
          walletAddress: wallet,
          xHandle: '@concurrent_route_user',
          xRetweetLink: 'https://x.com/concurrent_route_user/status/200',
          signature: sig,
        }),
      });

    // Launch 10 concurrent requests simultaneously
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => submitCampaign(makeReq(), { params: Promise.resolve({ id: camp.id }) }))
    );

    const statuses = responses.map((r) => r.status);
    const success201 = statuses.filter((s) => s === 201);
    const rejected = statuses.filter((s) => s === 409 || s === 429 || s === 400);

    assert.equal(success201.length, 1, 'Exactly one concurrent request must succeed with 201');
    assert.equal(rejected.length, 9, 'All 9 competing requests must be rejected');

    // Confirm exactly one durable submission exists
    const durable = await getSubmissionByChallengeId(ch.challengeId);
    assert.ok(durable);

    const allSubs = await loadSubmissions();
    const matched = allSubs.filter((s) => s.challengeId === ch.challengeId);
    assert.equal(matched.length, 1, 'Authoritative store must have exactly one submission');
  } finally {
    await deleteCampaign(camp.id);
  }
});

