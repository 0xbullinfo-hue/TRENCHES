import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'trench-tg-remed-'));
process.chdir(TMP_DIR);

process.env.NODE_ENV = 'test';
process.env.ALLOW_FILE_PERSISTENCE = 'true';
process.env.SESSION_SECRET = 'remediation-test-session-secret-32-chars-min';
process.env.TELEGRAM_BOT_TOKEN = '777888:REMEDIATION_BOT_TOKEN';
process.env.TELEGRAM_BOT_USERNAME = 'Trenchlabs_bot';
process.env.TELEGRAM_WEBHOOK_SECRET = 'remediation-webhook-secret';
process.env.TELEGRAM_MEMBER_GROUP_ID = '-1005551111111';
process.env.TELEGRAM_PRO_GROUP_ID = '-1006662222222';
process.env.SITE_URL = 'https://trenchlabshq.xyz';
process.env.SOLANA_RPC = 'http://remed-rpc.local';
process.env.CRON_SECRET = 'remediation-cron-secret';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.TELEGRAM_MEMBER_INVITE_URL;
delete process.env.TELEGRAM_PRO_INVITE_URL;

const GENESIS_MINT = 'EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump';
const ADMIN_WALLET = 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e';

const mockState = {
  balancesRaw: new Map(),
  rpcFailWallets: new Set(),
  failBanUser: false,
  telegramCalls: [],
  sentMessages: [],
  kickedUsers: [],
  inviteSeq: 0,
};

const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);

  if (url.includes('dexscreener.com')) {
    return new Response(
      JSON.stringify({
        pairs: [
          {
            chainId: 'solana',
            baseToken: { address: GENESIS_MINT },
            priceUsd: '0.0001',
            marketCap: 100000,
            liquidity: { usd: 50000 },
            volume: { h24: 10000 },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (url.includes('api.jup.ag')) {
    return new Response(JSON.stringify({ data: { [GENESIS_MINT]: { price: '0.0001' } } }), { status: 200 });
  }
  if (url.includes('remed-rpc.local') || url.includes('mainnet-beta.solana.com')) {
    const body = JSON.parse(String(init.body || '{}'));
    const owner = body?.params?.[0];
    if (mockState.rpcFailWallets.has(owner)) {
      return new Response('RPC 503', { status: 503 });
    }
    const raw = mockState.balancesRaw.get(owner) ?? '0';
    const value =
      BigInt(raw) > BigInt(0)
        ? [{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: Number(raw) / 1e6, amount: raw } } } } } }]
        : [];
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value } }), { status: 200 });
  }
  if (url.includes('api.telegram.org/bot')) {
    const method = url.split('/').pop();
    const body = JSON.parse(String(init.body || '{}'));
    mockState.telegramCalls.push({ method, body });

    if (method === 'createChatInviteLink') {
      mockState.inviteSeq += 1;
      return new Response(
        JSON.stringify({
          ok: true,
          result: { invite_link: `https://t.me/+remed_inv_${body.chat_id}_${mockState.inviteSeq}` },
        }),
        { status: 200 }
      );
    }
    if (method === 'sendMessage') {
      mockState.sentMessages.push({
        chat_id: body.chat_id,
        text: body.text,
        reply_markup: body.reply_markup,
      });
      return new Response(JSON.stringify({ ok: true, result: { message_id: mockState.sentMessages.length } }), {
        status: 200,
      });
    }
    if (method === 'banChatMember') {
      if (mockState.failBanUser) {
        return new Response(JSON.stringify({ ok: false, description: 'Forbidden: not enough rights to restrict/ban' }), {
          status: 403,
        });
      }
      mockState.kickedUsers.push({ chat_id: body.chat_id, user_id: body.user_id });
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
  }
  return origFetch(input, init);
};

test.after(() => {
  globalThis.fetch = origFetch;
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {}
});

const db = await import('../../src/server/db.ts');
const auth = await import('../../src/server/auth.ts');
const tg = await import('../../src/server/telegram.ts');
const webhookRoute = await import('../../src/app/api/telegram/webhook/route.ts');
const statusRoute = await import('../../src/app/api/verification/status/route.ts');
const dispatchDelayedRoute = await import('../../src/app/api/telegram/dispatch-delayed/route.ts');

let uidSeq = 10_000;
const nextUid = () => ++uidSeq;
const cookieFor = (w) => `trench_session=${auth.signSession(w, 3600)}`;

function sendWebhook(payload) {
  return webhookRoute.POST(
    new NextRequest('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': process.env.TELEGRAM_WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    })
  );
}

