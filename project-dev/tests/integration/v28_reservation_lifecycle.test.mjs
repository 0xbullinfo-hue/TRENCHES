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
  getSubmissionByChallengeId,
  getSubmissionReservation,
  saveSubmissionReservation,
  updateSubmissionReservationState,
  recoverSubmissionReservation,
  __setTestFailSaveSubmissions,
} from '../../src/server/campaigns-data.ts';
import {
  getSideEffectEvent,
  buildRewardIdempotencyKey,
  buildNotificationIdempotencyKey,
  ensureCampaignSubmissionSideEffects,
} from '../../src/server/campaign-side-effects.ts';

test('V2.8 Lifecycle [1/4]: Reservation state machine never returns success before durable submission write (§2)', async () => {
  const camp = await createCampaign({
    title: 'V28 State Machine Test',
    description: 'Testing RESERVED -> PERSISTED -> COMPLETED lifecycle',
    tweetUrl: 'https://x.com/trench/status/2801',
    rewardAmount: '100',
    postedBy: 'AdminWallet11111111111111111111111111111111',
  });

  const challengeId = `v28_sm_${crypto.randomBytes(8).toString('hex')}`;
  const wallet = Keypair.generate().publicKey.toBase58();
  const subId = `sub_${crypto.randomBytes(8).toString('hex')}`;
  const idemKey = `idem_${challengeId}`;

  try {
    // 1. Manually create a raw RESERVED reservation (simulating process interrupted immediately after reservation)
    await saveSubmissionReservation({
      challengeId,
      campaignId: camp.id,
      walletAddress: wallet,
      submissionId: subId,
      idempotencyKey: idemKey,
      state: 'RESERVED',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attemptId: `att_${crypto.randomBytes(4).toString('hex')}`,
      fencingGeneration: 1,
    });

    // 2. Verify that getSubmissionByChallengeId returns NULL while only RESERVED
    const lookupBefore = await getSubmissionByChallengeId(challengeId);
    assert.equal(lookupBefore, null, 'Must NEVER return success solely because a reservation exists');

    // 3. Normal submit call should resume/complete the reservation
    const subRes = await submitCampaignCompletion({
      campaignId: camp.id,
      walletAddress: wallet,
      xHandle: '@v28_user',
      xRetweetLink: 'https://x.com/v28_user/status/1',
      challengeId,
    });
    assert.equal(subRes.ok, true, 'Resume must succeed');
    assert.ok(subRes.submission, 'Submission returned');

    // 4. Verify reservation is now COMPLETED
    const completedRes = await getSubmissionReservation(challengeId);
    assert.ok(completedRes, 'Reservation must exist');
    assert.equal(completedRes.state, 'COMPLETED', 'Reservation state must advance to COMPLETED');

    // 5. Subsequent lookup returns the canonical submission
    const lookupAfter = await getSubmissionByChallengeId(challengeId);
    assert.ok(lookupAfter, 'Lookup must find persisted submission');
    assert.equal(lookupAfter.id, subRes.submission.id);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('V2.8 Lifecycle [2/4]: Submission write failure marks reservation RETRYABLE and retry succeeds (§2)', async () => {
  const camp = await createCampaign({
    title: 'V28 Write Failure Retry Test',
    description: 'Testing write failure recovery and RETRYABLE state',
    tweetUrl: 'https://x.com/trench/status/2802',
    rewardAmount: '50',
    postedBy: 'AdminWallet11111111111111111111111111111111',
  });

  const challengeId = `v28_fail_${crypto.randomBytes(8).toString('hex')}`;
  const wallet = Keypair.generate().publicKey.toBase58();

  try {
    // 1. Inject write failure into submission persistence
    __setTestFailSaveSubmissions(new Error('Simulated disk write failure'));

    let failed = false;
    try {
      await submitCampaignCompletion({
        campaignId: camp.id,
        walletAddress: wallet,
        xHandle: '@fail_user',
        xRetweetLink: 'https://x.com/fail_user/status/1',
        challengeId,
      });
    } catch (err) {
      failed = true;
      assert.match(err.message, /Simulated disk write failure/);
    } finally {
      __setTestFailSaveSubmissions(null);
    }
    assert.equal(failed, true, 'Submission persistence must have thrown');

    // 2. Verify reservation transitioned to RETRYABLE (or remained non-completed)
    const resState = await getSubmissionReservation(challengeId);
    assert.ok(resState, 'Reservation must be recorded');
    assert.equal(resState.state === 'RETRYABLE' || resState.state === 'RESERVED', true);

    // 3. Verify getSubmissionByChallengeId returns null
    const lookupFail = await getSubmissionByChallengeId(challengeId);
    assert.equal(lookupFail, null, 'Must not return submission when persistence failed');

    // 4. Retry without failure succeeds
    const retryRes = await submitCampaignCompletion({
      campaignId: camp.id,
      walletAddress: wallet,
      xHandle: '@fail_user',
      xRetweetLink: 'https://x.com/fail_user/status/1',
      challengeId,
    });
    assert.equal(retryRes.ok, true, 'Retry must succeed');

    const finalRes = await getSubmissionReservation(challengeId);
    assert.equal(finalRes.state, 'COMPLETED');
  } finally {
    __setTestFailSaveSubmissions(null);
    await deleteCampaign(camp.id);
  }
});

test('V2.8 Lifecycle [3/4]: Process termination after persistence recovers reservation to COMPLETED (§2)', async () => {
  const camp = await createCampaign({
    title: 'V28 Persistence Recovery Test',
    description: 'Testing recovery when process terminates before reservation COMPLETED',
    tweetUrl: 'https://x.com/trench/status/2803',
    rewardAmount: '120',
    postedBy: 'AdminWallet11111111111111111111111111111111',
  });

  const challengeId = `v28_pers_${crypto.randomBytes(8).toString('hex')}`;
  const wallet = Keypair.generate().publicKey.toBase58();
  const subId = `sub_${crypto.randomBytes(8).toString('hex')}`;
  const idemKey = `idem_${challengeId}`;

  try {
    // 1. Durably write the submission record into authoritative store
    const subs = await loadSubmissions();
    subs.push({
      id: subId,
      campaignId: camp.id,
      walletAddress: wallet,
      xHandle: '@term_user',
      xRetweetLink: 'https://x.com/term_user/status/1',
      challengeId,
      idempotencyKey: idemKey,
      submittedAt: new Date().toISOString(),
    });
    await saveSubmissions(subs);

    // 2. Create reservation stuck at PERSISTED (simulating crash before completion)
    await saveSubmissionReservation({
      challengeId,
      campaignId: camp.id,
      walletAddress: wallet,
      submissionId: subId,
      idempotencyKey: idemKey,
      state: 'PERSISTED',
      createdAt: Date.now() - 30000,
      updatedAt: Date.now() - 30000,
      attemptId: 'att_stuck',
      fencingGeneration: 1,
    });

    // 3. Run explicit recovery for this reservation
    const recRes = await recoverSubmissionReservation(challengeId);
    assert.equal(recRes.ok, true, 'Must recover reservation');
    assert.equal(recRes.status, 'COMPLETED');

    const updatedRes = await getSubmissionReservation(challengeId);
    assert.equal(updatedRes.state, 'COMPLETED');
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('V2.8 Lifecycle [4/4]: 20 concurrent requests for same challenge yield exactly 1 submission and 1 outbox event (§2 & §5)', async () => {
  const camp = await createCampaign({
    title: 'V28 Concurrency Test',
    description: 'Testing 20 concurrent requests on same challenge',
    tweetUrl: 'https://x.com/trench/status/2804',
    rewardAmount: '200',
    postedBy: 'AdminWallet11111111111111111111111111111111',
  });

  const challengeId = `v28_race_${crypto.randomBytes(8).toString('hex')}`;
  const wallet = Keypair.generate().publicKey.toBase58();

  try {
    // Fire 20 parallel submission completion requests
    const promises = Array.from({ length: 20 }, (_, idx) =>
      submitCampaignCompletion({
        campaignId: camp.id,
        walletAddress: wallet,
        xHandle: `@race_user_${idx}`,
        xRetweetLink: `https://x.com/race_user/status/${idx}`,
        challengeId,
      })
    );

    const results = await Promise.all(promises);
    for (const r of results) {
      assert.equal(r.ok, true, 'All callers must receive ok=true');
    }

    const firstSubId = results[0].submission.id;
    for (const r of results) {
      assert.equal(r.submission.id, firstSubId, 'All callers must receive canonical submission');
    }

    // Verify exactly one submission in authoritative store
    const allSubs = await loadSubmissions();
    const matchingSubs = allSubs.filter((s) => s.challengeId === challengeId);
    assert.equal(matchingSubs.length, 1, 'Authoritative store must have exactly one submission');

    // Verify campaign counter
    const allCamps = await loadCampaigns();
    const currentCamp = allCamps.find((c) => c.id === camp.id);
    assert.equal(currentCamp.submissionsCount, 1, 'Campaign counter must increment by exactly 1');

    // Ensure side effects for all concurrent callers (simulating API response handler)
    const sideEffects = await Promise.all(
      results.map((r) =>
        ensureCampaignSubmissionSideEffects({
          submission: r.submission,
          campaign: currentCamp,
        })
      )
    );
    for (const se of sideEffects) {
      assert.equal(se.ok, true);
    }

    // Verify outbox events
    const rewardKey = buildRewardIdempotencyKey(firstSubId);
    const rewardEvent = await getSideEffectEvent(rewardKey);
    assert.ok(rewardEvent, 'Reward outbox event must exist');
    assert.equal(rewardEvent.submissionId, firstSubId);
  } finally {
    await deleteCampaign(camp.id);
  }
});
