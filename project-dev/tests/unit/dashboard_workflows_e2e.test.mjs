import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomShim } from './helpers/dom-shim.mjs';

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

test('V1.5 Workflow 1 [2/6]: >= $20 liquid $GENESIS -> MEMBER only (not PRO)', async () => {
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