// ============================================================================
// FIX 1: Bidirectional Member/Pro Group Routing + Removal Failure Handling
// ============================================================================
test('Fix 1: Bidirectional group routing rejects Pro in Member and Member in Pro, handles Free/Unknown/Admin & failed removals', async () => {
  const memW = 'Fix1MemberWallet11111111111111111111111111';
  const proW = 'Fix1ProWallet11111111111111111111111111111';
  const freeW = 'Fix1FreeWallet1111111111111111111111111111';
  const unkW = 'Fix1UnknownWallet1111111111111111111111111';

  mockState.balancesRaw.set(memW, '250000000000'); // $25 Member
  mockState.balancesRaw.set(proW, '250000000000');
  await db.createStake({
    wallet_address: proW,
    amount_raw: '3000000000000', // $300 Pro
    lock_days: 90,
    tx_signature: `fix1_stake_${crypto.randomUUID()}`,
  });
  mockState.rpcFailWallets.add(unkW);

  const memTg = 11001;
  const proTg = 11002;
  const freeTg = 11003;
  const unkTg = 11004;
  const adminTg = 11005;

  await db.upsertTelegramMember({ wallet_address: memW, telegram_user_id: memTg, tier: 'member', in_group: false, group_status: 'invite_pending', group_id: process.env.TELEGRAM_MEMBER_GROUP_ID });
  await db.upsertTelegramMember({ wallet_address: proW, telegram_user_id: proTg, tier: 'pro', in_group: false, group_status: 'invite_pending', group_id: process.env.TELEGRAM_PRO_GROUP_ID });
  await db.upsertTelegramMember({ wallet_address: freeW, telegram_user_id: freeTg, tier: 'member', entitlement_tier: 'free', in_group: false, group_status: 'not_joined' });
  await db.upsertTelegramMember({ wallet_address: unkW, telegram_user_id: unkTg, tier: 'member', in_group: false, group_status: 'invite_pending', group_id: process.env.TELEGRAM_MEMBER_GROUP_ID });
  await db.upsertTelegramMember({ wallet_address: ADMIN_WALLET, telegram_user_id: adminTg, tier: 'pro', entitlement_tier: 'admin', in_group: false, group_status: 'invite_pending', group_id: process.env.TELEGRAM_PRO_GROUP_ID });

  // 1a. Pro enters MEMBER group -> MUST reject from Member group, NEVER mark Pro joined or Member joined, redirect to Pro invite!
  const beforeKicks = mockState.kickedUsers.length;
  await sendWebhook({
    update_id: nextUid(),
    chat_member: { chat: { id: Number(process.env.TELEGRAM_MEMBER_GROUP_ID), type: 'supergroup' }, new_chat_member: { user: { id: proTg }, status: 'member' } },
  });
  assert.ok(
    mockState.kickedUsers.slice(beforeKicks).some((k) => String(k.chat_id) === process.env.TELEGRAM_MEMBER_GROUP_ID && k.user_id === proTg),
    'Pro wallet entering Member group must be evicted from Member group'
  );
  let proRec = await db.getTelegramMember(proW);
  assert.equal(proRec?.tier, 'pro', 'Pro wallet must NOT be converted to member');
  assert.equal(proRec?.in_group, false, 'Pro wallet must NOT be marked joined in either group');
  assert.equal(proRec?.group_status, 'invite_pending');
  assert.equal(proRec?.actual_group_tier, null);

  // 1b. Pro enters MEMBER group while banChatMember fails -> must record mismatch honestly & schedule reconciliation!
  mockState.failBanUser = true;
  await sendWebhook({
    update_id: nextUid(),
    chat_member: { chat: { id: Number(process.env.TELEGRAM_MEMBER_GROUP_ID), type: 'supergroup' }, new_chat_member: { user: { id: proTg }, status: 'member' } },
  });
  proRec = await db.getTelegramMember(proW);
  assert.equal(proRec?.group_status, 'mismatch');
  assert.equal(proRec?.actual_group_tier, 'member');
  assert.equal(proRec?.reconciliation_required, true);
  assert.equal(proRec?.in_group, false);

  // Recovery runs once bot regains ban permission -> clears mismatch & issues Pro invite!
  mockState.failBanUser = false;
  await tg.processRetryableMembershipEvents({ nowMs: Date.now() + 60_000 });
  proRec = await db.getTelegramMember(proW);
  assert.equal(proRec?.group_status, 'invite_pending');
  assert.equal(proRec?.actual_group_tier, null);
  assert.equal(proRec?.reconciliation_required, false);

  // 1c. Pro enters PRO group -> Accepted!
  await sendWebhook({
    update_id: nextUid(),
    chat_member: { chat: { id: Number(process.env.TELEGRAM_PRO_GROUP_ID), type: 'supergroup' }, new_chat_member: { user: { id: proTg }, status: 'member' } },
  });
  proRec = await db.getTelegramMember(proW);
  assert.equal(proRec?.group_status, 'joined');
  assert.equal(proRec?.actual_group_tier, 'pro');
  assert.equal(proRec?.in_group, true);

  // 1d. Member enters MEMBER group -> Accepted; Member enters PRO group -> Rejected
  await sendWebhook({
    update_id: nextUid(),
    chat_member: { chat: { id: Number(process.env.TELEGRAM_PRO_GROUP_ID), type: 'supergroup' }, new_chat_member: { user: { id: memTg }, status: 'member' } },
  });
  let memRec = await db.getTelegramMember(memW);
  assert.equal(memRec?.group_status, 'invite_pending');
  assert.equal(memRec?.actual_group_tier, null);

  await sendWebhook({
    update_id: nextUid(),
    chat_member: { chat: { id: Number(process.env.TELEGRAM_MEMBER_GROUP_ID), type: 'supergroup' }, new_chat_member: { user: { id: memTg }, status: 'member' } },
  });
  memRec = await db.getTelegramMember(memW);
  assert.equal(memRec?.group_status, 'joined');
  assert.equal(memRec?.actual_group_tier, 'member');

  // 1e. Free enters Member & Free enters Pro -> Both rejected!
  const kicksBeforeFree = mockState.kickedUsers.length;
  await sendWebhook({
    update_id: nextUid(),
    chat_member: { chat: { id: Number(process.env.TELEGRAM_MEMBER_GROUP_ID), type: 'supergroup' }, new_chat_member: { user: { id: freeTg }, status: 'member' } },
  });
  await sendWebhook({
    update_id: nextUid(),
    chat_member: { chat: { id: Number(process.env.TELEGRAM_PRO_GROUP_ID), type: 'supergroup' }, new_chat_member: { user: { id: freeTg }, status: 'member' } },
  });
  const freeKicks = mockState.kickedUsers.slice(kicksBeforeFree).filter((k) => k.user_id === freeTg);
  assert.equal(freeKicks.length, 2, 'Free user must be rejected from both Member and Pro groups');

  // 1f. Unknown entitlement joins group -> retryable reconciliation, not completed!
  const unkEvId = nextUid();
  await sendWebhook({
    update_id: unkEvId,
    chat_member: { chat: { id: Number(process.env.TELEGRAM_MEMBER_GROUP_ID), type: 'supergroup' }, new_chat_member: { user: { id: unkTg }, status: 'member' } },
  });
  const events = await db.listTelegramWebhookEvents();
  const unkStored = events.find((e) => e.update_id === unkEvId);
  assert.equal(unkStored?.status, 'retryable_failed', 'Unknown entitlement event must NOT mark completed');

  // 1g. Admin enters Pro then Member -> never kicked!
  const kicksBeforeAdmin = mockState.kickedUsers.length;
  await sendWebhook({
    update_id: nextUid(),
    chat_member: { chat: { id: Number(process.env.TELEGRAM_PRO_GROUP_ID), type: 'supergroup' }, new_chat_member: { user: { id: adminTg }, status: 'member' } },
  });
  await sendWebhook({
    update_id: nextUid(),
    chat_member: { chat: { id: Number(process.env.TELEGRAM_MEMBER_GROUP_ID), type: 'supergroup' }, new_chat_member: { user: { id: adminTg }, status: 'member' } },
  });
  assert.equal(
    mockState.kickedUsers.slice(kicksBeforeAdmin).filter((k) => k.user_id === adminTg).length,
    0,
    'Admin must never be kicked from Pro or Member group'
  );
  // Recover unkW as qualified Member -> ensure Fix 1's retryable event completes cleanly
  mockState.balancesRaw.set(unkW, '250000000000');
  mockState.rpcFailWallets.delete(unkW);
  const fix1Rec = await tg.processRetryableMembershipEvents({ nowMs: Date.now() + 60_000 });
  assert.equal(fix1Rec.completed, 1);
  assert.equal((await db.getTelegramMember(unkW))?.group_status, 'joined');
});

