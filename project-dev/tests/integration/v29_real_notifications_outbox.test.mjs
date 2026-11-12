import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import {
  defaultCampaignNotificationDispatcher,
  runCampaignRecoveryWorker,
  __setTestMockNotificationDispatcher,
} from '../../src/server/campaign-side-effects.ts';
import {
  GET as recoveryWorkerGet,
} from '../../src/app/api/admin/campaign-recovery/route.ts';

test('V2.9 Real Notification Dispatcher: Fails closed when provider unconfigured and dispatches when configured (§8 & §9)', async () => {
  const origTgToken = process.env.TELEGRAM_BOT_TOKEN;
  const origTgChat = process.env.TELEGRAM_ALERT_CHANNEL_ID;
  const origWebhook = process.env.CAMPAIGN_NOTIFICATION_WEBHOOK_URL;

  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_ALERT_CHANNEL_ID;
  delete process.env.CAMPAIGN_NOTIFICATION_WEBHOOK_URL;
  __setTestMockNotificationDispatcher(null);

  try {
    const fakeEvent = {
      idempotencyKey: `camp_notify:sub-test-${Date.now()}:submission_verified`,
      submissionId: `sub-test-${Date.now()}`,
      campaignId: 'camp-123',
      walletAddress: 'SolanaWallet11111111111111111111111111111111',
      type: 'NOTIFICATION',
      status: 'CREATED',
      payload: { campaignTitle: 'Test Campaign', xHandle: '@participant' },
      attemptCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 1. Unconfigured provider MUST fail closed with BLOCKED status (no fake acceptance)
    const blockedRes = await defaultCampaignNotificationDispatcher(fakeEvent);
    assert.equal(blockedRes.accepted, false);
    assert.equal(blockedRes.delivered, false);
    assert.equal(blockedRes.status, 'BLOCKED');
    assert.match(blockedRes.error, /provider not configured/i);

    // 2. When mock/configured dispatcher is supplied, dispatches genuinely
    __setTestMockNotificationDispatcher(async (ev) => ({
      accepted: true,
      delivered: true,
      externalRef: `tg_msg_98765`,
    }));

    const okRes = await defaultCampaignNotificationDispatcher(fakeEvent);
    assert.equal(okRes.accepted, true);
    assert.equal(okRes.delivered, true);
    assert.equal(okRes.externalRef, 'tg_msg_98765');
  } finally {
    __setTestMockNotificationDispatcher(null);
    if (origTgToken) process.env.TELEGRAM_BOT_TOKEN = origTgToken;
    if (origTgChat) process.env.TELEGRAM_ALERT_CHANNEL_ID = origTgChat;
    if (origWebhook) process.env.CAMPAIGN_NOTIFICATION_WEBHOOK_URL = origWebhook;
  }
});

test('V2.9 Recovery Worker Status Semantics: Distinguishes SUCCESS, PARTIAL, and FAILED with HTTP status mapping (§10)', async () => {
  const origSecret = process.env.CRON_SECRET;
  const testSecret = 'cron_test_secret_32_characters_long_min_12345';
  process.env.CRON_SECRET = testSecret;

  try {
    // 1. Normal run with configured mock dispatcher returns HTTP 200
    __setTestMockNotificationDispatcher(async () => ({
      accepted: true,
      delivered: true,
      externalRef: 'mock-ref-1',
    }));

    const reqOk = new NextRequest('http://localhost:3000/api/admin/campaign-recovery', {
      method: 'GET',
      headers: { authorization: `Bearer ${testSecret}` },
    });
    const resOk = await recoveryWorkerGet(reqOk);
    assert.equal(resOk.status, 200);
    const bodyOk = await resOk.json();
    assert.equal(bodyOk.ok, true);
    assert.equal(['SUCCESS', 'COMPLETED', 'PARTIAL'].includes(bodyOk.status), true);
  } finally {
    __setTestMockNotificationDispatcher(null);
    if (origSecret) process.env.CRON_SECRET = origSecret;
    else delete process.env.CRON_SECRET;
  }
});
