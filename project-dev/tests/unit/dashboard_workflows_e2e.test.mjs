import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomShim } from './helpers/dom-shim.mjs';

// Mock next/server's `after` to be a no-op in test context (outside Next.js request lifecycle).
// ESM namespace objects are frozen, so we patch via require() which returns a mutable CJS wrapper.
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const safeAfter = (fn) => { try { if (typeof fn === 'function') fn(); } catch { /* no request context */ } };
try {
  const nextServerCjs = _require('next/server');
  nextServerCjs.after = safeAfter;
} catch {}
try {
  const afterInternalCjs = _require('next/dist/server/after/after.js');
  afterInternalCjs.after = safeAfter;
} catch {}

const dom = installDomShim();

// Minimal localStorage shim on window & globalThis for GenesisContext
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

const { resolveWalletEntitlement } = await import('../../src/server/entitlements.ts');
const { TOKEN_DECIMALS } = await import('../../src/lib/config.ts');
const { GenesisProvider, useGenesisBalance } = await import('../../src/context/GenesisContext.tsx');
const { GET: getAlphasRoute } = await import('../../src/app/api/alphas/route.ts');
const { GET: getAdminSubmissionsRoute } = await import(
  '../../src/app/api/admin/campaigns/[id]/submissions/route.ts'
);
const { PATCH: patchAdminSubmissionRoute } = await import(
  '../../src/app/api/admin/campaigns/submissions/[submissionId]/route.ts'
);
const { POST: postAdminCampaignRoute } = await import('../../src/app/api/admin/campaigns/route.ts');

const WALLET_A = '11111111111111111111111111111111';
const WALLET_B = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// ============================================================================
// WORKFLOW 1: MEMBERSHIP ENTITLEMENT BOUNDARIES (6/6)
// ============================================================================

test('V1.5 Workflow 1 [1/6]: No qualifying balance or stake -> FREE', async () => {
  const ent = await resolveWalletEntitlement(WALLET_A, {
    mockHoldingTokens: 0,
    mockStakedTokens: 0,
    mockPriceUsd: 0.0000164,
  });
  assert.equal(ent.tier, 'free');
  assert.equal(ent.permissions.canAccessTerminal, false);
  assert.equal(ent.permissions.canAccessProSignals, false);
});

test('V1.5 Workflow 1 [2/6]: >= $20 liquid $H42 -> MEMBER only (not PRO)', async () => {
  const ent = await resolveWalletEntitlement(WALLET_A, {
    mockHoldingTokens: 1_500_000, // ~$24.60
    mockStakedTokens: 0,
    mockPriceUsd: 0.0000164,
  });
  assert.equal(ent.tier, 'member');
  assert.equal(ent.permissions.canAccessTerminal, true);
  assert.equal(ent.permissions.canAccessProSignals, false);
});

test('V1.5 Workflow 1 [3/6]: < $20 liquid, no qualifying stake -> FREE', async () => {
  const ent = await resolveWalletEntitlement(WALLET_A, {
    mockHoldingTokens: 500_000, // ~$8.20
    mockStakedTokens: 0,
    mockPriceUsd: 0.0000164,
  });
  assert.equal(ent.tier, 'free');
  assert.equal(ent.permissions.canAccessTerminal, false);
});

test('V1.5 Workflow 1 [4/6]: >= $250 StakePoint stake -> PRO', async () => {
  const ent = await resolveWalletEntitlement(WALLET_A, {
    mockHoldingTokens: 2_000_000,
    mockStakedTokens: 16_000_000, // ~$262.40
    mockPriceUsd: 0.0000164,
  });
  assert.equal(ent.tier, 'pro');
  assert.equal(ent.permissions.canAccessTerminal, true);
  assert.equal(ent.permissions.canAccessProSignals, true);
});

test('V1.5 Workflow 1 [5/6]: $250 liquid without StakePoint stake -> MEMBER (never PRO)', async () => {
  const ent = await resolveWalletEntitlement(WALLET_A, {
    mockHoldingTokens: 20_000_000, // ~$328 liquid
    mockStakedTokens: 0,
    mockPriceUsd: 0.0000164,
  });
  assert.equal(ent.tier, 'member');
  assert.equal(ent.permissions.canAccessProSignals, false);
});