// ============================================================================
// FIX 2: Recoverable Membership Reconciliation, Backoff, Concurrency & Exhaustion
// ============================================================================
test('Fix 2: Recoverable membership events handle backoff schedule, concurrent workers, recovery, invalid payloads & exhaustion', async () => {
  const wallet = 'Fix2RetryWallet11111111111111111111111111';
  const tgId = 22001;
  mockState.balancesRaw.set(wallet, '250000000000'); // $25 Member
  mockState.rpcFailWallets.add(wallet);

  await db.upsertTelegramMember({
    wallet_address: wallet,
    telegram_user_id: tgId,
    tier: 'member',
    in_group: false,
    group_status: 'invite_pending',
    group_id: process.env.TELEGRAM_MEMBER_GROUP_ID,
  });

  // Step 1: Join webhook arrives during RPC outage -> durable retryable_failed (+30s backoff)
  const retryEventId = nextUid();
  const webhookRes = await sendWebhook({
    update_id: retryEventId,
    chat_member: {
      chat: { id: Number(process.env.TELEGRAM_MEMBER_GROUP_ID), type: 'supergroup' },
      new_chat_member: { user: { id: tgId }, status: 'member' },
    },
  });
  const webhookJson = await webhookRes.json();
  assert.equal(webhookRes.status, 200);
  assert.equal(webhookJson.status, 'retryable');

  let storedEv = (await db.listTelegramWebhookEvents()).find((e) => e.update_id === retryEventId);
  assert.equal(storedEv?.status, 'retryable_failed');
  assert.equal(storedEv?.attempt_count, 1);
  assert.ok(storedEv?.payload, 'Payload must be durably stored');

  // Verify due check respects backoff (immediate retry before 30s does not claim early)
  const earlyRec = await tg.processRetryableMembershipEvents({ nowMs: Date.now() + 10_000 });
  assert.equal(earlyRec.processed, 0, 'Must respect 30s backoff before Attempt 2');

  // Step 2: Advance beyond backoff across attempts & verify exponential delays up to 6th attempt exhaustion on separate event
  const exhaustWallet = 'Fix2ExhaustWallet11111111111111111111111';
  const exhaustTgId = 22002;
  mockState.rpcFailWallets.add(exhaustWallet);
  await db.upsertTelegramMember({
    wallet_address: exhaustWallet,
    telegram_user_id: exhaustTgId,
    tier: 'member',
    in_group: false,
    group_status: 'invite_pending',
    group_id: process.env.TELEGRAM_MEMBER_GROUP_ID,
  });
  const exhaustId = nextUid();
  await sendWebhook({
    update_id: exhaustId,
    chat_member: {
      chat: { id: Number(process.env.TELEGRAM_MEMBER_GROUP_ID), type: 'supergroup' },
      new_chat_member: { user: { id: exhaustTgId }, status: 'member' },
    },
  });

  // Now recover wallet for retryEventId cleanly BEFORE exhaustion, while keeping exhaustWallet failing!
  mockState.rpcFailWallets.delete(wallet);

  // Concurrent recovery workers -> leased claim ensures processed ONCE without duplicates
  const futureMs = Date.now() + 60_000;
  const [r1, r2] = await Promise.all([
    tg.processRetryableMembershipEvents({ nowMs: futureMs }),
    tg.processRetryableMembershipEvents({ nowMs: futureMs }),
  ]);
  assert.equal(r1.completed + r2.completed, 1, 'Recovered event must complete exactly once under concurrent workers');
  const recoveredMember = await db.getTelegramMember(wallet);
  assert.equal(recoveredMember?.group_status, 'joined', 'Recovered user must transition cleanly from invite_pending -> joined');
  assert.equal(recoveredMember?.actual_group_tier, 'member');
  assert.equal(recoveredMember?.in_group, true);

  storedEv = (await db.listTelegramWebhookEvents()).find((e) => e.update_id === retryEventId);
  assert.equal(storedEv?.status, 'completed');

  // Exhaust retries on exhaustId (up to attempt 6 -> permanently_failed)
  let simClock = Date.now() + 120_000;
  for (let step = 0; step < 6; step++) {
    simClock += 60 * 60 * 1000;
    await tg.processRetryableMembershipEvents({ nowMs: simClock });
  }
  const exhaustedEv = (await db.listTelegramWebhookEvents()).find((e) => e.update_id === exhaustId);
  assert.equal(exhaustedEv?.status, 'permanently_failed', 'Exhausted event must transition to permanently_failed and stop retrying');
  assert.equal(exhaustedEv?.attempt_count, 6);

  // Verify malformed payload during recovery marks permanently_failed instead of looping forever
  const badEvId = nextUid();
  await db.persistRetryableMembershipEvent({
    updateId: badEvId,
    eventType: 'chat_member',
    payload: { broken: true },
    reason: 'simulated_corrupt_payload',
    nowMs: Date.now() - 60_000,
  });
  const badRecovery = await tg.processRetryableMembershipEvents({ nowMs: Date.now() + 60_000 });
  assert.ok(badRecovery.permanentlyFailed >= 1);
  const badEv = (await db.listTelegramWebhookEvents()).find((e) => e.update_id === badEvId);
  assert.equal(badEv?.status, 'permanently_failed');

  // Verify /api/telegram/dispatch-delayed cron endpoint invokes membership recovery automatically
  const delayedRes = await dispatchDelayedRoute.GET(
    new NextRequest('http://localhost/api/telegram/dispatch-delayed', {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    })
  );
  assert.equal(delayedRes.status, 200);
  const delayedJson = await delayedRes.json();
  assert.ok(delayedJson.membershipRecovery, 'Scheduled dispatch worker must run retryable membership recovery');
  mockState.rpcFailWallets.delete(exhaustWallet);
});

