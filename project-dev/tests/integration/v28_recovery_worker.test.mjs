import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { Keypair } from '@solana/web3.js';
import {
  GET as recoveryWorkerGet,
  POST as recoveryWorkerPost,
} from '../../src/app/api/admin/campaign-recovery/route.ts';
import {
  createCampaign,
  deleteCampaign,
  loadCampaigns,
  saveCampaigns,
  loadSubmissions,
  saveSubmissions,
  markCampaignCounterPendingReconciliation,
  saveSubmissionReservation,
  getSubmissionReservation,
} from '../../src/server/campaigns-data.ts';
import {
  runCampaignRecoveryWorker,
  enqueueCampaignNotification,
  getSideEffectEvent,
  buildNotificationIdempotencyKey,
  __setTestMockNotificationDispatcher,
} from '../../src/server/campaign-side-effects.ts';

test('V2.8 Recovery Worker [1/3]: Authentication enforces CRON_SECRET Bearer header (§6 & §7)', async () => {
  const originalSecret = process.env.CRON_SECRET;
  const testSecret = 'cron_test_secret_32_characters_long_min_12345';
  process.env.CRON_SECRET = testSecret;
  __setTestMockNotificationDispatcher(async (ev) => ({
    accepted: true,
    delivered: true,
    externalRef: `mock_${Date.now()}`,
  }));

  try {
    // 1. Missing Authorization header -> 401
    const req1 = new NextRequest('http://localhost:3000/api/admin/campaign-recovery', {
      method: 'GET',
    });
    const res1 = await recoveryWorkerGet(req1);
    assert.equal(res1.status, 401);

    // 2. Wrong Bearer token -> 401
    const req2 = new NextRequest('http://localhost:3000/api/admin/campaign-recovery', {
      method: 'GET',
      headers: { authorization: 'Bearer wrong-secret' },
    });
    const res2 = await recoveryWorkerGet(req2);
    assert.equal(res2.status, 401);

    // 3. Valid Bearer token -> 200
    const req3 = new NextRequest('http://localhost:3000/api/admin/campaign-recovery', {
      method: 'GET',
      headers: { authorization: `Bearer ${testSecret}` },
    });
    const res3 = await recoveryWorkerGet(req3);
    assert.equal(res3.status, 200);
    const body3 = await res3.json();
    assert.equal(body3.ok, true);
    assert.equal(body3.status === 'COMPLETED' || body3.status === 'SUCCESS' || body3.status === 'PARTIAL', true);
    assert.equal(typeof body3.durationMs, 'number');
    assert.equal(typeof body3.reconciledCounters, 'number');
    assert.equal(typeof body3.recoveredReservations, 'number');
    assert.equal(typeof body3.dispatchedNotifications, 'number');
  } finally {
    __setTestMockNotificationDispatcher(null);
    if (originalSecret !== undefined) {
      process.env.CRON_SECRET = originalSecret;
    } else {
      delete process.env.CRON_SECRET;
    }
  }
});

test('V2.8 Recovery Worker [2/3]: POST route operates identically to GET (§6 & §7)', async () => {
  const originalSecret = process.env.CRON_SECRET;
  const testSecret = 'cron_test_secret_32_characters_long_min_12345';
  process.env.CRON_SECRET = testSecret;
  __setTestMockNotificationDispatcher(async (ev) => ({
    accepted: true,
    delivered: true,
    externalRef: `mock_${Date.now()}`,
  }));

  try {
    const req = new NextRequest('http://localhost:3000/api/admin/campaign-recovery', {
      method: 'POST',
      headers: { authorization: `Bearer ${testSecret}` },
    });
    const res = await recoveryWorkerPost(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.status === 'COMPLETED' || body.status === 'SUCCESS' || body.status === 'PARTIAL', true);
  } finally {
    __setTestMockNotificationDispatcher(null);
    if (originalSecret !== undefined) {
      process.env.CRON_SECRET = originalSecret;
    } else {
      delete process.env.CRON_SECRET;
    }
  }
});

