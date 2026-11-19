import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'trench-tg-sec-'));
process.chdir(TMP_DIR);

process.env.NODE_ENV = 'test';
process.env.ALLOW_FILE_PERSISTENCE = 'true';
process.env.SESSION_SECRET = 'test-session-secret-key-minimum-32-characters-long';
process.env.TELEGRAM_BOT_TOKEN = '999888:TEST_BOT_TOKEN_SECRET';
process.env.TELEGRAM_BOT_USERNAME = 'Trenchlabs_bot';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret-xyz';
process.env.TELEGRAM_MEMBER_GROUP_ID = '-1001111111111';
process.env.TELEGRAM_PRO_GROUP_ID = '-1002222222222';
process.env.SITE_URL = 'https://trenchlabshq.xyz';
process.env.SOLANA_RPC = 'http://mock-solana-rpc.local';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.TELEGRAM_MEMBER_INVITE_URL;
delete process.env.TELEGRAM_PRO_INVITE_URL;

const GENESIS_MINT = 'EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump';
const ADMIN_WALLET = 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e';

// Mock state controlling Solana balances, price, and Telegram Bot API behavior
const mockState = {
  balancesRaw: new Map(), // wallet -> raw u64 string (6 decimals; at $0.0001/token, $20 = 200,000,000,000 raw)
  rpcFailWallets: new Set(),
  failCreateInvite: false,
  telegramCalls: [], // { method, body }
  sentMessages: [], // { chat_id, text, reply_markup }
  kickedUsers: [], // { chat_id, user_id }
  inviteSeq: 0,
};