// ============================================================================
// FIX 3: Independent Free-Tier Notification Revocation & Fan-Out Enforcement
// ============================================================================
test('Fix 3: Revokes Free notification entitlement across Joined/Left/NotJoined/InvitePending & preserves preference/delayed Member rules', async () => {
  const freeJoinedW = 'Fix3FreeJoined111111111111111111111111111';
  const freeLeftW = 'Fix3FreeLeft11111111111111111111111111111';
  const freeNotJoinedW = 'Fix3FreeNotJoined1111111111111111111111';
  const freePendingW = 'Fix3FreePending111111111111111111111111';
  const memLeftW = 'Fix3MemLeft111111111111111111111111111111';
  const proNotJoinedW = 'Fix3ProNotJoined11111111111111111111111';

  mockState.balancesRaw.set(memLeftW, '250000000000'); // $25 Member
  mockState.balancesRaw.set(proNotJoinedW, '250000000000');
  await db.createStake({
    wallet_address: proNotJoinedW,
    amount_raw: '3000000000000',
    lock_days: 90,
    tx_signature: `fix3_pro_${crypto.randomUUID()}`,
  });

  const configs = [
    [freeJoinedW, 33001, 'member', 'joined', true],
    [freeLeftW, 33002, 'member', 'left', false],
    [freeNotJoinedW, 33003, 'member', 'not_joined', false],
    [freePendingW, 33004, 'member', 'invite_pending', false],
    [memLeftW, 33005, 'member', 'left', false],
    [proNotJoinedW, 33006, 'pro', 'not_joined', false],
  ];

  for (const [w, uid, t, gs, inGrp] of configs) {
    await db.upsertTelegramMember({
      wallet_address: w,
      telegram_user_id: uid,
      tier: t,
      in_group: inGrp,
      group_status: gs,
      group_id: inGrp ? process.env.TELEGRAM_MEMBER_GROUP_ID : null,
    });
    // All users opted into private alerts while previously qualified
    await db.setTelegramNotificationStatus(w, 'enabled', {
      telegram_user_id: uid,
      telegram_chat_id: String(uid),
    });
  }

  // Sweep now runs while first 4 wallets have 0 $H42 (Free!) -> ALL 4 must lose notification entitlement!
  await tg.sweepGroupMembers();

  for (const freeW of [freeJoinedW, freeLeftW, freeNotJoinedW, freePendingW]) {
    const rec = await db.getTelegramMember(freeW);
    assert.equal(rec?.notification_status, 'disabled', `${freeW} must have notifications disabled`);
    assert.equal(rec?.notification_entitlement_allowed, false, `${freeW} notification entitlement must be false`);
    assert.equal(rec?.notification_preference, 'enabled', `${freeW} explicit user preference must be preserved`);
    assert.equal(rec?.identity_status, 'connected', `${freeW} Telegram identity must stay preserved`);
  }
  assert.equal((await db.getTelegramMember(freeLeftW))?.group_status, 'left', 'Leaving group status must remain intact when Free');

  // Member+Left & Pro+NotJoined remain entitled & enabled!
  assert.equal((await db.getTelegramMember(memLeftW))?.notification_status, 'enabled');
  assert.equal((await db.getTelegramMember(proNotJoinedW))?.notification_status, 'enabled');

  // General call fan-out: Pro NotJoined receives immediately; Free users receive NOTHING; Member Left queued for 5m delay (test via TP alert immediate!)
  const generalCall = {
    id: 'fix3-gen-call',
    name: 'GeneralToken',
    ticker: 'GEN',
    chain: 'SOL',
    ca: 'So11111111111111111111111111111111111111112',
    entryMarketCap: '$200K',
    risk: 2,
    stopLoss: '-25% SL',
    takeProfits: [{ label: '2x', multiple: 2, hit: false }],
    minTier: 'LAB_MEMBER',
    isMaxAlpha: false,
  };
  const beforeCallMsg = mockState.sentMessages.length;
  await tg.notifyNewCall(generalCall);
  const newCallChats = mockState.sentMessages.slice(beforeCallMsg).map((m) => m.chat_id);
  assert.deepEqual(newCallChats, [33006], 'Only Pro NotJoined gets instant general call; none of Free Left/Joined/Pending/NotJoined');

  const beforeTpMsg = mockState.sentMessages.length;
  await tg.notifyTpTriggered(generalCall, '2x', '$400K');
  const tpChats = mockState.sentMessages.slice(beforeTpMsg).map((m) => m.chat_id);
  assert.ok(tpChats.includes(33006), 'Pro+NotJoined receives general TP alert');
  assert.ok(tpChats.includes(33005), 'Member+Left still eligible for general TP alert');
  for (const freeUid of [33001, 33002, 33003, 33004]) {
    assert.ok(!tpChats.includes(freeUid), `Free chat ${freeUid} must NEVER receive restricted alerts`);
  }

  // Simulate stale subscriber re-forcing Free record -> still denied by fan-out!
  await db.setTelegramNotificationStatus(freeLeftW, 'enabled', { telegram_user_id: 33002, telegram_chat_id: '33002' });
  const beforeStaleTp = mockState.sentMessages.length;
  await tg.notifyTpTriggered(generalCall, '2x', '$450K');
  const staleChats = mockState.sentMessages.slice(beforeStaleTp).map((m) => m.chat_id);
  assert.ok(!staleChats.includes(33002), 'Stale subscriber mapping for Free wallet must NEVER bypass fan-out check');
});