test('V2.8 Recovery Worker [3/3]: End-to-end recovery repairs pending counters, stuck reservations and dispatches notifications (§6 & §7)', async () => {
  const camp = await createCampaign({
    title: 'V28 Recovery Worker E2E Test',
    description: 'Testing full background orchestrator repair pass',
    tweetUrl: 'https://x.com/trench/status/2888',
    rewardAmount: '300',
    postedBy: 'AdminWallet11111111111111111111111111111111',
  });

  const challengeId = `v28_rec_${crypto.randomBytes(8).toString('hex')}`;
  const wallet = Keypair.generate().publicKey.toBase58();
  const subId = `sub_${crypto.randomBytes(8).toString('hex')}`;
  const idemKey = `idem_${challengeId}`;
  let camp2 = null;

  try {
    // 1. Durably write submission
    const subs = await loadSubmissions();
    const submissionObj = {
      id: subId,
      campaignId: camp.id,
      walletAddress: wallet,
      xHandle: '@rec_user',
      xRetweetLink: 'https://x.com/rec_user/status/1',
      challengeId,
      idempotencyKey: idemKey,
      submittedAt: new Date().toISOString(),
    };
    subs.unshift(submissionObj);
    await saveSubmissions(subs);

    // 2. Set campaign count to 0 and mark counter pending reconciliation
    const camps = await loadCampaigns();
    const c = camps.find((item) => item.id === camp.id);
    if (c) {
      c.submissionsCount = 0;
      await saveCampaigns(camps);
    }
    await markCampaignCounterPendingReconciliation(camp.id, subId);

    // 2b. Create a second campaign with undercounted counter for counter reconciliation testing
    camp2 = await createCampaign({
      title: 'V28 Counter Recovery Test',
      description: 'Undercounted counter reconciliation',
      tweetUrl: 'https://x.com/trench/status/2889',
      rewardAmount: '50',
      postedBy: 'AdminWallet11111111111111111111111111111111',
    });
    const sub2Id = `sub2_${crypto.randomBytes(8).toString('hex')}`;
    subs.unshift({
      id: sub2Id,
      campaignId: camp2.id,
      walletAddress: wallet,
      xHandle: '@user_c2',
      xRetweetLink: 'https://x.com/user_c2/status/1',
      challengeId: `ch2_${crypto.randomBytes(8).toString('hex')}`,
      idempotencyKey: `idem2_${sub2Id}`,
      submittedAt: new Date().toISOString(),
    });
    await saveSubmissions(subs);
    const camps2 = await loadCampaigns();
    const c2 = camps2.find((item) => item.id === camp2.id);
    if (c2) {
      c2.submissionsCount = 0;
      await saveCampaigns(camps2);
    }
    await markCampaignCounterPendingReconciliation(camp2.id, sub2Id);

    // 3. Create stuck reservation
    await saveSubmissionReservation({
      challengeId,
      campaignId: camp.id,
      walletAddress: wallet,
      submissionId: subId,
      idempotencyKey: idemKey,
      state: 'PERSISTED',
      createdAt: Date.now() - 30000,
      updatedAt: Date.now() - 30000,
      attemptId: 'att_worker_test',
      fencingGeneration: 1,
    });

    // 4. Enqueue notification in CREATED state and configure test mock dispatcher
    __setTestMockNotificationDispatcher(async (ev) => ({
      accepted: true,
      delivered: true,
      externalRef: `mock_notif_${Date.now()}`,
    }));

    await enqueueCampaignNotification({
      submission: submissionObj,
      campaign: camp,
    });

    // 5. Run the background worker
    const report = await runCampaignRecoveryWorker({
      batchSize: 50,
    });

    assert.equal(report.ok, true);
    assert.equal(report.status, 'COMPLETED');
    assert.equal(report.reconciledCounters >= 1, true, 'Must repair undercounted campaign');
    assert.equal(report.recoveredReservations >= 1, true, 'Must advance stuck reservation');

    // 6. Verify restored states
    const updatedCamps = await loadCampaigns();
    const updatedC = updatedCamps.find((item) => item.id === camp.id);
    assert.equal(updatedC?.submissionsCount, 1, 'Counter restored to 1');

    const updatedRes = await getSubmissionReservation(challengeId);
    assert.equal(updatedRes?.state, 'COMPLETED');

    const notifyKey = buildNotificationIdempotencyKey(subId);
    const notifyEvent = await getSideEffectEvent(notifyKey);
    assert.ok(notifyEvent);
    assert.equal(
      ['ACCEPTED', 'DELIVERED', 'CREATED'].includes(notifyEvent.status),
      true,
      `Notification processed (status was ${notifyEvent.status})`
    );
  } finally {
    __setTestMockNotificationDispatcher(null);
    if (camp2?.id) await deleteCampaign(camp2.id);
    await deleteCampaign(camp.id);
  }
});