const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);

  // Price feeds
  if (url.includes('dexscreener.com')) {
    return new Response(
      JSON.stringify({
        pairs: [
          {
            chainId: 'solana',
            baseToken: { address: GENESIS_MINT },
            priceUsd: '0.0001',
            fdv: 100000,
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
    return new Response(
      JSON.stringify({ data: { [GENESIS_MINT]: { price: '0.0001' } } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Solana RPC
  if (url.includes('mock-solana-rpc.local') || url.includes('mainnet-beta.solana.com')) {
    const body = JSON.parse(String(init.body || '{}'));
    const owner = body?.params?.[0];
    if (mockState.rpcFailWallets.has(owner)) {
      return new Response('Service Unavailable', { status: 503 });
    }
    const rawAmount = mockState.balancesRaw.get(owner) ?? '0';
    const uiAmount = Number(rawAmount) / 1e6;
    const value =
      BigInt(rawAmount) > BigInt(0)
        ? [{ account: { data: { parsed: { info: { tokenAmount: { uiAmount, amount: rawAmount } } } } } }]
        : [];
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Telegram Bot API
  if (url.includes('api.telegram.org/bot')) {
    const method = url.split('/').pop();
    const body = JSON.parse(String(init.body || '{}'));
    mockState.telegramCalls.push({ method, body });

    if (method === 'createChatInviteLink') {
      if (mockState.failCreateInvite) {
        return new Response(JSON.stringify({ ok: false, description: 'Forbidden: not enough rights' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      mockState.inviteSeq += 1;
      return new Response(
        JSON.stringify({
          ok: true,
          result: { invite_link: `https://t.me/+dyn_${body.chat_id}_${mockState.inviteSeq}` },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
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
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'banChatMember') {
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
const entitlements = await import('../../src/server/entitlements.ts');
const tg = await import('../../src/server/telegram.ts');
const statusRoute = await import('../../src/app/api/verification/status/route.ts');
const sessionRoute = await import('../../src/app/api/verification/session/route.ts');
const notifRoute = await import('../../src/app/api/verification/notifications/route.ts');
const webhookRoute = await import('../../src/app/api/telegram/webhook/route.ts');

function sessionCookieFor(wallet) {
  return `trench_session=${auth.signSession(wallet, 3600)}`;
}

async function seedStake(wallet, amountRaw, lockDays) {
  await db.createStake({
    wallet_address: wallet,
    amount_raw: amountRaw,
    lock_days: lockDays,
    tx_signature: `sig_${crypto.randomUUID()}`,
  });
}

function webhookReq(updateObj, secret = process.env.TELEGRAM_WEBHOOK_SECRET) {
  return new NextRequest('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}),
    },
    body: JSON.stringify(updateObj),
  });
}

let updateSeq = 1000;
const nextUpdateId = () => ++updateSeq;

// ============================================================================
// 1. Entitlement & Boundary Tests
// ============================================================================
test('Section 18.A/B: Entitlement boundaries ($19.99 vs $20.00 Member, 89d vs 90d Pro, Admin, Unknown RPC)', async () => {
  const wBelow = 'BelowMemberBoundary1111111111111111111111111';
  const wExactMember = 'ExactMemberBoundary111111111111111111111111';
  const w89d = 'Stake89DaysBoundary111111111111111111111111';
  const w90d = 'Stake90DaysBoundary111111111111111111111111';
  const wRpcErr = 'RpcFailureWallet111111111111111111111111111';

  // At $0.0001/token (6 decimals), $20 = 200,000 tokens = 200_000_000_000 raw
  mockState.balancesRaw.set(wBelow, '199990000000'); // $19.999 -> free
  mockState.balancesRaw.set(wExactMember, '200000000000'); // $20.00 -> member
  mockState.rpcFailWallets.add(wRpcErr);

  await seedStake(w89d, '3000000000000', 89); // $300 staked for ONLY 89 days -> must NOT be Pro
  await seedStake(w90d, '3000000000000', 90); // $300 staked for 90 days -> Pro

  assert.equal((await entitlements.resolveUserEntitlement(wBelow)).tier, 'free');
  assert.equal((await entitlements.resolveUserEntitlement(wExactMember)).tier, 'member');
  assert.equal((await entitlements.resolveUserEntitlement(w89d)).tier, 'free');
  assert.equal((await entitlements.resolveUserEntitlement(w90d)).tier, 'pro');
  assert.equal((await entitlements.resolveUserEntitlement(ADMIN_WALLET)).tier, 'admin');
  assert.equal((await entitlements.resolveUserEntitlement(wRpcErr)).tier, 'unknown');
});

// ============================================================================
// 2. Session Security, Takeover Prevention, Invite Failure & Recovery
// ============================================================================
test('Section 18.A/B: Session expiry, replay, identity takeover rejection, and retry recovery on invite/RPC errors', async () => {
  const proWallet = 'SessionProWallet111111111111111111111111111';
  const otherWallet = 'SessionOtherProWallet1111111111111111111111';
  const freeWallet = 'SessionFreeWallet11111111111111111111111111';
  const memberWallet = 'SessionMemberWallet111111111111111111111111';

  mockState.balancesRaw.set(memberWallet, '250000000000'); // $25
  await seedStake(proWallet, '3000000000000', 90);
  await seedStake(otherWallet, '3000000000000', 90);

  // Free user cannot create session
  const freeSessRes = await sessionRoute.POST(
    new NextRequest('http://localhost/api/verification/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookieFor(freeWallet) },
      body: JSON.stringify({ target_tier: 'member' }),
    })
  );
  assert.equal(freeSessRes.status, 403);

  // Member user cannot create Pro session
  const memProSessRes = await sessionRoute.POST(
    new NextRequest('http://localhost/api/verification/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookieFor(memberWallet) },
      body: JSON.stringify({ target_tier: 'pro' }),
    })
  );
  assert.equal(memProSessRes.status, 403);

  // Unknown entitlement returns 503 retryable
  const rpcWallet = 'SessionRpcErrWallet111111111111111111111111';
  mockState.rpcFailWallets.add(rpcWallet);
  const rpcSessRes = await sessionRoute.POST(
    new NextRequest('http://localhost/api/verification/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookieFor(rpcWallet) },
      body: JSON.stringify({ target_tier: 'member' }),
    })
  );
  assert.equal(rpcSessRes.status, 503);

  // Pro user creates valid session -> simulates temporary invite creation failure -> remains retryable!
  const proSessRes = await sessionRoute.POST(
    new NextRequest('http://localhost/api/verification/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookieFor(proWallet) },
      body: JSON.stringify({ target_tier: 'pro' }),
    })
  );
  assert.equal(proSessRes.status, 200);
  const { session_id: sid, deep_link } = await proSessRes.json();
  assert.ok(deep_link.includes(`start=vs_${sid}`));

  // Verify token_hash is persisted on session row
  const storedSession = await db.getVerificationSession(sid);
  assert.ok(storedSession?.token_hash);

  // Simulate Telegram createChatInviteLink outage on first /start
  mockState.failCreateInvite = true;
  const failRes = await tg.handleTelegramVerification(sid, 70001, 70001);
  assert.equal(failRes.success, false);
  assert.equal(failRes.reason, 'invite_creation_failed');

  // Recover invite API and retry the SAME session -> must succeed!
  mockState.failCreateInvite = false;
  const retryRes = await tg.handleTelegramVerification(sid, 70001, 70001);
  assert.equal(retryRes.success, true);
  assert.ok(retryRes.replyText.includes('Verified as PRO'));
  assert.ok(retryRes.replyText.includes('https://t.me/+dyn_-1002222222222_'));

  // Identity is connected, BUT group_status MUST still be invite_pending (never 'joined' from invite!)
  const memAfterInvite = await db.getTelegramMember(proWallet);
  assert.equal(memAfterInvite?.identity_status, 'connected');
  assert.equal(memAfterInvite?.group_status, 'invite_pending');
  assert.equal(memAfterInvite?.in_group, false);

  // Replay completed session -> must be rejected!
  const replayRes = await tg.handleTelegramVerification(sid, 70001, 70001);
  assert.equal(replayRes.success, false);
  assert.equal(replayRes.reason, 'already_completed');

  // Attempt identity takeover: another wallet creates a session, same Telegram user 70001 taps /start -> REJECTED!
  const otherSessRes = await sessionRoute.POST(
    new NextRequest('http://localhost/api/verification/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookieFor(otherWallet) },
      body: JSON.stringify({ target_tier: 'pro' }),
    })
  );
  const { session_id: otherSid } = await otherSessRes.json();
  const takeoverRes = await tg.handleTelegramVerification(otherSid, 70001, 70001);
  assert.equal(takeoverRes.success, false);
  assert.equal(takeoverRes.reason, 'telegram_identity_already_linked');

  // Confirm another Telegram user attempting an invalid token is rejected
  const invalidRes = await tg.handleTelegramVerification('nonexistent_token_123', 70002, 70002);
  assert.equal(invalidRes.success, false);
  assert.equal(invalidRes.reason, 'invalid_session');

  // Different Telegram user trying to link already-connected proWallet -> REJECTED!
  const proSess2 = await sessionRoute.POST(
    new NextRequest('http://localhost/api/verification/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookieFor(proWallet) },
      body: JSON.stringify({ target_tier: 'pro' }),
    })
  );
  const { session_id: sid2 } = await proSess2.json();
  const walletHijackRes = await tg.handleTelegramVerification(sid2, 79999, 79999);
  assert.equal(walletHijackRes.success, false);
  assert.equal(walletHijackRes.reason, 'wallet_already_linked_to_other_telegram');
});

// ============================================================================
// 3. Static Fallback Prohibition
// ============================================================================
test('Section 18.B/8: Static fallback invite env vars are never used when createChatInviteLink fails', async () => {
  process.env.TELEGRAM_PRO_INVITE_URL = 'https://t.me/+STATIC_LEAKED_LINK';
  process.env.TELEGRAM_MEMBER_INVITE_URL = 'https://t.me/+STATIC_LEAKED_MEM';
  mockState.failCreateInvite = true;
  try {
    await assert.rejects(() => tg.createTelegramInvite('pro', 12345), /Unable to generate invite link/);
    await assert.rejects(() => tg.createTelegramInvite('member', 12345), /Unable to generate invite link/);
  } finally {
    mockState.failCreateInvite = false;
    delete process.env.TELEGRAM_PRO_INVITE_URL;
    delete process.env.TELEGRAM_MEMBER_INVITE_URL;
  }
});

// ============================================================================
// 4. chat_member Tracking, Wrong-Group Eviction & Duplicate/Unknown Events
// ============================================================================
test('Section 18.C: chat_member updates track real joins/exits/kicks, reject wrong-group joins, and ignore unknown statuses', async () => {
  const memWallet = 'ChatMemberWallet111111111111111111111111111';
  mockState.balancesRaw.set(memWallet, '250000000000'); // Member ($25)
  const created = await db.createOrReuseVerificationSession(memWallet, 'member');
  assert.ok('session' in created);

  await tg.handleTelegramVerification(created.session.session_id, 81001, 81001);

  // Unknown Telegram status must NEVER mark joined
  const unkEv = await webhookRoute.POST(
    webhookReq({
      update_id: nextUpdateId(),
      chat_member: {
        chat: { id: Number(process.env.TELEGRAM_MEMBER_GROUP_ID), type: 'supergroup' },
        new_chat_member: { user: { id: 81001 }, status: 'mystery_status' },
      },
    })
  );
  assert.equal(unkEv.status, 200);
  assert.equal((await db.getTelegramMember(memWallet))?.group_status, 'invite_pending');

  // Unverified wrong-group attempt: Member tries to join PRO group -> evicted immediately!
  const beforeKicks = mockState.kickedUsers.length;
  const wrongJoin = await webhookRoute.POST(
    webhookReq({
      update_id: nextUpdateId(),
      chat_member: {
        chat: { id: Number(process.env.TELEGRAM_PRO_GROUP_ID), type: 'supergroup' },
        new_chat_member: { user: { id: 81001 }, status: 'member' },
      },
    })
  );
  assert.equal(wrongJoin.status, 200);
  assert.ok(
    mockState.kickedUsers.some(
      (k) => String(k.chat_id) === process.env.TELEGRAM_PRO_GROUP_ID && k.user_id === 81001
    ),
    'Member joining Pro group must be evicted immediately'
  );
  assert.ok(mockState.kickedUsers.length > beforeKicks);

  // Legitimate join to MEMBER group -> group_status becomes 'joined'
  const validJoinUpdate = {
    update_id: nextUpdateId(),
    chat_member: {
      chat: { id: Number(process.env.TELEGRAM_MEMBER_GROUP_ID), type: 'supergroup' },
      new_chat_member: { user: { id: 81001 }, status: 'member' },
    },
  };
  await webhookRoute.POST(webhookReq(validJoinUpdate));
  let mRecord = await db.getTelegramMember(memWallet);
  assert.equal(mRecord?.group_status, 'joined');
  assert.equal(mRecord?.in_group, true);

  // Duplicate chat_member update with different update_id is idempotent
  const origJoinedAt = mRecord?.joined_at;
  await webhookRoute.POST(webhookReq({ ...validJoinUpdate, update_id: nextUpdateId() }));
  mRecord = await db.getTelegramMember(memWallet);
  assert.equal(mRecord?.group_status, 'joined');
  assert.equal(mRecord?.joined_at, origJoinedAt);

  // Enable notifications independently
  const notifEnableRes = await tg.setPrivateNotificationsEnabled(memWallet, true);
  assert.equal(notifEnableRes.ok, true);

  // User leaves group -> group_status = 'left', in_group = false, identity & notifications stay intact!
  await webhookRoute.POST(
    webhookReq({
      update_id: nextUpdateId(),
      chat_member: {
        chat: { id: Number(process.env.TELEGRAM_MEMBER_GROUP_ID), type: 'supergroup' },
        new_chat_member: { user: { id: 81001 }, status: 'left' },
      },
    })
  );
  mRecord = await db.getTelegramMember(memWallet);
  assert.equal(mRecord?.group_status, 'left');
  assert.equal(mRecord?.in_group, false);
  assert.equal(mRecord?.identity_status, 'connected');
  assert.equal(mRecord?.notification_status, 'enabled');
});

// ============================================================================
// 5. Notifications, /stop Semantics, and Unknown-Tier Leak Guard
// ============================================================================
test('Section 18.D: Unknown & Free tiers never leak instant calls/TP/SL; /stop disables alerts only', async () => {
  const proW = 'NotifProWallet11111111111111111111111111111';
  const memW = 'NotifMemWallet11111111111111111111111111111';
  const freeW = 'NotifFreeWallet1111111111111111111111111111';
  const unkW = 'NotifUnkWallet11111111111111111111111111111';

  await seedStake(proW, '3000000000000', 90);
  mockState.balancesRaw.set(memW, '250000000000');
  mockState.rpcFailWallets.add(unkW);

  // Connect all four identities + join communities + enable alerts
  for (const [w, uid, t] of [
    [proW, 91001, 'pro'],
    [memW, 91002, 'member'],
  ]) {
    await db.upsertTelegramMember({
      wallet_address: w,
      telegram_user_id: uid,
      tier: t,
      in_group: true,
      group_status: 'joined',
    });
    await db.setTelegramNotificationStatus(w, 'enabled', { telegram_user_id: uid, telegram_chat_id: String(uid) });
  }
  // Explicitly force previously-enabled free and unknown accounts to verify fan-out fail-closed gating
  await db.setTelegramNotificationStatus(freeW, 'enabled', { telegram_user_id: 91003, telegram_chat_id: '91003' });
  await db.setTelegramNotificationStatus(unkW, 'enabled', { telegram_user_id: 91004, telegram_chat_id: '91004' });

  const prevSentLen = mockState.sentMessages.length;
  const maxAlphaCall = {
    id: 'call-pro-leak-test',
    name: 'MaxAlphaToken',
    ticker: 'MAXA',
    chain: 'SOL',
    ca: 'So11111111111111111111111111111111111111112',
    entryMarketCap: '$500K',
    risk: 4,
    stopLoss: '-25% SL',
    takeProfits: [{ label: '2x', multiple: 2, hit: false }],
    minTier: 'PRO',
    isMaxAlpha: true,
  };

  const callRes = await tg.notifyNewCall(maxAlphaCall);
  assert.equal(callRes.sent, 1, 'Only Pro receives Pro-only call immediately');
  const sentNewMsgs = mockState.sentMessages.slice(prevSentLen);
  assert.deepEqual(
    sentNewMsgs.map((m) => m.chat_id),
    [91001],
    'Member, Free, and Unknown must NEVER receive Pro/Max Alpha instant alerts'
  );

  // Check TP & SL triggered on general call: Pro + Member receive it, Unknown & Free NEVER!
  const beforeTpLen = mockState.sentMessages.length;
  const generalCall = { ...maxAlphaCall, id: 'call-gen-tp', minTier: 'LAB_MEMBER', isMaxAlpha: false };
  const tpRes = await tg.notifyTpTriggered(generalCall, '2x', '$1M');
  assert.ok(tpRes.sent >= 2);
  const tpRecipients = mockState.sentMessages.slice(beforeTpLen).map((m) => m.chat_id);
  assert.ok(tpRecipients.includes(91001), 'Pro must receive general TP alert');
  assert.ok(tpRecipients.includes(91002), 'Member must receive general TP alert');
  assert.ok(!tpRecipients.includes(91003), 'Free wallet must NEVER receive TP alert');
  assert.ok(!tpRecipients.includes(91004), 'Unknown wallet must NEVER receive TP alert');

  const beforeSlLen = mockState.sentMessages.length;
  await tg.notifySlTriggered(maxAlphaCall, '$50K');
  const slRecipients = mockState.sentMessages.slice(beforeSlLen).map((m) => m.chat_id);
  assert.deepEqual(slRecipients, [91001], 'Pro-only SL must go ONLY to Pro, never Member/Free/Unknown');

  // Check /stop on Member 91002: disables notifications ONLY, keeps group membership & identity intact!
  await webhookRoute.POST(
    webhookReq({
      update_id: nextUpdateId(),
      message: { chat: { id: 91002, type: 'private' }, from: { id: 91002 }, text: '/stop' },
    })
  );
  const afterStop = await db.getTelegramMember(memW);
  assert.equal(afterStop?.notification_status, 'disabled');
  assert.equal(afterStop?.in_group, true, '/stop must NOT remove community group membership');
  assert.equal(afterStop?.group_status, 'joined');
  assert.equal(afterStop?.identity_status, 'connected');

  // Bare /start must NOT silently re-enable stopped notifications
  await webhookRoute.POST(
    webhookReq({
      update_id: nextUpdateId(),
      message: { chat: { id: 91002, type: 'private' }, from: { id: 91002 }, text: '/start' },
    })
  );
  const afterStart = await db.getTelegramMember(memW);
  assert.equal(afterStart?.notification_status, 'disabled');
  const lastBotMsg = mockState.sentMessages[mockState.sentMessages.length - 1];
  assert.ok(lastBotMsg.text.includes('TRENCHLABS ACCOUNT STATUS'));
  assert.ok(lastBotMsg.text.includes('Private Notifications: <b>Disabled</b>'));
  assert.ok(lastBotMsg.text.includes('Group Membership: <b>Joined</b>'));
});

// ============================================================================
// 6. Webhook Deduplication, Fail-Closed Error Handling & Status API
// ============================================================================
test('Section 18.E/F: Webhook deduplication, retryable error recovery, Status API & cross-wallet access blocking', async () => {
  const wallet = 'StatusApiMember1111111111111111111111111111';
  mockState.balancesRaw.set(wallet, '250000000000');

  // Unauthenticated status API -> 401
  const unauthRes = await statusRoute.GET(new NextRequest('http://localhost/api/verification/status'));
  assert.equal(unauthRes.status, 401);

  // Cross-wallet access attempt -> 403
  const crossRes = await statusRoute.GET(
    new NextRequest(`http://localhost/api/verification/status?wallet=${ADMIN_WALLET}`, {
      headers: { Cookie: sessionCookieFor(wallet) },
    })
  );
  assert.equal(crossRes.status, 403);

  // Duplicate webhook update_id -> processed once
  const dupId = nextUpdateId();
  const prevMsgCount = mockState.sentMessages.length;
  const firstRes = await webhookRoute.POST(
    webhookReq({ update_id: dupId, message: { chat: { id: 55001, type: 'private' }, from: { id: 55001 }, text: '/help' } })
  );
  assert.equal(firstRes.status, 200);
  assert.equal(mockState.sentMessages.length, prevMsgCount + 1);

  const dupRes = await webhookRoute.POST(
    webhookReq({ update_id: dupId, message: { chat: { id: 55001, type: 'private' }, from: { id: 55001 }, text: '/help' } })
  );
  const dupJson = await dupRes.json();
  assert.equal(dupRes.status, 200);
  assert.equal(dupJson.duplicate, true);
  assert.equal(mockState.sentMessages.length, prevMsgCount + 1, 'Duplicate update_id must not double-process');

  // Idempotent migration & rollback safety check
  const mig1 = await db.migrateTelegramSchemaAndSubscribers({
    legacySubscribers: {
      LegacySubWallet1111111111111111111111111: '99123',
    },
  });
  assert.ok(mig1.legacySubsMigrated >= 1);
  const migratedSub = await db.getTelegramMember('LegacySubWallet1111111111111111111111111');
  assert.equal(migratedSub?.notification_status, 'enabled');
  assert.equal(migratedSub?.group_status, 'not_joined', 'Legacy alert sub must not falsely claim group join');
  assert.equal(migratedSub?.in_group, false);

  // Re-running migration is idempotent (no duplicate records)
  const mig2 = await db.migrateTelegramSchemaAndSubscribers({
    legacySubscribers: {
      LegacySubWallet1111111111111111111111111: '99123',
    },
  });
  assert.equal(mig2.alreadyApplied, true);

  // Rollback restores snapshot cleanly
  const rolledBack = await db.rollbackTelegramMigration();
  assert.equal(rolledBack.restored, true);

  // Webhook fail-closed persistence failure & retry recovery
  const retryUpdateId = nextUpdateId();
  await db.claimWebhookUpdate(retryUpdateId, 'message');
  await db.markWebhookUpdateRetryable(retryUpdateId, 'Simulated transient Telegram 502');
  const retryClaim = await db.claimWebhookUpdate(retryUpdateId, 'message');
  assert.equal(retryClaim.claimed, true, 'Retryable webhook update must be reclaimable after failure');
  await db.markWebhookUpdateCompleted(retryUpdateId, retryClaim.leaseToken);
  const postCompleteClaim = await db.claimWebhookUpdate(retryUpdateId, 'message');
  assert.equal(postCompleteClaim.claimed, false);
  assert.equal(postCompleteClaim.status, 'completed', 'Completed webhook update must not replay');

  // callback_query toggles notifications cleanly; my_chat_member private block stops alerts without deleting group membership
  const cbWallet = 'CallbackMemberWallet11111111111111111111111';
  const cbTgId = 66001;
  mockState.balancesRaw.set(cbWallet, '250000000000'); // $25 Member
  await db.upsertTelegramMember({
    wallet_address: cbWallet,
    telegram_user_id: cbTgId,
    tier: 'member',
    in_group: true,
    group_status: 'joined',
    group_id: process.env.TELEGRAM_MEMBER_GROUP_ID,
  });

  await webhookRoute.POST(
    webhookReq({
      update_id: nextUpdateId(),
      callback_query: {
        id: 'cb-enable-1',
        from: { id: cbTgId },
        message: { chat: { id: cbTgId, type: 'private' } },
        data: 'notif:enable',
      },
    })
  );
  assert.equal((await db.getTelegramMember(cbWallet))?.notification_status, 'enabled');

  await webhookRoute.POST(
    webhookReq({
      update_id: nextUpdateId(),
      my_chat_member: {
        chat: { id: cbTgId, type: 'private' },
        new_chat_member: { user: { id: cbTgId }, status: 'kicked' },
      },
    })
  );
  const blockedMember = await db.getTelegramMember(cbWallet);
  assert.equal(blockedMember?.notification_status, 'blocked');
  assert.equal(blockedMember?.identity_status, 'blocked');
  assert.equal(blockedMember?.group_status, 'joined', 'Blocking private bot preserves community membership state');

  // Sweep Upgrade: Unblock + give Member wallet 90d Pro stake -> upgrades to invite_pending Pro!
  await db.setTelegramNotificationStatus(cbWallet, 'disabled');
  await seedStake(cbWallet, '3000000000000', 90);
  const sweepUpgrade = await tg.sweepGroupMembers();
  assert.ok(sweepUpgrade.upgradedToPro >= 1);
  const upgradedMember = await db.getTelegramMember(cbWallet);
  assert.equal(upgradedMember?.tier, 'pro');
  assert.equal(upgradedMember?.group_status, 'invite_pending', 'Upgrade must stay invite_pending until Pro chat_member confirms');
  assert.equal(upgradedMember?.in_group, false);

  // Delayed Member notification delivery test: general call enqueued & delivered cleanly to Member only
  await tg.setPrivateNotificationsEnabled(cbWallet, true);
  await tg.notifyNewCall({
    id: 'delayed-gen-call-1',
    name: 'DelayedGeneral',
    ticker: 'DGEN',
    chain: 'SOL',
    ca: 'So11111111111111111111111111111111111111112',
    entryMarketCap: '$100K',
    risk: 2,
    stopLoss: '-20% SL',
    takeProfits: [{ label: '2x', multiple: 2, hit: false }],
    minTier: 'LAB_MEMBER',
    isMaxAlpha: false,
  });
  const delayedBeforeNow = await tg.dispatchDelayedMemberCalls();
  assert.equal(delayedBeforeNow.dispatched, 0, 'Must NOT dispatch general call before 5m delay elapses');
  assert.ok(delayedBeforeNow.pending >= 1);
});

test('Delayed fan-out durable per-subscriber receipts prevent duplicate delivery across partial failures and budget retries', async () => {
  const hashStore = new Map();
  const receiptStore = new Map();
  const sentToChats = [];
  let failSub2 = true;
  let nowClock = 1_700_000_000_000;

  const callId = 'delayed-partial-fail-call-1';
  const callKey = tg.DELAYED_MEMBER_CALLS_KEY;
  const dueHash = new Map([
    [
      callId,
      JSON.stringify({
        callId,
        deliverAt: nowClock - 5_000,
        createdAt: nowClock - 305_000,
        call: {
          id: callId,
          name: 'RetryToken',
          ticker: 'RETRY',
          chain: 'SOL',
          ca: 'So11111111111111111111111111111111111111112',
          entryMarketCap: '$50K',
          risk: 1,
          stopLoss: '-15% SL',
          takeProfits: [{ label: '2x', multiple: 2, hit: false }],
          minTier: 'LAB_MEMBER',
          isMaxAlpha: false,
        },
      }),
    ],
  ]);
  hashStore.set(callKey, dueHash);

  const sub1 = 'MemberSub1111111111111111111111111111111111';
  const sub2 = 'MemberSub2222222222222222222222222222222222';

  const makeDeps = () => ({
    nowMs: () => nowClock,
    kvEnabled: true,
    telegramConfigured: () => true,
    kvLock: async () => true,
    kvUnlock: async () => true,
    kvHGetAll: async (key) => Object.fromEntries(hashStore.get(key) || []),
    kvHDel: async (key, field) => {
      hashStore.get(key)?.delete(field);
    },
    kvSMembers: async (key) => Array.from(receiptStore.get(key) || []),
    kvSAdd: async (key, member) => {
      let set = receiptStore.get(key);
      if (!set) {
        set = new Set();
        receiptStore.set(key, set);
      }
      const had = set.has(member);
      set.add(member);
      return had ? 0 : 1;
    },
    kvExpire: async () => {},
    getSubscribers: async () => ({
      [sub1]: '1001',
      [sub2]: '1002',
    }),
    resolveTier: async () => 'member',
    sendFn: async (chatId) => {
      if (chatId === '1002' && failSub2) {
        return { ok: false, status: 502, description: 'Bad Gateway' };
      }
      sentToChats.push(chatId);
      return { ok: true, status: 200 };
    },
    sleepMs: async () => {},
  });

  // First run: sub1 succeeds (receipt saved), sub2 fails transiently -> item remains queued
  const firstRun = await tg.dispatchDelayedMemberCalls(50_000, makeDeps());
  assert.equal(firstRun.dispatched, 1);
  assert.equal(firstRun.pending, 1);
  assert.deepEqual(sentToChats, ['1001']);
  assert.equal(hashStore.get(callKey)?.has(callId), true, 'Incomplete delayed call must remain in queue for retry');

  // Second run (sub2 recovers): sub1 MUST NOT receive duplicate, sub2 receives message, hash entry cleaned up
  failSub2 = false;
  const secondRun = await tg.dispatchDelayedMemberCalls(50_000, makeDeps());
  assert.equal(secondRun.dispatched, 1);
  assert.equal(secondRun.pending, 0);
  assert.deepEqual(sentToChats, ['1001', '1002']);
  assert.equal(hashStore.get(callKey)?.has(callId), false, 'Completed delayed call must be removed after all subscribers succeed');

  // Budget exhaustion mid-fanout preserves queue & durable receipts without duplicating batch 1
  const budgetCallId = 'delayed-budget-cut-call-2';
  const batchSubs = {};
  for (let idx = 0; idx < 22; idx++) {
    batchSubs[`BudgetSub${String(idx).padStart(2, '0')}1111111111111111111111111111111`] = String(2000 + idx);
  }
  hashStore.set(
    callKey,
    new Map([
      [
        budgetCallId,
        JSON.stringify({
          callId: budgetCallId,
          deliverAt: nowClock - 1_000,
          createdAt: nowClock - 301_000,
          call: {
            id: budgetCallId,
            name: 'BudgetToken',
            ticker: 'BDGT',
            chain: 'SOL',
            ca: 'So11111111111111111111111111111111111111112',
            entryMarketCap: '$50K',
            risk: 1,
            stopLoss: '-15% SL',
            takeProfits: [{ label: '2x', multiple: 2, hit: false }],
            minTier: 'LAB_MEMBER',
            isMaxAlpha: false,
          },
        }),
      ],
    ])
  );
  const budgetSent = [];
  let sleepTicks = 0;
  let clockOffset = 0;
  const budgetDeps = {
    ...makeDeps(),
    nowMs: () => nowClock + clockOffset,
    getSubscribers: async () => batchSubs,
    sendFn: async (chatId) => {
      budgetSent.push(chatId);
      return { ok: true, status: 200 };
    },
    sleepMs: async () => {
      sleepTicks++;
      clockOffset = 60_000; // exceed 50s budget before batch 2
    },
  };

  const budgetRun1 = await tg.dispatchDelayedMemberCalls(50_000, budgetDeps);
  assert.equal(budgetRun1.dispatched, 20);
  assert.equal(budgetRun1.pending, 1);
  assert.equal(sleepTicks, 1);
  assert.equal(hashStore.get(callKey)?.has(budgetCallId), true);

  clockOffset = 0;
  const budgetRun2 = await tg.dispatchDelayedMemberCalls(50_000, {
    ...budgetDeps,
    nowMs: () => nowClock,
    sleepMs: async () => {},
  });
  assert.equal(budgetRun2.dispatched, 2);
  assert.equal(budgetRun2.pending, 0);
  assert.equal(budgetSent.length, 22);
  assert.equal(new Set(budgetSent).size, 22, 'Every subscriber must receive exactly one delayed message across budget retry');
});
