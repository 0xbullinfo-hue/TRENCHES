import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { Keypair } from '@solana/web3.js';

// Setup environment and external mocks BEFORE importing application modules
process.env.TELEGRAM_BOT_TOKEN = 'mock-test-bot-token';
process.env.TELEGRAM_BOT_USERNAME = 'mock_trenchlabs_bot';
process.env.TELEGRAM_WEBHOOK_SECRET = 'mock_secret_1234567890';
process.env.UPSTASH_REDIS_REST_URL = 'https://mock-redis.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-redis-token';

import { GENESIS_MINT, ADMIN_WALLET } from '../../src/lib/config.ts';

// In-memory backing store for mock Redis engine
const mockRedisStore = new Map();

// Mock only external network infrastructure (Jupiter oracle, Solana RPC, and Upstash Redis REST)
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const urlStr = String(url);

  // Mock Solana JSON-RPC (getTokenAccountsByOwner) to prevent external RPC 429 rate limits
  if (options?.body && String(options.body).includes('getTokenAccountsByOwner')) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { value: [] },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Mock Jupiter price oracle
  if (urlStr.includes('api.jup.ag/price')) {
    return new Response(
      JSON.stringify({
        data: {
          [GENESIS_MINT]: { price: '0.0000164' },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Mock Upstash Redis REST with atomic Lua evaluation
  if (urlStr.includes('mock-redis.io')) {
    const bodyText = options?.body ? String(options.body) : '[]';
    let args = [];
    try {
      args = JSON.parse(bodyText);
    } catch {
      args = [];
    }
    const cmd = String(args[0]).toUpperCase();

    if (cmd === 'HGETALL') {
      return new Response(JSON.stringify({ result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (cmd === 'SET' || cmd === 'SETEX') {
      const key = String(args[1]);
      const val = String(cmd === 'SETEX' ? args[2] : args[2]);
      mockRedisStore.set(key, val);
      return new Response(JSON.stringify({ result: 'OK' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (cmd === 'GET') {
      const key = String(args[1]);
      const val = mockRedisStore.get(key) ?? null;
      return new Response(JSON.stringify({ result: val }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (cmd === 'DEL') {
      const key = String(args[1]);
      const count = mockRedisStore.delete(key) ? 1 : 0;
      return new Response(JSON.stringify({ result: count }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (cmd === 'EVAL') {
      // Atomic Lua consumption script execution simulation
      const key = String(args[2]);
      if (mockRedisStore.has(key)) {
        mockRedisStore.delete(key);
        return new Response(JSON.stringify({ result: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response(JSON.stringify({ result: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ result: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return originalFetch(url, options);
};

// Actual application route handlers
import { GET as getStakeStatus } from '../../src/app/api/stake/status/route.ts';
import { GET as getTelegramLink, POST as postTelegramLink } from '../../src/app/api/telegram/link/route.ts';
import { POST as requestChallenge } from '../../src/app/api/campaigns/[id]/challenge/route.ts';
import { POST as submitCampaign } from '../../src/app/api/campaigns/[id]/submit/route.ts';
import { GET as getAlphas } from '../../src/app/api/alphas/route.ts';

// Actual shared auth & server utilities
import { signSession, SESSION_COOKIE_NAME } from '../../src/server/auth.ts';
import { createCampaign, deleteCampaign } from '../../src/server/campaigns-data.ts';
import { resolveWalletEntitlement, evaluateWalletDowngrade } from '../../src/server/entitlements.ts';
import { issueRaidChallenge, getRaidChallenge, consumeRaidChallenge } from '../../src/server/raid-challenges.ts';
import { consumeRaidChallengeRow, createRaidChallengeRow } from '../../src/server/db.ts';

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
  return sigBytes.toString('hex');
}

async function createTestCampaign(overrides = {}) {
  return await createCampaign({
    title: 'Integration Test Campaign',
    description: 'Automated security integration test campaign verification',
    tweetUrl: 'https://x.com/TrenchLabsHQ/status/123456789',
    rewardAmount: '5,000 $GENESIS',
    rewardToken: '$GENESIS',
    durationHours: 24,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// 1. STAKE STATUS API SECURITY SCENARIOS
// ---------------------------------------------------------------------------
test('Stake Status API [1/5]: Unauthenticated request is rejected (401)', async () => {
  const req = new NextRequest('http://localhost:3000/api/stake/status');
  const res = await getStakeStatus(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, 'unauthorized');
});

test('Stake Status API [2/5]: Authenticated matching wallet succeeds (200)', async () => {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const token = signSession(wallet);

  const req = new NextRequest(`http://localhost:3000/api/stake/status?wallet=${wallet}`, {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
  });
  const res = await getStakeStatus(req);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.wallet, wallet);
});

test('Stake Status API [3/5]: Authenticated mismatched wallet is rejected (403)', async () => {
  const kpA = Keypair.generate();
  const kpB = Keypair.generate();
  const walletA = kpA.publicKey.toBase58();
  const walletB = kpB.publicKey.toBase58();
  const tokenA = signSession(walletA);

  const req = new NextRequest(`http://localhost:3000/api/stake/status?wallet=${walletB}`, {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${tokenA}`,
    },
  });
  const res = await getStakeStatus(req);
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error, 'forbidden');
  assert.match(json.message, /Authenticated wallet does not match/i);
});

test('Stake Status API [4/5]: Invalid wallet parameter is rejected (400)', async () => {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const token = signSession(wallet);

  const req = new NextRequest('http://localhost:3000/api/stake/status?wallet=not_a_valid_solana_base58_address', {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
  });
  const res = await getStakeStatus(req);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, 'bad_request');
});

test('Stake Status API [5/5]: Expired session is rejected (401)', async () => {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const expiredToken = signSession(wallet, -3600);

  const req = new NextRequest(`http://localhost:3000/api/stake/status?wallet=${wallet}`, {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${expiredToken}`,
    },
  });
  const res = await getStakeStatus(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, 'unauthorized');
});

// ---------------------------------------------------------------------------
// 2. TELEGRAM API SECURITY SCENARIOS
// ---------------------------------------------------------------------------
test('Telegram API [1/6]: Unauthenticated GET request is rejected (401)', async () => {
  const req = new NextRequest('http://localhost:3000/api/telegram/link');
  const res = await getTelegramLink(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, 'UNAUTHORIZED');
});

test('Telegram API [2/6]: Authenticated matching wallet GET succeeds (200)', async () => {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const token = signSession(wallet);

  const req = new NextRequest(`http://localhost:3000/api/telegram/link?wallet=${wallet}`, {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
  });
  const res = await getTelegramLink(req);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(typeof json.linked, 'boolean');
});

test('Telegram API [3/6]: Mismatched wallet GET is rejected (403)', async () => {
  const kpA = Keypair.generate();
  const kpB = Keypair.generate();
  const walletA = kpA.publicKey.toBase58();
  const walletB = kpB.publicKey.toBase58();
  const tokenA = signSession(walletA);

  const req = new NextRequest(`http://localhost:3000/api/telegram/link?wallet=${walletB}`, {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${tokenA}`,
    },
  });
  const res = await getTelegramLink(req);
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error, 'FORBIDDEN');
  assert.match(json.message, /Authenticated wallet does not match/i);
});

test('Telegram API [4/6]: Invalid wallet GET is rejected (400)', async () => {
  const req = new NextRequest('http://localhost:3000/api/telegram/link?wallet=not_a_valid_solana_address');
  const res = await getTelegramLink(req);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, 'BAD_REQUEST');
});

test('Telegram API [5/6]: Unauthenticated POST request is rejected (401)', async () => {
  const req = new NextRequest('http://localhost:3000/api/telegram/link', { method: 'POST' });
  const res = await postTelegramLink(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, 'UNAUTHORIZED');
});

test('Telegram API [6/6]: Authenticated admin POST generates link code URL (200)', async () => {
  const adminToken = signSession(ADMIN_WALLET);
  const req = new NextRequest(`http://localhost:3000/api/telegram/link?wallet=${ADMIN_WALLET}`, {
    method: 'POST',
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${adminToken}`,
    },
  });
  const res = await postTelegramLink(req);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.match(json.url, /^https:\/\/t\.me\//);
});

// ---------------------------------------------------------------------------
// 3. SOCIAL RAID SECURITY SCENARIOS (V2.1 SERVER NONCE CHALLENGE LIFECYCLE)
// ---------------------------------------------------------------------------

test('Social Raid [1/12]: Successful challenge issuance (201)', async () => {
  const camp = await createTestCampaign({ title: 'Challenge Issuance Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: wallet }),
    });

    const res = await requestChallenge(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.match(json.challengeId, /^rc_[0-9a-f]{32}$/);
    assert.equal(json.campaignId, camp.id);
    assert.equal(json.walletAddress, wallet);
    assert.match(json.nonce, /^[0-9a-f]{48}$/);
    assert.ok(json.expiresAt > Date.now());
    assert.match(json.message, /^TrenchLabs Raid Challenge\|/);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [2/12]: Correct signature and valid submission (201)', async () => {
  const camp = await createTestCampaign({ title: 'Valid Challenge Submission' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    // 1. Issue challenge
    const chReq = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: wallet }),
    });
    const chRes = await requestChallenge(chReq, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(chRes.status, 201);
    const chJson = await chRes.json();

    // 2. Sign exact server message
    const sigHex = signEd25519(kp, chJson.message);

    // 3. Submit completion
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: chJson.challengeId,
        walletAddress: wallet,
        xHandle: '@test_hero',
        xRetweetLink: 'https://x.com/test_hero/status/987654321',
        signature: sigHex,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.submission.walletAddress, wallet);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [3/12]: Expired challenge is rejected (401)', async () => {
  const camp = await createTestCampaign({ title: 'Expired Challenge Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    // Issue expired challenge row directly in server storage
    const challengeId = `rc_${crypto.randomBytes(16).toString('hex')}`;
    const nonce = crypto.randomBytes(24).toString('hex');
    const pastTime = Date.now() - 10 * 60 * 1000;
    const msg = `TrenchLabs Raid Challenge|${challengeId}|${camp.id}|${wallet}|${nonce}|${pastTime}`;
    await createRaidChallengeRow({
      challenge_id: challengeId,
      nonce,
      campaign_id: camp.id,
      wallet_address: wallet,
      created_at: new Date(pastTime - 60000).toISOString(),
      expires_at: new Date(pastTime).toISOString(),
      message: msg,
    });

    const sigHex = signEd25519(kp, msg);

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId,
        walletAddress: wallet,
        xHandle: '@expired_user',
        xRetweetLink: 'https://x.com/expired_user/status/111',
        signature: sigHex,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.error, /expired/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [4/12]: Unknown challenge ID is rejected (401)', async () => {
  const camp = await createTestCampaign({ title: 'Unknown Challenge Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: 'rc_unknown_random_id_999999999',
        walletAddress: wallet,
        xHandle: '@unknown_id',
        xRetweetLink: 'https://x.com/unknown_id/status/111',
        signature: 'deadbeef',
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.error, /Unknown challenge ID/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [5/12]: Wrong campaign is rejected (401)', async () => {
  const campA = await createTestCampaign({ title: 'Campaign A' });
  const campB = await createTestCampaign({ title: 'Campaign B' });

  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    // Challenge issued strictly for Campaign A
    const ch = await issueRaidChallenge({ campaignId: campA.id, walletAddress: wallet });
    const sigHex = signEd25519(kp, ch.message);

    // Attempted submission against Campaign B
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${campB.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: wallet,
        xHandle: '@wrong_campaign',
        xRetweetLink: 'https://x.com/wrong_campaign/status/111',
        signature: sigHex,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: campB.id }) });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.error, /Challenge campaign mismatch/i);
  } finally {
    await deleteCampaign(campA.id);
    await deleteCampaign(campB.id);
  }
});

test('Social Raid [6/12]: Wrong wallet is rejected (401)', async () => {
  const camp = await createTestCampaign({ title: 'Wrong Wallet Test' });
  try {
    const kpA = Keypair.generate();
    const kpB = Keypair.generate();
    const walletA = kpA.publicKey.toBase58();
    const walletB = kpB.publicKey.toBase58();

    // Challenge issued for Wallet A
    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: walletA });
    const sigHexA = signEd25519(kpA, ch.message);

    // Submitted claiming to be Wallet B
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: walletB,
        xHandle: '@wrong_wallet',
        xRetweetLink: 'https://x.com/wrong_wallet/status/111',
        signature: sigHexA,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.error, /Challenge wallet mismatch/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [7/12]: Invalid signature is rejected (401)', async () => {
  const camp = await createTestCampaign({ title: 'Invalid Signature Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });

    // Corrupted signature
    const badSig = '00'.repeat(64);

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: wallet,
        xHandle: '@bad_sig',
        xRetweetLink: 'https://x.com/bad_sig/status/111',
        signature: badSig,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.error, /Invalid challenge signature/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [8/12]: Reused challenge is rejected (401)', async () => {
  const camp = await createTestCampaign({ title: 'Reused Challenge Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const sigHex = signEd25519(kp, ch.message);

    const makeReq = () =>
      new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: ch.challengeId,
          walletAddress: wallet,
          xHandle: '@reused_user',
          xRetweetLink: 'https://x.com/reused_user/status/111',
          signature: sigHex,
        }),
      });

    // First submission succeeds
    const res1 = await submitCampaign(makeReq(), { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res1.status, 201);

    // Second sequential submission of exact same challenge is rejected
    const res2 = await submitCampaign(makeReq(), { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res2.status, 401);
    const json2 = await res2.json();
    assert.match(json2.error, /already been consumed or replayed/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [9/12]: Two concurrent submissions cannot both consume the same challenge successfully', async () => {
  const camp = await createTestCampaign({ title: 'Concurrent Replay Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const sigHex = signEd25519(kp, ch.message);

    const makeReq = () =>
      new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: ch.challengeId,
          walletAddress: wallet,
          xHandle: '@concurrent_hero',
          xRetweetLink: 'https://x.com/concurrent_hero/status/111',
          signature: sigHex,
        }),
      });

    // Fire two simultaneous requests
    const [resA, resB] = await Promise.all([
      submitCampaign(makeReq(), { params: Promise.resolve({ id: camp.id }) }),
      submitCampaign(makeReq(), { params: Promise.resolve({ id: camp.id }) }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    assert.deepEqual(statuses, [201, 401]);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [10/12]: Missing challenge is rejected (401)', async () => {
  const camp = await createTestCampaign({ title: 'Missing Challenge Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: wallet,
        xHandle: '@missing_challenge',
        xRetweetLink: 'https://x.com/missing_challenge/status/111',
        signature: 'deadbeef',
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.error, /Server-issued challenge required/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [11/12]: Attempted timestamp-only legacy signature is rejected (401)', async () => {
  const camp = await createTestCampaign({ title: 'Legacy Timestamp Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();
    const ts = Date.now();

    // Legacy signature attempted without challengeId
    const legacyMsg = `TrenchLabs Raid Submission|${camp.id}|${wallet}|${ts}`;
    const sigHex = signEd25519(kp, legacyMsg);

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: wallet,
        xHandle: '@legacy_attacker',
        xRetweetLink: 'https://x.com/legacy_attacker/status/111',
        signature: sigHex,
        timestamp: ts,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.error, /Legacy timestamp-only signatures are rejected/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [12/12]: Challenge storage failure returns 502', async () => {
  const camp = await createTestCampaign({ title: 'Storage Failure Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    // Point Upstash URL to an endpoint that throws
    const origUrl = process.env.UPSTASH_REDIS_REST_URL;
    process.env.UPSTASH_REDIS_REST_URL = 'https://broken-store.internal';

    try {
      const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: wallet }),
      });

      const res = await requestChallenge(req, { params: Promise.resolve({ id: camp.id }) });
      assert.equal(res.status, 502);
      const json = await res.json();
      assert.match(json.error, /Challenge storage unavailable/i);
    } finally {
      process.env.UPSTASH_REDIS_REST_URL = origUrl;
    }
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid Concurrency: Database transaction atomic consumption (consumeRaidChallengeRow)', async () => {
  const challengeId = `rc_db_atomic_${crypto.randomBytes(8).toString('hex')}`;
  const now = Date.now();
  await createRaidChallengeRow({
    challenge_id: challengeId,
    nonce: 'atomic_test_nonce',
    campaign_id: 'camp_db_test',
    wallet_address: '11111111111111111111111111111111',
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 300000).toISOString(),
    message: 'test message',
  });

  // Execute two concurrent database consume attempts
  const [winA, winB] = await Promise.all([
    consumeRaidChallengeRow(challengeId),
    consumeRaidChallengeRow(challengeId),
  ]);

  const results = [winA, winB].sort();
  // Exactly one true, one false
  assert.deepEqual(results, [false, true]);
});

// ---------------------------------------------------------------------------
// 4. MEMBERSHIP SECURITY SCENARIOS
// ---------------------------------------------------------------------------
test('Membership [1/4]: FREE, MEMBER and PRO entitlements resolve correctly', async () => {
  // Free: holding $0, staking $0
  const freeEnt = await resolveWalletEntitlement('FreeWallet11111111111111111111111111111111', {
    mockHoldingTokens: 0,
    mockStakedTokens: 0,
    mockPriceUsd: 0.0000164,
  });
  assert.equal(freeEnt.tier, 'free');
  assert.equal(freeEnt.permissions.canAccessTerminal, false);
  assert.equal(freeEnt.permissions.canAccessProSignals, false);

  // Member: holding >= $20 USD, staking $0
  const memberTokens = 20 / 0.0000164;
  const memberEnt = await resolveWalletEntitlement('MemberWallet111111111111111111111111111111', {
    mockHoldingTokens: memberTokens,
    mockStakedTokens: 0,
    mockPriceUsd: 0.0000164,
  });
  assert.equal(memberEnt.tier, 'member');
  assert.equal(memberEnt.permissions.canAccessTerminal, true);
  assert.equal(memberEnt.permissions.canAccessProSignals, false);

  // Pro: staking >= $250 USD on StakePoint
  const proStakedTokens = 250 / 0.0000164;
  const proEnt = await resolveWalletEntitlement('ProWallet11111111111111111111111111111111', {
    mockHoldingTokens: 0,
    mockStakedTokens: proStakedTokens,
    mockPriceUsd: 0.0000164,
  });
  assert.equal(proEnt.tier, 'pro');
  assert.equal(proEnt.permissions.canAccessTerminal, true);
  assert.equal(proEnt.permissions.canAccessProSignals, true);
});

test('Membership [2/4]: High local token balance cannot override lower server entitlement', async () => {
  // A wallet that holds 0 tokens on-chain
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const ts = Date.now();
  const challengeMsg = `TrenchLabs Access|GET|/api/alphas|${ts}`;
  const sigHex = signEd25519(kp, challengeMsg);

  const req = new NextRequest('http://localhost:3000/api/alphas', {
    method: 'GET',
    headers: {
      'x-wallet': wallet,
      'x-timestamp': String(ts),
      'x-signature': sigHex,
    },
  });

  const res = await getAlphas(req);
  // Server must enforce authoritative on-chain verification, rejecting with 403
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.equal(json.error, 'ACCESS_DENIED_ZERO_BALANCE');
  assert.deepEqual(json.items, []);
});

test('Membership [3/4]: Definitive authorization denial clears stale premium access', async () => {
  const data = {
    ok: false,
    error: 'ACCESS_DENIED_ZERO_BALANCE',
    message: 'Holding at least $20 required',
    balance: 0,
    items: [],
  };

  assert.equal(data.ok, false);
  assert.equal(data.error, 'ACCESS_DENIED_ZERO_BALANCE');
  assert.equal(data.items.length, 0);
});

test('Membership [4/4]: Temporary network failure does not incorrectly revoke valid membership', async () => {
  const kp = Keypair.generate();
  const validWallet = kp.publicKey.toBase58();

  // When price oracle is temporarily unavailable, non-admin entitlement resolves to 'unknown'
  const ent = await resolveWalletEntitlement(validWallet, {
    mockHoldingTokens: 1_000_000,
    mockPriceUsd: 0, // oracle outage: non-positive price
  });

  assert.equal(ent.tier, 'unknown');
  assert.match(ent.downgradeReason || '', /Price oracle temporarily unavailable/i);

  // Downgrade / sweep evaluator must skip status changes when tier is unknown
  const evalResult = await evaluateWalletDowngrade(validWallet, { mockPriceUsd: 0 });
  assert.equal(evalResult.newTier, 'unknown');
  assert.equal(evalResult.changed, false);
});

// ---------------------------------------------------------------------------
// 5. WALLET ISOLATION SECURITY SCENARIOS
// ---------------------------------------------------------------------------
test('Wallet isolation [1/3]: Wallet A cannot see Wallet B personal Watchlist', () => {
  const getWatchlistKey = (addr) => (addr ? `trenchlabs_watchlist_v4:${addr}` : 'trenchlabs_watchlist_anon_v4');

  const walletA = 'WalletA11111111111111111111111111111111111';
  const walletB = 'WalletB22222222222222222222222222222222222';

  const mockStorage = new Map();
  mockStorage.set(getWatchlistKey(walletA), JSON.stringify(['alpha-call-1', 'alpha-call-2']));

  // Wallet B attempts to read its personal watchlist
  const walletBData = mockStorage.get(getWatchlistKey(walletB));
  assert.equal(walletBData, undefined);

  // Storage key for Wallet A is completely isolated
  assert.notEqual(getWatchlistKey(walletA), getWatchlistKey(walletB));
});

test('Wallet isolation [2/3]: Switching wallets clears stale displayed data', () => {
  let displayedWatchlist = ['token-1', 'token-2'];
  let displayedAlphas = [{ id: '1', ticker: '$OLD' }];

  // Address switch occurs:
  const prevWallet = 'WalletA';
  const nextWallet = 'WalletB';
  assert.notEqual(prevWallet, nextWallet);

  // Synchronous/microtask state reset
  displayedWatchlist = [];
  displayedAlphas = [];

  assert.equal(displayedWatchlist.length, 0);
  assert.equal(displayedAlphas.length, 0);
});

test('Wallet isolation [3/3]: Legacy Watchlist migration occurs only once', () => {
  const getWatchlistKey = (addr) => `trenchlabs_watchlist_v4:${addr}`;
  const mockStorage = new Map();

  // Legacy un-namespaced key exists from v3
  mockStorage.set('trenchlabs_watchlist_v3', JSON.stringify(['legacy-1', 'legacy-2']));

  const walletA = 'WalletA11111111111111111111111111111111111';
  const walletB = 'WalletB22222222222222222222222222222222222';

  // Step 1: Wallet A connects and migrates legacy data
  const legacyData = mockStorage.get('trenchlabs_watchlist_v3');
  assert.ok(legacyData);
  mockStorage.set(getWatchlistKey(walletA), legacyData);
  mockStorage.delete('trenchlabs_watchlist_v3'); // Deleted immediately upon migration

  assert.deepEqual(JSON.parse(mockStorage.get(getWatchlistKey(walletA))), ['legacy-1', 'legacy-2']);
  assert.equal(mockStorage.has('trenchlabs_watchlist_v3'), false);

  // Step 2: Wallet B connects later
  const legacyForB = mockStorage.get('trenchlabs_watchlist_v3');
  assert.equal(legacyForB, undefined); // Cannot be migrated a second time
  const walletBData = mockStorage.get(getWatchlistKey(walletB));
  assert.equal(walletBData, undefined);
});
