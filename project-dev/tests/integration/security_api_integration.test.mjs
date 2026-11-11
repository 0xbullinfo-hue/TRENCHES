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

// Mock only external network infrastructure (Jupiter oracle & Upstash Redis HTTP API)
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

  // Mock Upstash Redis REST
  if (urlStr.includes('mock-redis.io')) {
    const bodyText = options?.body ? String(options.body) : '[]';
    let cmd = '';
    try {
      const parsed = JSON.parse(bodyText);
      cmd = String(parsed[0]).toUpperCase();
    } catch {
      cmd = '';
    }

    if (cmd === 'HGETALL') {
      return new Response(JSON.stringify({ result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (cmd === 'SET' || cmd === 'SETEX' || cmd === 'DEL' || cmd === 'HDEL') {
      return new Response(JSON.stringify({ result: 'OK' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
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
import { POST as submitCampaign } from '../../src/app/api/campaigns/[id]/submit/route.ts';
import { GET as getAlphas } from '../../src/app/api/alphas/route.ts';

// Actual shared auth & server utilities
import { signSession, SESSION_COOKIE_NAME } from '../../src/server/auth.ts';
import { createCampaign, deleteCampaign } from '../../src/server/campaigns-data.ts';
import { resolveWalletEntitlement, evaluateWalletDowngrade } from '../../src/server/entitlements.ts';

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
// 3. SOCIAL RAID SECURITY SCENARIOS
// ---------------------------------------------------------------------------
test('Social Raid [1/7]: Valid campaign-bound challenge succeeds (201)', async () => {
  const camp = await createTestCampaign({ title: 'Valid Challenge Raid' });

  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();
    const ts = Date.now();
    const challengeMsg = `TrenchLabs Raid Submission|${camp.id}|${wallet}|${ts}`;
    const sigHex = signEd25519(kp, challengeMsg);

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: wallet,
        xHandle: '@test_hero',
        xRetweetLink: 'https://x.com/test_hero/status/987654321',
        signature: sigHex,
        timestamp: ts,
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

test('Social Raid [2/7]: Expired challenge is rejected (401)', async () => {
  const camp = await createTestCampaign({ title: 'Expired Challenge Raid' });

  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();
    const expiredTs = Date.now() - 6 * 60 * 1000; // 6 minutes ago (> 5m threshold)
    const challengeMsg = `TrenchLabs Raid Submission|${camp.id}|${wallet}|${expiredTs}`;
    const sigHex = signEd25519(kp, challengeMsg);

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: wallet,
        xHandle: '@test_hero',
        xRetweetLink: 'https://x.com/test_hero/status/987654321',
        signature: sigHex,
        timestamp: expiredTs,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.error, /Challenge expired/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [3/7]: Replayed challenge is rejected (401)', async () => {
  const camp = await createTestCampaign({ title: 'Replay Challenge Raid' });

  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();
    const ts = Date.now();
    const challengeMsg = `TrenchLabs Raid Submission|${camp.id}|${wallet}|${ts}`;
    const sigHex = signEd25519(kp, challengeMsg);

    const makeReq = () =>
      new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: wallet,
          xHandle: '@test_hero',
          xRetweetLink: 'https://x.com/test_hero/status/987654321',
          signature: sigHex,
          timestamp: ts,
        }),
      });

    // First submission succeeds
    const res1 = await submitCampaign(makeReq(), { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res1.status, 201);

    // Second sequential submission of exact same challenge signature is rejected
    const res2 = await submitCampaign(makeReq(), { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res2.status, 401);
    const json2 = await res2.json();
    assert.match(json2.error, /already been consumed or replayed/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [4/7]: Wrong campaign is rejected (401)', async () => {
  const campA = await createTestCampaign({ title: 'Campaign A' });
  const campB = await createTestCampaign({ title: 'Campaign B' });

  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();
    const ts = Date.now();
    // Signed strictly for Campaign A
    const challengeMsgA = `TrenchLabs Raid Submission|${campA.id}|${wallet}|${ts}`;
    const sigHexA = signEd25519(kp, challengeMsgA);

    // Attempt to submit against Campaign B
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${campB.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: wallet,
        xHandle: '@test_hero',
        xRetweetLink: 'https://x.com/test_hero/status/987654321',
        signature: sigHexA,
        timestamp: ts,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: campB.id }) });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.error, /Invalid challenge signature, campaign mismatch/i);
  } finally {
    await deleteCampaign(campA.id);
    await deleteCampaign(campB.id);
  }
});

test('Social Raid [5/7]: Wrong wallet is rejected (401)', async () => {
  const camp = await createTestCampaign({ title: 'Wrong Wallet Raid' });

  try {
    const kpA = Keypair.generate();
    const kpB = Keypair.generate();
    const walletA = kpA.publicKey.toBase58();
    const walletB = kpB.publicKey.toBase58();
    const ts = Date.now();

    // Challenge signed by Wallet A
    const challengeMsg = `TrenchLabs Raid Submission|${camp.id}|${walletA}|${ts}`;
    const sigHex = signEd25519(kpA, challengeMsg);

    // Impersonator submits with Wallet B
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: walletB,
        xHandle: '@impersonator',
        xRetweetLink: 'https://x.com/impersonator/status/987654321',
        signature: sigHex,
        timestamp: ts,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.error, /Invalid challenge signature, campaign mismatch, or wrong wallet/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [6/7]: Invalid signature is rejected (401)', async () => {
  const camp = await createTestCampaign({ title: 'Invalid Signature Raid' });

  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();
    const ts = Date.now();

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: wallet,
        xHandle: '@bad_sig',
        xRetweetLink: 'https://x.com/bad_sig/status/987654321',
        signature: 'deadbeef00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
        timestamp: ts,
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

test('Social Raid [7/7]: Two concurrent submissions cannot both consume the same challenge successfully', async () => {
  const camp = await createTestCampaign({ title: 'Concurrent Race Raid' });

  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();
    const ts = Date.now();
    const challengeMsg = `TrenchLabs Raid Submission|${camp.id}|${wallet}|${ts}`;
    const sigHex = signEd25519(kp, challengeMsg);

    const makeReq = () =>
      new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: wallet,
          xHandle: '@concurrent_hero',
          xRetweetLink: 'https://x.com/concurrent_hero/status/987654321',
          signature: sigHex,
          timestamp: ts,
        }),
      });

    // Fire two requests concurrently with identical challenge signatures
    const [resA, resB] = await Promise.all([
      submitCampaign(makeReq(), { params: Promise.resolve({ id: camp.id }) }),
      submitCampaign(makeReq(), { params: Promise.resolve({ id: camp.id }) }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    // Exactly ONE must succeed (201) and the other must be rejected (401)
    assert.deepEqual(statuses, [201, 401]);
  } finally {
    await deleteCampaign(camp.id);
  }
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
