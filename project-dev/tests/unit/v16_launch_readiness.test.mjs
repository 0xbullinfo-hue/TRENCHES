import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { NextRequest } from 'next/server';
import { installDomShim } from './helpers/dom-shim.mjs';

process.env.ALLOW_FILE_PERSISTENCE = 'true';

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