test('V1.5 Workflow 1 [6/6]: >= $250 StakePoint stake with $0 liquid -> PRO (no extra $20 liquid required)', async () => {
  const ent = await resolveWalletEntitlement(WALLET_A, {
    mockHoldingTokens: 0,
    mockStakedTokens: 16_000_000, // ~$262.40 staked
    mockPriceUsd: 0.0000164,
  });
  assert.equal(ent.tier, 'pro');
  assert.equal(ent.permissions.canAccessTerminal, true);
  assert.equal(ent.permissions.canAccessProSignals, true);
});

// ============================================================================
// WORKFLOW 2 & 5: SERVER-AUTHORITATIVE /api/alphas GATING
// ============================================================================

test('V1.5 Workflows 2 & 5: /api/alphas enforces unauthenticated 401 gating server-side', async () => {
  const resFree = await getAlphasRoute(new Request('http://localhost:3008/api/alphas'));
  assert.equal(resFree.status, 401);
});

// ============================================================================
// WORKFLOW 4: PERSONAL WATCHLIST PER-WALLET ISOLATION & PERSISTENCE
// ============================================================================

test('V1.5 Workflow 4: Personal Watchlist isolates saved tokens per wallet across switch and reload', async () => {
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

  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  let root;

  async function renderWithWallet(walletCtx) {
    await act(async () => {
      if (!root) root = createRoot(container);
      root.render(
        React.createElement(
          WalletContext.Provider,
          { value: walletCtx },
          React.createElement(GenesisProvider, null, React.createElement(Probe))
        )
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }

  try {
    // 1. Connect Wallet A and save token-alpha-1
    await renderWithWallet(
      makeMockWalletContext({ connected: true, publicKey: makeMockPublicKey(WALLET_A) })
    );
    assert.deepEqual(latestCtx.watchlist, []);

    await act(async () => {
      latestCtx.toggleWatchlist('token-alpha-1');
    });
    assert.deepEqual(latestCtx.watchlist, ['token-alpha-1']);

    // Duplicate toggle removes, then re-adds cleanly without duplicates
    await act(async () => {
      latestCtx.toggleWatchlist('token-alpha-1');
    });
    assert.deepEqual(latestCtx.watchlist, []);
    await act(async () => {
      latestCtx.toggleWatchlist('token-alpha-1');
    });
    assert.deepEqual(latestCtx.watchlist, ['token-alpha-1']);

    // 2. Switch to Wallet B -> must NOT see Wallet A's saved entries
    await renderWithWallet(
      makeMockWalletContext({ connected: true, publicKey: makeMockPublicKey(WALLET_B) })
    );
    assert.deepEqual(latestCtx.watchlist, []);

    await act(async () => {
      latestCtx.toggleWatchlist('token-beta-2');
    });
    assert.deepEqual(latestCtx.watchlist, ['token-beta-2']);

    // 3. Return to Wallet A -> Wallet A's saved token is restored
    await renderWithWallet(
      makeMockWalletContext({ connected: true, publicKey: makeMockPublicKey(WALLET_A) })
    );
    assert.deepEqual(latestCtx.watchlist, ['token-alpha-1']);
    assert.ok(localStorageShim.getItem(`trenchlabs_watchlist_v4:${WALLET_A}`)?.includes('token-alpha-1'));
    assert.ok(localStorageShim.getItem(`trenchlabs_watchlist_v4:${WALLET_B}`)?.includes('token-beta-2'));
  } finally {
    await act(async () => {
      root?.unmount();
    });
    if (container.parentNode) container.parentNode.removeChild(container);
    globalThis.fetch = originalFetch;
    localStorageShim.clear();
  }
});

// ============================================================================
// WORKFLOW 6: ADMIN DESK SERVER-SIDE AUTHORIZATION ENFORCEMENT
// ============================================================================

test('V1.5 Workflow 6: Admin campaign & submission API routes enforce authorization server-side', async () => {
  const resCreate = await postAdminCampaignRoute(
    new Request('http://localhost:3008/api/admin/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Unauthorized Raid' }),
    })
  );
  assert.ok(resCreate.status === 401 || resCreate.status === 403);

  const resList = await getAdminSubmissionsRoute(
    new Request('http://localhost:3008/api/admin/campaigns/camp-1/submissions'),
    { params: Promise.resolve({ id: 'camp-1' }) }
  );
  assert.ok(resList.status === 401 || resList.status === 403);

  const resPatch = await patchAdminSubmissionRoute(
    new Request('http://localhost:3008/api/admin/campaigns/submissions/sub-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'AIRDROPPED' }),
    }),
    { params: Promise.resolve({ submissionId: 'sub-1' }) }
  );
  assert.ok(resPatch.status === 401 || resPatch.status === 403);
});

