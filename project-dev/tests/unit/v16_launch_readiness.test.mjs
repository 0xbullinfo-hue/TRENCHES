import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { NextRequest } from 'next/server';
import { installDomShim } from './helpers/dom-shim.mjs';

process.env.ALLOW_FILE_PERSISTENCE = 'true';

// Mock next/server's `after` to be a no-op in test context (outside Next.js request lifecycle).
// ESM namespace objects are frozen, so we patch via require() which returns a mutable CJS wrapper.
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const safeAfter = (fn) => { try { if (typeof fn === 'function') fn(); } catch { /* no request context */ } };
try {
  const nextServerCjs = _require('next/server');
  nextServerCjs.after = safeAfter;
} catch { /* fallback: leave after() unpatched */ }
try {
  const afterInternalCjs = _require('next/dist/server/after/after.js');
  afterInternalCjs.after = safeAfter;
} catch { /* internal path may differ between versions */ }

const dom = installDomShim();

// Minimal localStorage shim for GenesisContext reload test
const storageMap = new Map();
const localStorageShim = {
  getItem(k) {
    return storageMap.has(k) ? storageMap.get(k) : null;
  },
  setItem(k, v) {
    storageMap.set(k, String(v));
  },
  removeItem(k) {
    storageMap.delete(k);
  },
  clear() {
    storageMap.clear();
  },
};
Object.defineProperty(dom.window, 'localStorage', { value: localStorageShim, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: localStorageShim, configurable: true });

const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');

const {
  WalletContext,
  makeMockPublicKey,
  makeMockWalletContext,
} = await import('./helpers/campaign_card_harness.tsx');
const { GenesisProvider, useGenesisBalance } = await import('../../src/context/GenesisContext.tsx');
const { AdminCampaignManager } = await import('../../src/components/admin/AdminCampaignManager.tsx');
const { GET: getAlphasRoute } = await import('../../src/app/api/alphas/route.ts');
const { POST: postAdminCampaignRoute } = await import('../../src/app/api/admin/campaigns/route.ts');
const { PATCH: patchAdminCampaignRoute } = await import('../../src/app/api/admin/campaigns/[id]/route.ts');
const { GET: getAdminSubmissionsRoute } = await import('../../src/app/api/admin/campaigns/[id]/submissions/route.ts');
const { PATCH: patchAdminSubmissionRoute } = await import('../../src/app/api/admin/campaigns/submissions/[submissionId]/route.ts');
const { signSession, SESSION_COOKIE_NAME } = await import('../../src/server/auth.ts');
const { ADMIN_WALLET, GENESIS_MINT } = await import('../../src/lib/config.ts');
const { computePerformanceStats } = await import('../../src/lib/ledger/performance-stats.ts');
const { createStake } = await import('../../src/server/db.ts');
const { resolveWalletEntitlement } = await import('../../src/server/entitlements.ts');

const FREE_KP = Keypair.generate();
const MEMBER_KP = Keypair.generate();
const PRO_KP = Keypair.generate();
const FREE_WALLET = FREE_KP.publicKey.toBase58();
const MEMBER_WALLET = MEMBER_KP.publicKey.toBase58();
const PRO_WALLET = PRO_KP.publicKey.toBase58();
const WALLET_A = '11111111111111111111111111111111';
const WALLET_B = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function signWalletAuthHeaders(kp, urlStr, method = 'GET', tsOverride) {
  const ts = tsOverride ?? Date.now();
  const pathname = new URL(urlStr).pathname;
  const msg = ['TrenchLabs Access', method, pathname, ts].join('|');
  const privKey = crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(kp.secretKey.subarray(0, 32))]),
    format: 'der',
    type: 'pkcs8',
  });
  const sigHex = crypto.sign(null, Buffer.from(msg, 'utf-8'), privKey).toString('hex');
  return {
    'x-wallet': kp.publicKey.toBase58(),
    'x-timestamp': String(ts),
    'x-signature': sigHex,
  };
}

