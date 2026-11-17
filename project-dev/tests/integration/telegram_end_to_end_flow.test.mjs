import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'trench-tg-e2e-'));
process.chdir(TMP_DIR);

process.env.NODE_ENV = 'test';
process.env.ALLOW_FILE_PERSISTENCE = 'true';
process.env.SESSION_SECRET = 'e2e-telegram-session-secret-32-chars-minimum';
process.env.TELEGRAM_BOT_TOKEN = '555444:E2E_BOT_TOKEN';
process.env.TELEGRAM_BOT_USERNAME = 'Trenchlabs_bot';
process.env.TELEGRAM_WEBHOOK_SECRET = 'e2e-webhook-secret';
process.env.TELEGRAM_MEMBER_GROUP_ID = '-1003333333333';
process.env.TELEGRAM_PRO_GROUP_ID = '-1004444444444';
process.env.SITE_URL = 'https://trenchlabshq.xyz';
process.env.SOLANA_RPC = 'http://e2e-rpc.local';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.TELEGRAM_MEMBER_INVITE_URL;
delete process.env.TELEGRAM_PRO_INVITE_URL;

const GENESIS_MINT = 'EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump';

const e2eState = {
  balancesRaw: new Map(),
  rpcFailWallets: new Set(),
  botCalls: [],
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
  if (url.includes('e2e-rpc.local') || url.includes('mainnet-beta.solana.com')) {
    const body = JSON.parse(String(init.body || '{}'));
    const owner = body?.params?.[0];
    if (e2eState.rpcFailWallets.has(owner)) {
      return new Response('RPC 503', { status: 503 });
    }
    const raw = e2eState.balancesRaw.get(owner) ?? '0';
    const value =
      BigInt(raw) > BigInt(0)
        ? [{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: Number(raw) / 1e6, amount: raw } } } } } }]
        : [];
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value } }), { status: 200 });
  }
  if (url.includes('api.telegram.org/bot')) {
    const method = url.split('/').pop();
    const body = JSON.parse(String(init.body || '{}'));
    e2eState.botCalls.push({ method, body });
    if (method === 'createChatInviteLink') {
      e2eState.inviteSeq += 1;
      return new Response(
        JSON.stringify({
          ok: true,
          result: { invite_link: `https://t.me/+e2e_inv_${body.chat_id}_${e2eState.inviteSeq}` },
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: e2eState.botCalls.length } }), { status: 200 });
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
const statusRoute = await import('../../src/app/api/verification/status/route.ts');
const sessionRoute = await import('../../src/app/api/verification/session/route.ts');
const notifRoute = await import('../../src/app/api/verification/notifications/route.ts');
const webhookRoute = await import('../../src/app/api/telegram/webhook/route.ts');

let seq = 5000;
const uid = () => ++seq;
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

test('Section 19 End-to-End: Complete Member & Pro onboarding, chat_member confirmation, notifications, /stop, leave, Pro downgrade & RPC resilience', async () => {
  const memberWallet = 'E2EMemberWallet11111111111111111111111111111';
  const proWallet = 'E2EProWallet11111111111111111111111111111111';
  const memberTgId = 400001;
  const proTgId = 400002;

  e2eState.balancesRaw.set(memberWallet, '250000000000'); // $25 Member
  e2eState.balancesRaw.set(proWallet, '250000000000'); // Holds $25 + 90d Pro stake
  await db.createStake({
    wallet_address: proWallet,
    amount_raw: '3000000000000', // $300
    lock_days: 90,
    tx_signature: `e2e_sig_${crypto.randomUUID()}`,
  });

  // 1. Dashboard status API before linking
  const initStatusRes = await statusRoute.GET(
    new NextRequest('http://localhost/api/verification/status', { headers: { Cookie: cookieFor(memberWallet) } })
  );
  const initStatus = await initStatusRes.json();
  assert.equal(initStatus.entitlement.tier, 'member');
  assert.equal(initStatus.telegram.identity.status, 'not_connected');
  assert.equal(initStatus.telegram.community.status, 'not_joined');
  assert.equal(initStatus.telegram.notifications.status, 'disabled');
  assert.equal(initStatus.telegram.connected, false);

  // 2. Member cannot request Pro session
  const memberProAttempt = await sessionRoute.POST(
    new NextRequest('http://localhost/api/verification/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieFor(memberWallet) },
      body: JSON.stringify({ target_tier: 'pro' }),
    })
  );
  assert.equal(memberProAttempt.status, 403);

  // 3. Member starts valid verification session -> /start vs_<token>
  const memSessRes = await sessionRoute.POST(
    new NextRequest('http://localhost/api/verification/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieFor(memberWallet) },
      body: JSON.stringify({ target_tier: 'member' }),
    })
  );
  const memSess = await memSessRes.json();
  assert.equal(memSessRes.status, 200);
  assert.ok(memSess.deep_link.includes(`start=vs_${memSess.session_id}`));

  await sendWebhook({
    update_id: uid(),
    message: { chat: { id: memberTgId, type: 'private' }, from: { id: memberTgId }, text: `/start vs_${memSess.session_id}` },
  });

  // Must be invite_pending (NOT joined) before chat_member confirms!
  const pendingStatusRes = await statusRoute.GET(
    new NextRequest('http://localhost/api/verification/status', { headers: { Cookie: cookieFor(memberWallet) } })
  );
  const pendingStatus = await pendingStatusRes.json();
  assert.equal(pendingStatus.telegram.identity.status, 'connected');
  assert.equal(pendingStatus.telegram.community.status, 'invite_pending');
  assert.equal(pendingStatus.telegram.connected, false);

  // Bot /status also reports Invitation Pending truthfully
  await sendWebhook({
    update_id: uid(),
    message: { chat: { id: memberTgId, type: 'private' }, from: { id: memberTgId }, text: '/status' },
  });
  const pendingBotReply = e2eState.botCalls.filter((c) => c.method === 'sendMessage').pop();
  assert.ok(pendingBotReply.body.text.includes('Group Membership: <b>Invitation Pending</b>'));

  // 4. Telegram sends chat_member event confirming Member actually joined Member group!
  await sendWebhook({
    update_id: uid(),
    chat_member: {
      chat: { id: Number(process.env.TELEGRAM_MEMBER_GROUP_ID), type: 'supergroup' },
      new_chat_member: { user: { id: memberTgId }, status: 'member' },
    },
  });

  const joinedStatusRes = await statusRoute.GET(
    new NextRequest('http://localhost/api/verification/status', { headers: { Cookie: cookieFor(memberWallet) } })
  );
  const joinedStatus = await joinedStatusRes.json();
  assert.equal(joinedStatus.telegram.community.status, 'joined');
  assert.equal(joinedStatus.telegram.community.tier, 'member');
  assert.equal(joinedStatus.telegram.connected, true);

  // 5. Enable private notifications from Dashboard
  const enableNotifRes = await notifRoute.POST(
    new NextRequest('http://localhost/api/verification/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieFor(memberWallet) },
      body: JSON.stringify({ enabled: true }),
    })
  );
  assert.equal(enableNotifRes.status, 200);

  // 6. Pro onboarding complete lifecycle
  const proSessRes = await sessionRoute.POST(
    new NextRequest('http://localhost/api/verification/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieFor(proWallet) },
      body: JSON.stringify({ target_tier: 'pro' }),
    })
  );
  const proSess = await proSessRes.json();
  await sendWebhook({
    update_id: uid(),
    message: { chat: { id: proTgId, type: 'private' }, from: { id: proTgId }, text: `/start vs_${proSess.session_id}` },
  });
  await sendWebhook({
    update_id: uid(),
    chat_member: {
      chat: { id: Number(process.env.TELEGRAM_PRO_GROUP_ID), type: 'supergroup' },
      new_chat_member: { user: { id: proTgId }, status: 'member' },
    },
  });

  await notifRoute.POST(
    new NextRequest('http://localhost/api/verification/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieFor(proWallet) },
      body: JSON.stringify({ enabled: true }),
    })
  );

  // 7. Test /stop disables private alerts for Member WITHOUT revoking community group access
  await sendWebhook({
    update_id: uid(),
    message: { chat: { id: memberTgId, type: 'private' }, from: { id: memberTgId }, text: '/stop' },
  });
  const afterStopStatus = await (
    await statusRoute.GET(
      new NextRequest('http://localhost/api/verification/status', { headers: { Cookie: cookieFor(memberWallet) } })
    )
  ).json();
  assert.equal(afterStopStatus.telegram.notifications.status, 'disabled');
  assert.equal(afterStopStatus.telegram.community.status, 'joined');

  // 8. Member leaves group -> Dashboard immediately reflects 'left'
  await sendWebhook({
    update_id: uid(),
    chat_member: {
      chat: { id: Number(process.env.TELEGRAM_MEMBER_GROUP_ID), type: 'supergroup' },
      new_chat_member: { user: { id: memberTgId }, status: 'left' },
    },
  });
  const afterLeaveStatus = await (
    await statusRoute.GET(
      new NextRequest('http://localhost/api/verification/status', { headers: { Cookie: cookieFor(memberWallet) } })
    )
  ).json();
  assert.equal(afterLeaveStatus.telegram.community.status, 'left');
  assert.equal(afterLeaveStatus.telegram.connected, false);

  // 9. Temporary RPC outage for an active un-cached Member -> Sweep skips eviction cleanly, status reports 'unknown'
  const rpcOutageMemberWallet = 'E2ERpcOutageMember11111111111111111111111111';
  const rpcOutageTgId = 400009;
  await db.upsertTelegramMember({
    wallet_address: rpcOutageMemberWallet,
    telegram_user_id: rpcOutageTgId,
    tier: 'member',
    in_group: true,
    group_status: 'joined',
    group_id: process.env.TELEGRAM_MEMBER_GROUP_ID,
  });
  e2eState.rpcFailWallets.add(rpcOutageMemberWallet);
  const sweepUnknown = await tg.sweepGroupMembers();
  assert.equal(sweepUnknown.evicted, 0);
  const rpcMemberAfterSweep = await db.getTelegramMember(rpcOutageMemberWallet);
  assert.equal(rpcMemberAfterSweep?.in_group, true, 'Unknown entitlement must never evict active member');
  assert.equal(rpcMemberAfterSweep?.group_status, 'joined');

  const unknownStatus = await (
    await statusRoute.GET(
      new NextRequest('http://localhost/api/verification/status', { headers: { Cookie: cookieFor(rpcOutageMemberWallet) } })
    )
  ).json();
  assert.equal(unknownStatus.entitlement.tier, 'unknown');
  assert.equal(unknownStatus.actions.canJoinCommunity, false);
  e2eState.rpcFailWallets.delete(rpcOutageMemberWallet);

  // 10. Pro stake expires while holding $25+ -> Sweep revokes Pro, issues dynamic Member invite (in_group remains false!)
  const dbSnapshot = await db.loadDb();
  const pastUnlock = new Date(Date.now() - 3600_000).toISOString();
  dbSnapshot.stakes = dbSnapshot.stakes.map((s) =>
    s.wallet_address === proWallet ? { ...s, unlocks_at: pastUnlock } : s
  );
  await db.saveDb(dbSnapshot);

  const callsBeforeSweep = e2eState.botCalls.length;
  const sweepDowngrade = await tg.sweepGroupMembers();
  assert.equal(sweepDowngrade.demotedToMember, 1);

  const sweepCalls = e2eState.botCalls.slice(callsBeforeSweep);
  assert.ok(
    sweepCalls.some((c) => c.method === 'banChatMember' && String(c.body.chat_id) === process.env.TELEGRAM_PRO_GROUP_ID && c.body.user_id === proTgId),
    'Pro group access must be revoked on downgrade'
  );
  assert.ok(
    sweepCalls.some((c) => c.method === 'createChatInviteLink' && String(c.body.chat_id) === process.env.TELEGRAM_MEMBER_GROUP_ID),
    'Single-use Member group invite must be created dynamically on downgrade'
  );

  const downgradedStatus = await (
    await statusRoute.GET(
      new NextRequest('http://localhost/api/verification/status', { headers: { Cookie: cookieFor(proWallet) } })
    )
  ).json();
  assert.equal(downgradedStatus.entitlement.tier, 'member');
  assert.equal(downgradedStatus.telegram.community.status, 'invite_pending');
  assert.equal(downgradedStatus.telegram.connected, false, 'Must NOT falsely mark joined before user accepts Member invite');
});