// ============================================================================
// FIX 4: Requalification After Previous Revocation (Member -> Pro, Free -> Member, Expiry)
// ============================================================================
test('Fix 4: Previously revoked users regain access upon requalification without duplicating active invites', async () => {
  const revMemToPro = 'Fix4RevMemToPro11111111111111111111111111';
  const revFreeToMem = 'Fix4RevFreeToMem1111111111111111111111111';
  const stayFree = 'Fix4StayFree11111111111111111111111111111';

  // Seed 3 previously revoked records (also test with notification_preference='enabled')
  for (const [w, uid, t] of [
    [revMemToPro, 44001, 'member'],
    [revFreeToMem, 44002, 'member'],
    [stayFree, 44003, 'pro'],
  ]) {
    await db.upsertTelegramMember({
      wallet_address: w,
      telegram_user_id: uid,
      tier: t,
      entitlement_tier: t,
      in_group: true,
      group_status: 'joined',
      group_id: t === 'pro' ? process.env.TELEGRAM_PRO_GROUP_ID : process.env.TELEGRAM_MEMBER_GROUP_ID,
    });
    await db.setTelegramNotificationStatus(w, 'enabled', { telegram_user_id: uid, telegram_chat_id: String(uid) });
    await db.updateTelegramGroupMembership(w, {
      group_status: 'revoked',
      entitlement_tier: 'free',
      revoked_reason: 'Prior balance fell below threshold',
      disable_notifications: true,
    });
  }

  // Re-qualify revMemToPro -> Pro, revFreeToMem -> Member; stayFree remains Free!
  mockState.balancesRaw.set(revMemToPro, '250000000000');
  await db.createStake({
    wallet_address: revMemToPro,
    amount_raw: '3000000000000',
    lock_days: 90,
    tx_signature: `fix4_stake_${crypto.randomUUID()}`,
  });
  mockState.balancesRaw.set(revFreeToMem, '250000000000');

  const invitesBefore = mockState.inviteSeq;
  const sweep1 = await tg.sweepGroupMembers();
  assert.ok(sweep1.upgradedToPro >= 1);

  const recPro = await db.getTelegramMember(revMemToPro);
  assert.equal(recPro?.tier, 'pro');
  assert.equal(recPro?.entitlement_tier, 'pro');
  assert.equal(recPro?.group_status, 'invite_pending');
  assert.equal(recPro?.in_group, false, 'Must NEVER falsely mark joined before chat_member confirms');
  assert.equal(recPro?.notification_status, 'enabled', 'Opted-in notification preference must be restored on requalification');
  assert.ok((recPro?.historical_revocations?.length ?? 0) >= 1, 'Historical revocation audit trail preserved');

  const recMem = await db.getTelegramMember(revFreeToMem);
  assert.equal(recMem?.tier, 'member');
  assert.equal(recMem?.group_status, 'invite_pending');
  assert.equal(recMem?.in_group, false);
  assert.equal(recMem?.notification_status, 'enabled');

  const recFree = await db.getTelegramMember(stayFree);
  assert.equal(recFree?.group_status, 'revoked');
  assert.equal(recFree?.notification_status, 'disabled');
  assert.equal(recFree?.pending_invite_link, null, 'Free revoked user must never get an invite');

  const invitesAfterFirstSweep = mockState.inviteSeq;
  assert.equal(invitesAfterFirstSweep - invitesBefore, 2, 'Should issue exactly 2 invites (Pro + Member)');

  // Idempotent second sweep while active invites are valid -> zero duplicate invites!
  await tg.sweepGroupMembers();
  assert.equal(mockState.inviteSeq, invitesAfterFirstSweep, 'Valid active invitations must NOT be duplicated');

  // Simulate expired invitation -> sweep must replace expired invite cleanly!
  await db.updateTelegramGroupMembership(revFreeToMem, {
    group_status: 'invite_pending',
    group_id: process.env.TELEGRAM_MEMBER_GROUP_ID,
    invite_expires_at: new Date(Date.now() - 60_000).toISOString(),
  });
  await tg.sweepGroupMembers();
  assert.equal(mockState.inviteSeq, invitesAfterFirstSweep + 1, 'Expired invite must be replaced with fresh invite');

  // Confirm Pro group entry via chat_member -> joined!
  await sendWebhook({
    update_id: nextUid(),
    chat_member: {
      chat: { id: Number(process.env.TELEGRAM_PRO_GROUP_ID), type: 'supergroup' },
      new_chat_member: { user: { id: 44001 }, status: 'member' },
    },
  });
  const finalPro = await db.getTelegramMember(revMemToPro);
  assert.equal(finalPro?.group_status, 'joined');
  assert.equal(finalPro?.actual_group_tier, 'pro');
  assert.equal(finalPro?.in_group, true);
});