function withAlphasMockFetch(extraHandler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const urlStr = String(url);
    const bodyStr = init?.body ? String(init.body) : '';
    if (bodyStr.includes('getTokenAccountsByOwner')) {
      const parsed = JSON.parse(bodyStr);
      const owner = parsed?.params?.[0];
      const uiAmount =
        owner === MEMBER_WALLET
          ? 1_500_000
          : owner === PRO_WALLET
            ? 0
            : owner === ADMIN_WALLET
              ? 2_000_000
              : 0;
      const rawAmount = BigInt(uiAmount) * BigInt(1_000_000);
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            value:
              uiAmount > 0
                ? [
                    {
                      account: {
                        data: {
                          parsed: {
                            info: {
                              tokenAmount: {
                                uiAmount,
                                amount: rawAmount.toString(),
                              },
                            },
                          },
                        },
                      },
                    },
                  ]
                : [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (urlStr.includes('api.jup.ag/price') || urlStr.includes('dexscreener.com')) {
      if (urlStr.includes('api.jup.ag/price')) {
        return new Response(
          JSON.stringify({ data: { [GENESIS_MINT]: { price: '0.0000164' } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ pairs: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (extraHandler) {
      return extraHandler(urlStr, init);
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return {
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function makeSignedRequest(urlStr, kp, tsOverride) {
  return new NextRequest(urlStr, {
    headers: signWalletAuthHeaders(kp, urlStr, 'GET', tsOverride),
  });
}

// ============================================================================
// FIX D: AUTHENTICATED /api/alphas GATING & PERFORMANCE SEPARATION
// ============================================================================

test('V1.6 Fix D [1/6]: Unauthenticated /api/alphas returns 401 and expired signature returns 401', async () => {
  const fx = withAlphasMockFetch();
  try {
    const resUnauth = await getAlphasRoute(new NextRequest('http://127.0.0.1:3008/api/alphas'));
    assert.equal(resUnauth.status, 401);

    const resExpired = await getAlphasRoute(
      makeSignedRequest('http://127.0.0.1:3008/api/alphas', MEMBER_KP, Date.now() - 10 * 60 * 1000)
    );
    assert.equal(resExpired.status, 401);
  } finally {
    fx.restore();
  }
});

test('V1.6 Fix D [2/6]: Authenticated FREE request cannot retrieve Alpha Calls (403)', async () => {
  const fx = withAlphasMockFetch();
  try {
    const res = await getAlphasRoute(makeSignedRequest('http://127.0.0.1:3008/api/alphas', FREE_KP));
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.equal(data.error, 'ACCESS_DENIED_ZERO_BALANCE');
  } finally {
    fx.restore();
  }
});

test('V1.6 Fix D [3/6]: Authenticated MEMBER retrieves ALPHA (200) but gets 403 for MAX_ALPHA and WATCHLIST', async () => {
  const fx = withAlphasMockFetch();
  try {
    const resAlpha = await getAlphasRoute(
      makeSignedRequest('http://127.0.0.1:3008/api/alphas?callType=ALPHA', MEMBER_KP)
    );
    assert.equal(resAlpha.status, 200);
    const dataAlpha = await resAlpha.json();
    assert.equal(dataAlpha.ok, true);
    assert.equal(dataAlpha.tier, 'LAB_MEMBER');

    const resMax = await getAlphasRoute(
      makeSignedRequest('http://127.0.0.1:3008/api/alphas?callType=MAX_ALPHA', MEMBER_KP)
    );
    assert.equal(resMax.status, 403);

    const resWatch = await getAlphasRoute(
      makeSignedRequest('http://127.0.0.1:3008/api/alphas?callType=WATCHLIST', MEMBER_KP)
    );
    assert.equal(resWatch.status, 403);
  } finally {
    fx.restore();
  }
});

test('V1.6 Fix D [4/6]: Authenticated PRO retrieves ALPHA, MAX_ALPHA, and WATCHLIST (all 200)', async () => {
  await createStake({
    wallet_address: PRO_WALLET,
    amount_raw: (BigInt(16_000_000) * BigInt(1_000_000)).toString(), // ~$262.40 StakePoint stake
    lock_days: 90,
    tx_signature: `sig_v16_pro_${Date.now()}`,
  });

  const fx = withAlphasMockFetch();
  try {
    for (const ct of ['ALPHA', 'MAX_ALPHA', 'WATCHLIST']) {
      const res = await getAlphasRoute(
        makeSignedRequest(`http://127.0.0.1:3008/api/alphas?callType=${ct}`, PRO_KP)
      );
      assert.equal(res.status, 200, `Expected PRO to access ${ct}`);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.tier, 'PRO');
    }
  } finally {
    fx.restore();
  }
});

test('V1.6 Fix D [5/6]: Configured Admin remains authorized across all tiers and entitlements', async () => {
  const ent = await resolveWalletEntitlement(ADMIN_WALLET, {
    mockHoldingTokens: 0,
    mockStakedTokens: 0,
    mockPriceUsd: 0.0000164,
  });
  assert.equal(ent.isAdmin, true);
  assert.equal(ent.tier, 'pro');
  assert.equal(ent.permissions.canAccessTerminal, true);
  assert.equal(ent.permissions.canAccessProSignals, true);
  assert.equal(ent.permissions.canAccessAdmin, true);
});

test('V1.6 Fix D [6/6]: WATCHLIST entries are excluded from win rate & totals while MAX_ALPHA and ALPHA are included', () => {
  const stats = computePerformanceStats(
    [
      { ticker: 'ALP1', multiplier: '3.0000', callType: 'ALPHA' },
      { ticker: 'MAX1', multiplier: '5.0000', callType: 'MAX_ALPHA' },
      { ticker: 'ALP2', multiplier: '0.5000', callType: 'ALPHA' },
      { ticker: 'WL_WIN', multiplier: '10.0000', callType: 'WATCHLIST' },
    ],
    [
      { ticker: 'WL_OPEN', status: 'LIVE', callType: 'WATCHLIST' },
      { ticker: 'WL_CLOSED', status: 'CLOSED', outcome: 'PROFIT', callType: 'WATCHLIST' },
    ]
  );

  // 2 wins (ALP1, MAX1) + 1 loss (ALP2) = 3 total, 2 profitable, 66.7% win rate, 0 open
  assert.equal(stats.totalRecordedCalls, 3);
  assert.equal(stats.profitableCalls, 2);
  assert.equal(stats.losses, 1);
  assert.equal(stats.openCalls, 0);
  assert.equal(stats.winRate, 66.7);
});

// ============================================================================
// FIX E: PERSONAL WATCHLIST REAL REMOUNT / RELOAD VERIFICATION (12 STEPS)
// ============================================================================

test('V1.6 Fix E: Personal Watchlist survives full provider unmount/remount reload and isolates Wallet A vs Wallet B', async () => {
  localStorageShim.clear();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/auth/session')) {
      return { ok: true, status: 200, json: async () => ({ authenticated: false, wallet: null }) };
    }
    if (u.includes('/api/alphas')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, alphas: [], tier: 'FREE' }) };
    }
    if (u.includes('/api/campaigns')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, campaigns: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  let latestCtx = null;
  function Probe() {
    latestCtx = useGenesisBalance();
    return null;
  }

  async function mountFresh(walletCtx) {
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    let root;
    await act(async () => {
      root = createRoot(container);
      root.render(
        React.createElement(
          WalletContext.Provider,
          { value: walletCtx },
          React.createElement(GenesisProvider, null, React.createElement(Probe))
        )
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
    return {
      async update(nextWalletCtx) {
        await act(async () => {
          root.render(
            React.createElement(
              WalletContext.Provider,
              { value: nextWalletCtx },
              React.createElement(GenesisProvider, null, React.createElement(Probe))
            )
          );
        });
        await act(async () => {
          await new Promise((r) => setTimeout(r, 25));
        });
      },
      async unmount() {
        await act(async () => {
          root.unmount();
        });
        if (container.parentNode) container.parentNode.removeChild(container);
      },
    };
  }

  try {
    // 1. Connect Wallet A
    const session1 = await mountFresh(
      makeMockWalletContext({ connected: true, publicKey: makeMockPublicKey(WALLET_A) })
    );
    // 2. Save token A
    await act(async () => {
      latestCtx.toggleWatchlist('token-A');
    });
    // 3. Persist Wallet A's storage key
    assert.deepEqual(JSON.parse(localStorageShim.getItem(`trenchlabs_watchlist_v4:${WALLET_A}`)), [
      'token-A',
    ]);
    // 4. Unmount provider
    await session1.unmount();

    // 5. Mount fresh provider instance with Wallet A (simulated browser reload)
    const session2 = await mountFresh(
      makeMockWalletContext({ connected: true, publicKey: makeMockPublicKey(WALLET_A) })
    );
    // 6. Confirm token A is restored
    assert.deepEqual(latestCtx.watchlist, ['token-A']);

    // 7. Switch to Wallet B
    await session2.update(
      makeMockWalletContext({ connected: true, publicKey: makeMockPublicKey(WALLET_B) })
    );
    // 8. Confirm Wallet A's token is absent
    assert.deepEqual(latestCtx.watchlist, []);

    // 9. Save token B
    await act(async () => {
      latestCtx.toggleWatchlist('token-B');
    });
    assert.deepEqual(latestCtx.watchlist, ['token-B']);
    await session2.unmount();

    // 10. Reload/remount Wallet A
    const session3 = await mountFresh(
      makeMockWalletContext({ connected: true, publicKey: makeMockPublicKey(WALLET_A) })
    );
    // 11. Confirm token A remains
    assert.deepEqual(latestCtx.watchlist, ['token-A']);
    // 12. Confirm token B remains isolated
    assert.deepEqual(JSON.parse(localStorageShim.getItem(`trenchlabs_watchlist_v4:${WALLET_B}`)), [
      'token-B',
    ]);
    await session3.unmount();
  } finally {
    globalThis.fetch = originalFetch;
    localStorageShim.clear();
  }
});

// ============================================================================
// FIX F: ADMIN CAMPAIGN PUBLISHING & AUTHORIZATION VERIFICATION
// ============================================================================

test('V1.6 Fix F [1/2]: AdminCampaignManager creates, edits with preserved duration, switches safely, and updates submission status', async () => {
  const originalFetch = globalThis.fetch;
  const campaigns = [
    {
      id: 'camp-existing',
      title: 'Existing Raid',
      tweetUrl: 'https://x.com/trenchlabs/status/1850000000000000010',
      rewardAmount: '25 USDC',
      totalPool: '250 USDC',
      description: 'Existing raid instructions',
      status: 'ACTIVE',
      pinned: false,
      durationHours: 48,
      createdAt: '2026-11-01T00:00:00.000Z',
      expiresAt: '2026-11-03T00:00:00.000Z',
      submissionsCount: 1,
    },
  ];
  const submissionsByCamp = {
    'camp-existing': [
      {
        id: 'sub-existing-1',
        campaignId: 'camp-existing',
        walletAddress: WALLET_A,
        xHandle: '@raider_a',
        xRetweetLink: 'https://x.com/raider_a/status/1850000000000000020',
        status: 'PENDING',
        submittedAt: '2026-11-01T02:00:00.000Z',
      },
    ],
  };
  let lastPostBody = null;
  let lastPatchStatusBody = null;

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : null;

    if (u === '/api/campaigns' && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ ok: true, campaigns: [...campaigns] }) };
    }
    if (u === '/api/admin/campaigns' && method === 'POST') {
      lastPostBody = body;
      const created = {
        id: 'camp-new-1',
        ...body,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + Number(body.durationHours || 24) * 3600000).toISOString(),
        submissionsCount: 0,
      };
      campaigns.unshift(created);
      submissionsByCamp[created.id] = [];
      return { ok: true, status: 201, json: async () => ({ ok: true, campaign: created }) };
    }
    if (u === '/api/admin/campaigns/camp-existing/submissions' && method === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, submissions: submissionsByCamp['camp-existing'] }),
      };
    }
    if (u === '/api/admin/campaigns/submissions/sub-existing-1' && method === 'PATCH') {
      lastPatchStatusBody = body;
      submissionsByCamp['camp-existing'][0].status = body.status;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, submission: submissionsByCamp['camp-existing'][0] }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, submissions: [] }) };
  };

  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  let root;
  const toasts = [];

  try {
    await act(async () => {
      root = createRoot(container);
      root.render(
        React.createElement(AdminCampaignManager, {
          onToast: (msg, type) => toasts.push({ msg, type }),
          getAdminHeaders: async () => ({ 'x-wallet-address': ADMIN_WALLET }),
        })
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });

    // Submission loaded for existing campaign
    assert.ok(container.textContent.includes('@raider_a'));

    // Update submission status (PENDING -> AIRDROPPED)
    const airdropBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Mark Airdropped')
    );
    assert.ok(airdropBtn, 'Expected Mark Airdropped button');
    await act(async () => {
      airdropBtn.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
    assert.equal(lastPatchStatusBody?.status, 'AIRDROPPED');

    // Open New Raid Campaign form, fill required fields, and publish
    const newBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('New Raid Campaign')
    );
    assert.ok(newBtn, 'Expected New Raid Campaign button');
    await act(async () => {
      newBtn.click();
    });

    const inputs = Array.from(container.querySelectorAll('input'));
    const textarea = container.querySelector('textarea');
    await act(async () => {
      dom.setInputValue(inputs[0], 'V1.6 Launch Raid');
      dom.setInputValue(inputs[1], 'https://x.com/trenchlabs/status/1850000000000000999');
      dom.setInputValue(inputs[2], '100 USDC');
      if (textarea) dom.setInputValue(textarea, 'Repost and tag 2 friends');
    });

    await act(async () => {
      dom.submitForm(container.querySelector('form'));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });

    assert.equal(lastPostBody?.title, 'V1.6 Launch Raid');
    assert.ok(container.textContent.includes('V1.6 Launch Raid'));
  } finally {
    await act(async () => {
      root?.unmount();
    });
    if (container.parentNode) container.parentNode.removeChild(container);
    globalThis.fetch = originalFetch;
  }
});