// ============================================================================
// V1.6: EXACT MEMBERSHIP USD BOUNDARY REGRESSION TESTS
// ============================================================================

const TEST_GENESIS_PRICE = 0.0000164;

const MEMBER_THRESHOLD_TOKENS = Math.ceil(20 / TEST_GENESIS_PRICE);
const PRO_THRESHOLD_TOKENS = Math.ceil(250 / TEST_GENESIS_PRICE);

test('V1.6: Exact minimum liquid token quantity unlocks MEMBER', async () => {
  const ent = await resolveWalletEntitlement(WALLET_A, {
    mockHoldingTokens: MEMBER_THRESHOLD_TOKENS,
    mockStakedTokens: 0,
    mockPriceUsd: TEST_GENESIS_PRICE,
  });

  assert.equal(ent.tier, 'member');
  assert.ok(ent.memberEligibility.balanceUsd >= 20);
  assert.equal(ent.proEligibility.eligible, false);
  assert.equal(ent.permissions.canAccessTerminal, true);
  assert.equal(ent.permissions.canAccessProSignals, false);
});

test('V1.6: One token below MEMBER threshold remains FREE', async () => {
  const ent = await resolveWalletEntitlement(WALLET_A, {
    mockHoldingTokens: MEMBER_THRESHOLD_TOKENS - 1,
    mockStakedTokens: 0,
    mockPriceUsd: TEST_GENESIS_PRICE,
  });

  assert.equal(ent.tier, 'free');
  assert.ok(ent.memberEligibility.balanceUsd < 20);
  assert.equal(ent.permissions.canAccessTerminal, false);
});

test('V1.6: Exact minimum StakePoint quantity unlocks PRO', async () => {
  const ent = await resolveWalletEntitlement(WALLET_A, {
    mockHoldingTokens: 0,
    mockStakedTokens: PRO_THRESHOLD_TOKENS,
    mockPriceUsd: TEST_GENESIS_PRICE,
  });

  assert.equal(ent.tier, 'pro');
  assert.ok(ent.proEligibility.stakedUsd >= 250);
  assert.equal(ent.permissions.canAccessProSignals, true);
});

test('V1.6: One token below PRO stake threshold cannot unlock PRO', async () => {
  const ent = await resolveWalletEntitlement(WALLET_A, {
    mockHoldingTokens: 0,
    mockStakedTokens: PRO_THRESHOLD_TOKENS - 1,
    mockPriceUsd: TEST_GENESIS_PRICE,
  });

  assert.notEqual(ent.tier, 'pro');
  assert.ok(ent.proEligibility.stakedUsd < 250);
  assert.equal(ent.permissions.canAccessProSignals, false);
});

test('V1.6: Large liquid balance cannot substitute for PRO staking', async () => {
  const ent = await resolveWalletEntitlement(WALLET_A, {
    mockHoldingTokens: Math.ceil(1000 / TEST_GENESIS_PRICE),
    mockStakedTokens: 0,
    mockPriceUsd: TEST_GENESIS_PRICE,
  });

  assert.equal(ent.tier, 'member');
  assert.equal(ent.proEligibility.eligible, false);
  assert.equal(ent.permissions.canAccessProSignals, false);
});


// ============================================================================
// V1.7: RAW-UNIT PRECISION MEMBERSHIP ENTITLEMENT TESTS
// ============================================================================