// ============================================================================
// FIX 5: /status & Verification Status API Distinguish Actual Group vs Entitlement
// ============================================================================
test('Fix 5: /status accurately separates Eligible Community, Actual Group, Mismatch, Left, Free, Unknown & Notifications', async () => {
  // Helper to run /status via webhook & read reply text
  async function getStatusReply(tgId) {
    const before = mockState.sentMessages.length;
    await sendWebhook({
      update_id: nextUid(),
      message: { chat: { id: tgId, type: 'private' }, from: { id: tgId }, text: '/status' },
    });
    return mockState.sentMessages.slice(before).pop()?.text || '';
  }

  // Case 1: Pro wallet stuck with old MEMBER joined record (Mismatch)
  const mismatchW = 'Fix5MismatchPro11111111111111111111111111';
  const mismatchTg = 55001;
  await db.createStake({
    wallet_address: mismatchW,
    amount_raw: '3000000000000',
    lock_days: 90,
    tx_signature: `fix5_mis_${crypto.randomUUID()}`,
  });
  await db.upsertTelegramMember({
    wallet_address: mismatchW,
    telegram_user_id: mismatchTg,
    tier: 'member',
    in_group: true,
    group_status: 'joined',
    group_id: process.env.TELEGRAM_MEMBER_GROUP_ID,
  });
  await db.setTelegramNotificationStatus(mismatchW, 'enabled', { telegram_user_id: mismatchTg, telegram_chat_id: String(mismatchTg) });

  const mismatchText = await getStatusReply(mismatchTg);
  assert.ok(mismatchText.includes('Tier: <b>PRO</b>'));
  assert.ok(mismatchText.includes('Eligible Community: Pro'));
  assert.ok(mismatchText.includes('Actual Group: Member'));
  assert.ok(mismatchText.includes('Group Membership: <b>Mismatch</b>'));
  assert.ok(mismatchText.includes('requires synchronization'));
  assert.ok(!mismatchText.includes('Actual Group: Pro'), 'Must NEVER derive Actual Group from Pro entitlement');
  assert.ok(!mismatchText.includes('Group Membership: <b>Joined</b>'), 'Pro with Member group must NEVER say Joined');

  // Dashboard /api/verification/status also reports mismatch & connected=false!
  const apiRes = await statusRoute.GET(
    new NextRequest('http://localhost/api/verification/status', { headers: { Cookie: cookieFor(mismatchW) } })
  );
  const apiJson = await apiRes.json();
  assert.equal(apiJson.entitlement.tier, 'pro');
  assert.equal(apiJson.telegram.community.status, 'mismatch');
  assert.equal(apiJson.telegram.community.eligibleCommunity, 'pro');
  assert.equal(apiJson.telegram.community.actualGroup, 'member');
  assert.equal(apiJson.telegram.connected, false);

  // Case 1b: Member entitlement with stale PRO group record (reverse mismatch!)
  const memInProW = 'Fix5MemInPro11111111111111111111111111111';
  const memInProTg = 55009;
  mockState.balancesRaw.set(memInProW, '250000000000'); // $25 Member only
  await db.upsertTelegramMember({
    wallet_address: memInProW,
    telegram_user_id: memInProTg,
    tier: 'pro',
    in_group: true,
    group_status: 'joined',
    group_id: process.env.TELEGRAM_PRO_GROUP_ID,
  });
  const memInProText = await getStatusReply(memInProTg);
  assert.ok(memInProText.includes('Tier: <b>MEMBER</b>'));
  assert.ok(memInProText.includes('Eligible Community: Member'));
  assert.ok(memInProText.includes('Actual Group: Pro'));
  assert.ok(memInProText.includes('Group Membership: <b>Mismatch</b>'));
  assert.ok(!memInProText.includes('Group Membership: <b>Joined</b>'));

  // Case 2: Correct Pro membership
  const proOkW = 'Fix5ProOk11111111111111111111111111111111';
  const proOkTg = 55002;
  await db.createStake({
    wallet_address: proOkW,
    amount_raw: '3000000000000',
    lock_days: 90,
    tx_signature: `fix5_ok_${crypto.randomUUID()}`,
  });
  await db.upsertTelegramMember({
    wallet_address: proOkW,
    telegram_user_id: proOkTg,
    tier: 'pro',
    in_group: true,
    group_status: 'joined',
    group_id: process.env.TELEGRAM_PRO_GROUP_ID,
  });
  await db.setTelegramNotificationStatus(proOkW, 'enabled', { telegram_user_id: proOkTg, telegram_chat_id: String(proOkTg) });
  const proOkText = await getStatusReply(proOkTg);
  assert.ok(proOkText.includes('Eligible Community: Pro'));
  assert.ok(proOkText.includes('Actual Group: Pro'));
  assert.ok(proOkText.includes('Group Membership: <b>Joined</b>'));
  assert.ok(proOkText.includes('Private Notifications: <b>Enabled</b>'));

  // Case 3: Pro invitation pending
  const proPendW = 'Fix5ProPend111111111111111111111111111111';
  const proPendTg = 55003;
  await db.createStake({
    wallet_address: proPendW,
    amount_raw: '3000000000000',
    lock_days: 90,
    tx_signature: `fix5_pend_${crypto.randomUUID()}`,
  });
  await db.upsertTelegramMember({
    wallet_address: proPendW,
    telegram_user_id: proPendTg,
    tier: 'pro',
    in_group: false,
    group_status: 'invite_pending',
    group_id: process.env.TELEGRAM_PRO_GROUP_ID,
  });
  const proPendText = await getStatusReply(proPendTg);
  assert.ok(proPendText.includes('Eligible Community: Pro'));
  assert.ok(proPendText.includes('Actual Group: None'));
  assert.ok(proPendText.includes('Group Membership: <b>Invitation Pending</b>'));
  assert.ok(proPendText.includes('Private Notifications: <b>Disabled</b>'));

  // Case 4: Member left group (wallet remains Member + alerts preserved!)
  const memLeftW = 'Fix5MemLeft111111111111111111111111111111';
  const memLeftTg = 55004;
  mockState.balancesRaw.set(memLeftW, '250000000000');
  await db.upsertTelegramMember({
    wallet_address: memLeftW,
    telegram_user_id: memLeftTg,
    tier: 'member',
    in_group: false,
    group_status: 'left',
  });
  await db.setTelegramNotificationStatus(memLeftW, 'enabled', { telegram_user_id: memLeftTg, telegram_chat_id: String(memLeftTg) });
  const memLeftText = await getStatusReply(memLeftTg);
  assert.ok(memLeftText.includes('Tier: <b>MEMBER</b>'));
  assert.ok(memLeftText.includes('Eligible Community: Member'));
  assert.ok(memLeftText.includes('Actual Group: None'));
  assert.ok(memLeftText.includes('Group Membership: <b>Left</b>'));
  assert.ok(memLeftText.includes('Private Notifications: <b>Enabled</b>'));

  // Case 5: Free user
  const freeW = 'Fix5Free111111111111111111111111111111111';
  const freeTg = 55005;
  await db.upsertTelegramMember({
    wallet_address: freeW,
    telegram_user_id: freeTg,
    tier: 'member',
    entitlement_tier: 'free',
    in_group: false,
    group_status: 'not_joined',
  });
  const freeText = await getStatusReply(freeTg);
  assert.ok(freeText.includes('Tier: <b>FREE</b>'));
  assert.ok(freeText.includes('Eligible Community: None'));
  assert.ok(freeText.includes('Actual Group: None'));
  assert.ok(freeText.includes('Not Eligible'));
  assert.ok(freeText.includes('Private Notifications: <b>Disabled</b>'));

  // Case 6: Unknown entitlement
  const unkW = 'Fix5Unknown111111111111111111111111111111';
  const unkTg = 55006;
  mockState.rpcFailWallets.add(unkW);
  await db.upsertTelegramMember({
    wallet_address: unkW,
    telegram_user_id: unkTg,
    tier: 'pro',
    in_group: false,
    group_status: 'invite_pending',
  });
  const unkText = await getStatusReply(unkTg);
  assert.ok(unkText.includes('Temporarily Unavailable'));
  assert.ok(unkText.includes('Requires Reverification'));
  assert.ok(unkText.includes('Current Eligibility Unavailable'));
  assert.ok(unkText.includes('Retry verification later'));
  mockState.rpcFailWallets.delete(unkW);

  // Case 7: Disconnected / unlinked Telegram user
  const unlinkedText = await getStatusReply(55999);
  assert.ok(unlinkedText.includes('Wallet: Not Connected'));
  assert.ok(unlinkedText.includes('Telegram Identity: Not Connected'));
});