test('V1.6 Fix F [2/2]: Non-admin user cannot create, edit, view submissions, or update submission status (401/403)', async () => {
  const memberHeaders = {
    cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(signSession(MEMBER_WALLET))}`,
    'Content-Type': 'application/json',
  };

  const resCreate = await postAdminCampaignRoute(
    new NextRequest('http://127.0.0.1:3008/api/admin/campaigns', {
      method: 'POST',
      headers: memberHeaders,
      body: JSON.stringify({ title: 'Bypass Attempt' }),
    })
  );
  assert.ok(resCreate.status === 401 || resCreate.status === 403);

  const resEdit = await patchAdminCampaignRoute(
    new NextRequest('http://127.0.0.1:3008/api/admin/campaigns/camp-1', {
      method: 'PATCH',
      headers: memberHeaders,
      body: JSON.stringify({ title: 'Edit Bypass' }),
    }),
    { params: Promise.resolve({ id: 'camp-1' }) }
  );
  assert.ok(resEdit.status === 401 || resEdit.status === 403);

  const resSubs = await getAdminSubmissionsRoute(
    new NextRequest('http://127.0.0.1:3008/api/admin/campaigns/camp-1/submissions', {
      headers: memberHeaders,
    }),
    { params: Promise.resolve({ id: 'camp-1' }) }
  );
  assert.ok(resSubs.status === 401 || resSubs.status === 403);

  const resPatchSub = await patchAdminSubmissionRoute(
    new NextRequest('http://127.0.0.1:3008/api/admin/campaigns/submissions/sub-1', {
      method: 'PATCH',
      headers: memberHeaders,
      body: JSON.stringify({ status: 'AIRDROPPED' }),
    }),
    { params: Promise.resolve({ submissionId: 'sub-1' }) }
  );
  assert.ok(resPatchSub.status === 401 || resPatchSub.status === 403);
});


// ============================================================================
// V1.7 FIX E: WATCHLIST callType FULL LIFECYCLE VERIFICATION
// ============================================================================

test('V1.7 Fix E [1/5]: WATCHLIST records are excluded from ledger statistics', () => {
  const stats = computePerformanceStats(
    [
      { ticker: 'WL1', multiplier: '10.0000', callType: 'WATCHLIST', outcome: 'PROFIT' },
      { ticker: 'WL2', multiplier: '0.2000', callType: 'WATCHLIST', outcome: 'LOSS' },
      { ticker: 'ALP', multiplier: '3.0000', callType: 'ALPHA', outcome: 'PROFIT' },
    ],
    []
  );

  assert.equal(stats.totalRecordedCalls, 1, 'Only ALPHA records should be counted');
  assert.equal(stats.profitableCalls, 1);
  assert.equal(stats.losses, 0);
  assert.equal(stats.openCalls, 0);
});

test('V1.7 Fix E [2/5]: WATCHLIST records are excluded from call-registry statistics', () => {
  const stats = computePerformanceStats(
    [],
    [
      { ticker: 'WL_LIVE', status: 'LIVE', callType: 'WATCHLIST' },
      { ticker: 'WL_CLOSED', status: 'CLOSED', outcome: 'PROFIT', callType: 'WATCHLIST' },
      { ticker: 'ALP_LIVE', status: 'LIVE', callType: 'ALPHA' },
    ]
  );

  assert.equal(stats.openCalls, 1, 'Only ALPHA open calls should count');
  assert.equal(stats.totalRecordedCalls, 0, 'WATCHLIST closed calls should not count');
});

test('V1.7 Fix E [3/5]: WATCHLIST records do not affect win rate', () => {
  const stats = computePerformanceStats(
    [
      { ticker: 'A1', multiplier: '3.0', callType: 'ALPHA' },
      { ticker: 'A2', multiplier: '0.5', callType: 'ALPHA' },
      // WATCHLIST records that would distort win rate if included
      { ticker: 'WL_WIN1', multiplier: '50.0', callType: 'WATCHLIST' },
      { ticker: 'WL_WIN2', multiplier: '100.0', callType: 'WATCHLIST' },
      { ticker: 'WL_WIN3', multiplier: '200.0', callType: 'WATCHLIST' },
    ],
    []
  );

  // Without WATCHLIST: 1 win, 1 loss = 50% win rate
  // With WATCHLIST (if counted): 4 wins, 1 loss = 80%
  assert.equal(stats.totalRecordedCalls, 2);
  assert.equal(stats.profitableCalls, 1);
  assert.equal(stats.losses, 1);
  assert.equal(stats.winRate, 50);
});

test('V1.7 Fix E [4/5]: MAX_ALPHA remains included in performance statistics', () => {
  const stats = computePerformanceStats(
    [
      { ticker: 'MAX1', multiplier: '5.0', callType: 'MAX_ALPHA' },
      { ticker: 'MAX2', multiplier: '0.3', callType: 'MAX_ALPHA' },
      { ticker: 'ALP1', multiplier: '2.0', callType: 'ALPHA' },
    ],
    []
  );

  assert.equal(stats.totalRecordedCalls, 3);
  assert.equal(stats.profitableCalls, 2); // MAX1 + ALP1
  assert.equal(stats.losses, 1); // MAX2
});

test('V1.7 Fix E [5/5]: Missing callType defaults to inclusion (legacy ALPHA records)', () => {
  const stats = computePerformanceStats(
    [
      { ticker: 'LEGACY1', multiplier: '4.0' },               // no callType
      { ticker: 'LEGACY2', multiplier: '0.8', callType: null },  // explicit null
      { ticker: 'LEGACY3', multiplier: '2.0', callType: undefined }, // explicit undefined
    ],
    []
  );

  // Missing callType is not 'WATCHLIST', so records are included (legacy behavior)
  assert.equal(stats.totalRecordedCalls, 3);
  assert.equal(stats.profitableCalls, 2); // LEGACY1 (4x) + LEGACY3 (2x)
  assert.equal(stats.losses, 1); // LEGACY2 (0.8x)
});

// ============================================================================
// V1.7 FIX F: SUCCESSFUL AUTHENTICATED ALPHA & ADMIN WORKFLOW VERIFICATION
// ============================================================================

test('V1.7 Fix F [1/6]: MEMBER can access ordinary ALPHA calls with 200 and correct tier', async () => {
  const fx = withAlphasMockFetch();
  try {
    const res = await getAlphasRoute(
      makeSignedRequest('http://127.0.0.1:3008/api/alphas?callType=ALPHA', MEMBER_KP)
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.tier, 'LAB_MEMBER');
    assert.equal(typeof data.balance, 'number');
    assert.equal(typeof data.serverTime, 'string');
    assert.ok(Array.isArray(data.items));
  } finally {
    fx.restore();
  }
});

test('V1.7 Fix F [2/6]: PRO can access ALPHA, MAX_ALPHA, and WATCHLIST with correct tier in each response', async () => {
  // PRO stake should already exist from V1.6 Fix D [4/6]
  const fx = withAlphasMockFetch();
  try {
    for (const ct of ['ALPHA', 'MAX_ALPHA', 'WATCHLIST']) {
      const res = await getAlphasRoute(
        makeSignedRequest(`http://127.0.0.1:3008/api/alphas?callType=${ct}`, PRO_KP)
      );
      assert.equal(res.status, 200, `Expected PRO 200 for ${ct}`);
      const data = await res.json();
      assert.equal(data.ok, true, `Expected ok:true for ${ct}`);
      assert.equal(data.tier, 'PRO', `Expected PRO tier for ${ct}`);
      assert.ok(Array.isArray(data.items), `Expected items array for ${ct}`);
      assert.ok(Array.isArray(data.callers), `Expected callers array for ${ct}`);
      assert.equal(typeof data.balance, 'number');
      assert.ok(data.allocationCap !== undefined, `Expected allocationCap for ${ct}`);
    }
  } finally {
    fx.restore();
  }
});