const V17_TEST_GENESIS_PRICE = 0.0000164;

const MEMBER_THRESHOLD_RAW = BigInt(
  Math.ceil(
    20 / (V17_TEST_GENESIS_PRICE / Math.pow(10, TOKEN_DECIMALS))
  )
);

const PRO_THRESHOLD_RAW = BigInt(
  Math.ceil(
    250 / (V17_TEST_GENESIS_PRICE / Math.pow(10, TOKEN_DECIMALS))
  )
);

const memberThresholdTokens =
  Number(MEMBER_THRESHOLD_RAW) / Math.pow(10, TOKEN_DECIMALS);

const proThresholdTokens =
  Number(PRO_THRESHOLD_RAW) / Math.pow(10, TOKEN_DECIMALS);

test('V1.7 Fix A [1/4]: Exactly MEMBER_THRESHOLD_RAW qualifies for MEMBER', async () => {
  const ent = await resolveWalletEntitlement(WALLET_A, {
    mockHoldingTokens: memberThresholdTokens,
    mockStakedTokens: 0,
    mockPriceUsd: V17_TEST_GENESIS_PRICE,
  });

  assert.equal(ent.tier, 'member', `Expected MEMBER at exactly ${MEMBER_THRESHOLD_RAW} raw units`);
  assert.equal(ent.memberEligibility.eligible, true);
  assert.equal(ent.permissions.canAccessTerminal, true);
});

test('V1.7 Fix A [2/4]: MEMBER_THRESHOLD_RAW - 1n remains FREE', async () => {
  const belowTokens = Number(MEMBER_THRESHOLD_RAW - 1n) / Math.pow(10, TOKEN_DECIMALS);
  const ent = await resolveWalletEntitlement(WALLET_A, {
    mockHoldingTokens: belowTokens,
    mockStakedTokens: 0,
    mockPriceUsd: V17_TEST_GENESIS_PRICE,
  });

  assert.equal(ent.tier, 'free', `Expected FREE at ${MEMBER_THRESHOLD_RAW - 1n} raw units (one below threshold)`);
  assert.equal(ent.memberEligibility.eligible, false);
  assert.equal(ent.permissions.canAccessTerminal, false);
});

test('V1.7 Fix A [3/4]: Exactly PRO_THRESHOLD_RAW qualifies for PRO', async () => {
  const ent = await resolveWalletEntitlement(WALLET_A, {
    mockHoldingTokens: 0,
    mockStakedTokens: proThresholdTokens,
    mockPriceUsd: V17_TEST_GENESIS_PRICE,
  });

  assert.equal(ent.tier, 'pro', `Expected PRO at exactly ${PRO_THRESHOLD_RAW} raw staked units`);
  assert.equal(ent.proEligibility.eligible, true);
  assert.equal(ent.permissions.canAccessProSignals, true);
});

test('V1.7 Fix A [4/4]: PRO_THRESHOLD_RAW - 1n does not qualify for PRO', async () => {
  const belowTokens = Number(PRO_THRESHOLD_RAW - 1n) / Math.pow(10, TOKEN_DECIMALS);
  const ent = await resolveWalletEntitlement(WALLET_A, {
    mockHoldingTokens: 0,
    mockStakedTokens: belowTokens,
    mockPriceUsd: V17_TEST_GENESIS_PRICE,
  });

  assert.notEqual(ent.tier, 'pro', `Expected NOT PRO at ${PRO_THRESHOLD_RAW - 1n} raw staked units (one below threshold)`);
  assert.equal(ent.proEligibility.eligible, false);
  assert.equal(ent.permissions.canAccessProSignals, false);
});

test('V1.7 Fix A [5/5]: Oracle unavailability does not grant new access', async () => {
  const ent = await resolveWalletEntitlement(WALLET_A, {
    mockHoldingTokens: memberThresholdTokens * 100,
    mockStakedTokens: proThresholdTokens * 100,
    mockPriceUsd: 0,
  });

  assert.equal(ent.tier, 'unknown');
  assert.equal(ent.memberEligibility.eligible, false);
  assert.equal(ent.proEligibility.eligible, false);
});