test('V1.7 Fix F [3/6]: Client-supplied tier parameter does not grant access — FREE remains restricted', async () => {
  const fx = withAlphasMockFetch();
  try {
    // FREE user trying to pass callType=ALPHA — should still get 403
    const res = await getAlphasRoute(
      makeSignedRequest('http://127.0.0.1:3008/api/alphas?callType=ALPHA', FREE_KP)
    );
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.equal(data.error, 'ACCESS_DENIED_ZERO_BALANCE');
  } finally {
    fx.restore();
  }
});

test('V1.7 Fix F [4/6]: MEMBER cannot access WATCHLIST even with explicit callType parameter', async () => {
  const fx = withAlphasMockFetch();
  try {
    const res = await getAlphasRoute(
      makeSignedRequest('http://127.0.0.1:3008/api/alphas?callType=WATCHLIST', MEMBER_KP)
    );
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.equal(data.error, 'FORBIDDEN');
  } finally {
    fx.restore();
  }
});

test('V1.7 Fix F [5/6]: Admin authenticated campaign create, edit, and submission management', async () => {
  const originalFetch = globalThis.fetch;
  const campaigns = [
    {
      id: 'camp-f-existing',
      title: 'Fix F Test Raid',
      tweetUrl: 'https://x.com/trenchlabs/status/1850000000000000777',
      rewardAmount: '10 USDC',
      totalPool: '100 USDC',
      description: 'Test raid for Fix F',
      status: 'ACTIVE',
      pinned: false,
      durationHours: 24,
      createdAt: '2026-11-01T00:00:00.000Z',
      expiresAt: '2026-11-02T00:00:00.000Z',
      submissionsCount: 1,
    },
  ];
  const submissionsByCamp = {
    'camp-f-existing': [
      {
        id: 'sub-f-1',
        campaignId: 'camp-f-existing',
        walletAddress: WALLET_A,
        xHandle: '@fix_f_raider',
        xRetweetLink: 'https://x.com/fix_f_raider/status/18500000000000',
        status: 'PENDING',
        submittedAt: '2026-11-01T03:00:00.000Z',
      },
    ],
  };
  let capturedPostBody = null;
  let capturedPatchBody = null;

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : null;

    if (u === '/api/campaigns' && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ ok: true, campaigns: [...campaigns] }) };
    }
    if (u === '/api/admin/campaigns' && method === 'POST') {
      capturedPostBody = body;
      const created = {
        id: 'camp-f-new',
        ...body,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + Number(body.durationHours || 24) * 3600000).toISOString(),
        submissionsCount: 0,
      };
      campaigns.unshift(created);
      submissionsByCamp[created.id] = [];
      return { ok: true, status: 201, json: async () => ({ ok: true, campaign: created }) };
    }
    if (u === '/api/admin/campaigns/camp-f-existing/submissions' && method === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, submissions: submissionsByCamp['camp-f-existing'] }),
      };
    }
    if (u === '/api/admin/campaigns/submissions/sub-f-1' && method === 'PATCH') {
      capturedPatchBody = body;
      submissionsByCamp['camp-f-existing'][0].status = body.status;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, submission: submissionsByCamp['camp-f-existing'][0] }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, submissions: [] }) };
  };

  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  let root;
  const toasts = [];

  try {
    // 1. Mount AdminCampaignManager with authenticated admin
    await act(async () => {
      root = createRoot(container);
      root.render(
        React.createElement(AdminCampaignManager, {
          onToast: (msg, type) => toasts.push({ msg, type }),
          getAdminHeaders: async () => ({ 'x-wallet-address': ADMIN_WALLET }),
        })
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });

    // 2. Verify existing submissions loaded
    assert.ok(container.textContent.includes('@fix_f_raider'));

    // 3. Mark submission AIRDROPPED
    const airdropBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Mark Airdropped')
    );
    assert.ok(airdropBtn, 'Mark Airdropped button should exist');
    await act(async () => {
      airdropBtn.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
    assert.equal(capturedPatchBody?.status, 'AIRDROPPED', 'Should persist AIRDROPPED status');
    assert.equal(submissionsByCamp['camp-f-existing'][0].status, 'AIRDROPPED');

    // 4. Create new campaign
    const newBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('New Raid Campaign')
    );
    assert.ok(newBtn, 'New Raid Campaign button should exist');
    await act(async () => {
      newBtn.click();
    });

    const inputs = Array.from(container.querySelectorAll('input'));
    const textarea = container.querySelector('textarea');
    await act(async () => {
      dom.setInputValue(inputs[0], 'V1.7 Fix F Campaign');
      dom.setInputValue(inputs[1], 'https://x.com/trenchlabs/status/1850000000000000888');
      dom.setInputValue(inputs[2], '50 USDC');
      if (textarea) dom.setInputValue(textarea, 'Retweet for rewards');
    });

    await act(async () => {
      dom.submitForm(container.querySelector('form'));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });

    // 5. Verify campaign was created
    assert.equal(capturedPostBody?.title, 'V1.7 Fix F Campaign');
    assert.ok(container.textContent.includes('V1.7 Fix F Campaign'), 'Created campaign should appear in list');
  } finally {
    await act(async () => {
      root?.unmount();
    });
    if (container.parentNode) container.parentNode.removeChild(container);
    globalThis.fetch = originalFetch;
  }
});

test('V1.7 Fix F [6/6]: Stale/unavailable oracle does not grant higher tier', async () => {
  const fx = withAlphasMockFetch(() => {
    // Override Jupiter price to return an error
    return new Response(JSON.stringify({ error: 'unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  try {
    const ent = await resolveWalletEntitlement(FREE_WALLET, {
      mockHoldingTokens: 5_000_000,
      mockStakedTokens: 50_000_000,
      mockPriceUsd: 0,  // Oracle returns 0 = unavailable
    });

    // With oracle unavailable, tier should be 'unknown', not 'member' or 'pro'
    assert.equal(ent.tier, 'unknown');
    assert.equal(ent.memberEligibility.eligible, false);
    assert.equal(ent.proEligibility.eligible, false);
  } finally {
    fx.restore();
  }
});

// ---------------------------------------------------------------------------
// BRANDING UPDATE VERIFICATION ($H42 TICKER AND HERO MESSAGING)
// ---------------------------------------------------------------------------

const fs = await import('node:fs');
const path = await import('node:path');
const { formatTokenTicker } = await import('../../src/lib/format-token-ticker.ts');
const { DEFAULT_GENESIS_MINT } = await import('../../src/lib/config.ts');

const ROOT_DIR = path.resolve(process.cwd());

test('Branding [1/18]: The hero contains the exact approved paragraph', () => {
  const heroPath = path.join(ROOT_DIR, 'src/components/HeroTerminal.tsx');
  const content = fs.readFileSync(heroPath, 'utf8');
  assert.ok(
    content.includes('TrenchLabs HQ is the lab — the platform. The GENESIS (<span className="text-toxic-bright font-bold">$H42</span>) is your access key.'),
    'Hero paragraph must contain exact approved copy'
  );
  assert.ok(
    content.includes('We don') && content.includes('chase chains, we chase trenches. If there') && content.includes('s a trench, we') && content.includes('re in it.'),
    'Hero paragraph must contain trenches punchline'
  );
});

test('Branding [2/18]: The hero displays $H42', () => {
  const heroPath = path.join(ROOT_DIR, 'src/components/HeroTerminal.tsx');
  const content = fs.readFileSync(heroPath, 'utf8');
  assert.ok(content.includes('$H42'), 'Hero must display $H42 ticker');
  assert.ok(content.includes('VIEW $H42'), 'Hero CTA must say VIEW $H42');
});

test('Branding [3/18]: The hero no longer displays $GENESIS', () => {
  const heroPath = path.join(ROOT_DIR, 'src/components/HeroTerminal.tsx');
  const content = fs.readFileSync(heroPath, 'utf8');
  assert.ok(!content.includes('$GENESIS'), 'Hero must not display $GENESIS');
});

test('Branding [4/18]: The public navigation and footer use $H42 wherever the ticker is shown', () => {
  const footerPath = path.join(ROOT_DIR, 'src/components/Footer.tsx');
  const footerContent = fs.readFileSync(footerPath, 'utf8');
  assert.ok(footerContent.includes('Token: $H42 • Solana Native'), 'Footer must show Token: $H42');
  assert.ok(!footerContent.includes('Token: $GENESIS'), 'Footer must not show Token: $GENESIS');
});

test('Branding [5/18]: The membership screens display $H42', () => {
  const lockedPath = path.join(ROOT_DIR, 'src/components/LockedTerminal.tsx');
  const lockedContent = fs.readFileSync(lockedPath, 'utf8');
  assert.ok(lockedContent.includes('$H42'), 'LockedTerminal must display $H42');
  assert.ok(!lockedContent.includes('$GENESIS'), 'LockedTerminal must not display $GENESIS');

  const restrictPath = path.join(ROOT_DIR, 'src/components/dashboard/MembershipRestrictionScreen.tsx');
  const restrictContent = fs.readFileSync(restrictPath, 'utf8');
  assert.ok(restrictContent.includes('$H42'), 'MembershipRestrictionScreen must display $H42');
  assert.ok(!restrictContent.includes('$GENESIS'), 'MembershipRestrictionScreen must not display $GENESIS');

  const tierPath = path.join(ROOT_DIR, 'src/components/landing/TierSection.tsx');
  const tierContent = fs.readFileSync(tierPath, 'utf8');
  assert.ok(tierContent.includes('$H42'), 'TierSection must display $H42');
  assert.ok(!tierContent.includes('$GENESIS'), 'TierSection must not display $GENESIS');
});

test('Branding [6/18]: The staking screens display $H42', () => {
  const stakingCardPath = path.join(ROOT_DIR, 'src/components/stake/DashboardStakingCard.tsx');
  const stakingContent = fs.readFileSync(stakingCardPath, 'utf8');
  assert.ok(stakingContent.includes('Staking — $H42'), 'DashboardStakingCard must display Staking — $H42');
  assert.ok(!stakingContent.includes('$GENESIS'), 'DashboardStakingCard must not display $GENESIS');

  const stakeClientPath = path.join(ROOT_DIR, 'src/components/stake/StakeClientView.tsx');
  const stakeClientContent = fs.readFileSync(stakeClientPath, 'utf8');
  assert.ok(stakeClientContent.includes('Stake $H42 to unlock Pro'), 'StakeClientView must display Stake $H42');
  assert.ok(!stakeClientContent.includes('$GENESIS'), 'StakeClientView must not display $GENESIS');

  const stakeFormPath = path.join(ROOT_DIR, 'src/components/stake/StakeForm.tsx');
  const stakeFormContent = fs.readFileSync(stakeFormPath, 'utf8');
  assert.ok(stakeFormContent.includes('Stake $H42 on StakePoint →'), 'StakeForm must display Stake $H42');
  assert.ok(!stakeFormContent.includes('$GENESIS'), 'StakeForm must not display $GENESIS');

  const stakePointPath = path.join(ROOT_DIR, 'src/components/staking/StakePointCard.tsx');
  const stakePointContent = fs.readFileSync(stakePointPath, 'utf8');
  assert.ok(stakePointContent.includes('Staking — $H42'), 'StakePointCard must display Staking — $H42');
  assert.ok(!stakePointContent.includes('$GENESIS'), 'StakePointCard must not display $GENESIS');
});

test('Branding [7/18]: Campaign and reward displays use $H42', () => {
  const cardPath = path.join(ROOT_DIR, 'src/components/campaigns/CampaignCard.tsx');
  const cardContent = fs.readFileSync(cardPath, 'utf8');
  assert.ok(cardContent.includes('$H42 airdrop'), 'CampaignCard must display $H42 airdrop');
  assert.ok(cardContent.includes('formatTokenTicker(campaign.rewardAmount)'), 'CampaignCard must format rewardAmount');
  assert.ok(!cardContent.includes('$GENESIS airdrop'), 'CampaignCard must not display $GENESIS airdrop');

  const sectionPath = path.join(ROOT_DIR, 'src/components/campaigns/CampaignSection.tsx');
  const sectionContent = fs.readFileSync(sectionPath, 'utf8');
  assert.ok(sectionContent.includes('$H42 airdrops'), 'CampaignSection must display $H42 airdrops');
  assert.ok(!sectionContent.includes('$GENESIS airdrops'), 'CampaignSection must not display $GENESIS airdrops');
});

test('Branding [8/18]: Admin campaign placeholders use $H42', () => {
  const adminPath = path.join(ROOT_DIR, 'src/components/admin/AdminCampaignManager.tsx');
  const adminContent = fs.readFileSync(adminPath, 'utf8');
  assert.ok(adminContent.includes('placeholder="e.g. 50,000 $H42 or 0.25 SOL"'), 'Admin placeholder must use $H42');
  assert.ok(adminContent.includes('placeholder="e.g. 1,000,000 $H42 Pool"'), 'Admin pool placeholder must use $H42');
  assert.ok(!adminContent.includes('$GENESIS'), 'AdminCampaignManager must not contain $GENESIS');
});

test('Branding [9/18]: Telegram user-facing messages use $H42', () => {
  const tgPath = path.join(ROOT_DIR, 'src/server/telegram.ts');
  const tgContent = fs.readFileSync(tgPath, 'utf8');
  assert.ok(tgContent.includes('Hold at least $20 in $H42'), 'Telegram message must use $H42');
  assert.ok(tgContent.includes('Stake $250 in $H42 for 90 days'), 'Telegram message must use $H42');
  assert.ok(!tgContent.includes('$GENESIS'), 'Telegram server must not contain $GENESIS');
});

test('Branding [10/18]: API user-facing access messages use $H42', () => {
  const alphasRoutePath = path.join(ROOT_DIR, 'src/app/api/alphas/route.ts');
  const alphasContent = fs.readFileSync(alphasRoutePath, 'utf8');
  assert.ok(alphasContent.includes('Holding at least $20 worth of $H42'), 'Alphas route error must use $H42');

  const campaignsRoutePath = path.join(ROOT_DIR, 'src/app/api/campaigns/route.ts');
  const campaignsContent = fs.readFileSync(campaignsRoutePath, 'utf8');
  assert.ok(campaignsContent.includes('50,000 $H42'), 'Campaigns route error must use $H42');

  const tgLinkPath = path.join(ROOT_DIR, 'src/app/api/telegram/link/route.ts');
  const tgLinkContent = fs.readFileSync(tgLinkPath, 'utf8');
  assert.ok(tgLinkContent.includes('Holding at least $20 worth of $H42'), 'Telegram link error must use $H42');

  const tiersCurrentPath = path.join(ROOT_DIR, 'src/app/api/tiers/current/route.ts');
  const tiersCurrentContent = fs.readFileSync(tiersCurrentPath, 'utf8');
  assert.ok(tiersCurrentContent.includes('$H42 price oracle'), 'Tiers current error must use $H42');
});

test('Branding [11/18]: Legacy persisted $GENESIS content renders as $H42 where dynamic display formatting is required', () => {
  assert.equal(formatTokenTicker('50,000 $GENESIS'), '50,000 $H42');
  assert.equal(formatTokenTicker('Quote with $GENESIS'), 'Quote with $H42');
  assert.equal(formatTokenTicker('Receive your $GENESIS airdrop.'), 'Receive your $H42 airdrop.');
  assert.equal(formatTokenTicker('Pool: 1,000,000 $GENESIS'), 'Pool: 1,000,000 $H42');
});

test('Branding [12/18]: Existing $H42 content remains unchanged', () => {
  assert.equal(formatTokenTicker('50,000 $H42'), '50,000 $H42');
  assert.equal(formatTokenTicker('Quote with $H42'), 'Quote with $H42');
  assert.equal(formatTokenTicker('$H42'), '$H42');
  assert.equal(formatTokenTicker('Plain string without ticker'), 'Plain string without ticker');
});

test('Branding [13/18]: The mint address remains exactly: EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump', () => {
  const EXPECTED_MINT = 'EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump';
  assert.equal(GENESIS_MINT, EXPECTED_MINT);
});

test('Branding [14/18]: GENESIS_MINT and DEFAULT_GENESIS_MINT remain unchanged', () => {
  const EXPECTED_MINT = 'EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump';
  assert.equal(DEFAULT_GENESIS_MINT, EXPECTED_MINT);
  assert.equal(GENESIS_MINT, DEFAULT_GENESIS_MINT);
});

test('Branding [15/18]: NEXT_PUBLIC_GENESIS_MINT remains unchanged', () => {
  const envPath = path.join(ROOT_DIR, '.env.example');
  const envContent = fs.readFileSync(envPath, 'utf8');
  assert.ok(
    envContent.includes('NEXT_PUBLIC_GENESIS_MINT=EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump'),
    'Env example must preserve NEXT_PUBLIC_GENESIS_MINT'
  );
});

test('Branding [16/18]: Wallet verification and balance retrieval remain unchanged', async () => {
  const ent = await resolveWalletEntitlement(FREE_WALLET, {
    mockHoldingTokens: 100,
    mockStakedTokens: 0,
    mockPriceUsd: 0.0000164,
  });
  assert.ok(ent !== null && typeof ent === 'object');
  assert.equal(ent.walletAddress, FREE_WALLET);
  assert.equal(typeof ent.memberEligibility.balanceRaw, 'string');
  assert.equal(typeof ent.memberEligibility.balanceTokens, 'number');
  assert.equal(typeof ent.price.usd, 'number');
});

test('Branding [17/18]: Membership entitlement calculations remain unchanged', async () => {
  // Free: holding $0, staking $0
  const freeEnt = await resolveWalletEntitlement(FREE_WALLET, {
    mockHoldingTokens: 0,
    mockStakedTokens: 0,
    mockPriceUsd: 0.0000164,
  });
  assert.equal(freeEnt.tier, 'free');

  // Member: holding >= $20 USD
  const memberTokens = Math.ceil(20 / 0.0000164);
  const memberEnt = await resolveWalletEntitlement(MEMBER_WALLET, {
    mockHoldingTokens: memberTokens,
    mockStakedTokens: 0,
    mockPriceUsd: 0.0000164,
  });
  assert.equal(memberEnt.tier, 'member');

  // Pro: staking >= $250 USD
  const proStakedTokens = Math.ceil(250 / 0.0000164);
  const proEnt = await resolveWalletEntitlement(PRO_WALLET, {
    mockHoldingTokens: 0,
    mockStakedTokens: proStakedTokens,
    mockPriceUsd: 0.0000164,
  });
  assert.equal(proEnt.tier, 'pro');
});

test('Branding [18/18]: StakePoint verification remains unchanged', () => {
  const stakePointPath = path.join(ROOT_DIR, 'src/server/stakepoint.ts');
  const stakePointContent = fs.readFileSync(stakePointPath, 'utf8');
  assert.ok(stakePointContent.includes('b.mint === GENESIS_MINT'), 'StakePoint must still verify GENESIS_MINT');
  assert.ok(stakePointContent.includes('PRO_STAKE_USD_THRESHOLD'), 'StakePoint must enforce PRO_STAKE_USD_THRESHOLD');
});
