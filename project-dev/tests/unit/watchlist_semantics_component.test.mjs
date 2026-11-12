import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installDomShim } from './helpers/dom-shim.mjs';

const dom = installDomShim();

const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { GenesisContext } = await import('../../src/context/GenesisContext.tsx');
const { AlphaCallCard } = await import('../../src/components/dashboard/AlphaCallCard.tsx');
const { AlphaInspectorModal } = await import('../../src/components/dashboard/AlphaInspectorModal.tsx');

function makeItem(overrides = {}) {
  return {
    id: 'tok-1',
    serialTag: 'EXP99',
    ticker: '$TEST',
    name: 'Test Token',
    chain: 'SOL',
    ca: 'So11111111111111111111111111111111111111112',
    callType: 'WATCHLIST',
    outcome: 'PROFIT',
    maxAlpha: false,
    entryMarketCap: '$120K',
    marketCap: '$450K',
    volume24h: '$250K',
    priceChange24h: 18.5,
    risk: 3,
    riskRewardRatio: '1:5',
    stopLoss: '$80K',
    summary: 'Early ecosystem accumulation and developer activity.',
    takeProfits: [
      { label: '$300K', hit: true },
      { label: '$600K', hit: false },
      { label: '$1.2M', hit: false },
    ],
    art: {
      imageUrl: '',
      palette: ['#22c55e', '#111827'],
      badge: 'EXP99',
    },
    highlights: ['Strong dev activity'],
    links: [{ label: 'DexScreener', href: 'https://dexscreener.com/solana/So111' }],
    marketData: {
      imageUrl: '',
      marketCap: 450000,
      volume24h: 250000,
      priceChange24h: 18.5,
      updatedAt: Date.now(),
    },
    rationale: 'Early ecosystem accumulation and developer activity.',
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeGenesisValue({ isAdmin = false } = {}) {
  return {
    balance: 10000,
    stakedBalance: 0,
    totalPower: 10000,
    tier: 'PRO',
    isMember: true,
    isPro: true,
    isAdmin,
    loading: false,
    isDemoMode: false,
    authStatus: 'authenticated',
    refreshBalance: async () => {},
    alphas: [],
    alphasLoading: false,
    watchlist: [],
    toggleWatchlist: () => {},
    addAlpha: async () => {},
    updateAlpha: async () => {},
    deleteAlpha: async () => {},
    toggleTpHit: async () => {},
    togglePinAlpha: async () => {},
    toggleMaxAlpha: async () => {},
    setAlphaOutcome: async () => {},
    resetToDefaults: () => {},
    campaigns: [],
    campaignsLoading: false,
    refreshCampaigns: async () => {},
    submitCampaignProof: async () => ({ ok: true }),
    verifyAdminAction: async () => ({}),
    walletAuthSession: {
      authenticated: true,
      wallet: '11111111111111111111111111111111',
      checkedAt: Date.now(),
    },
    ensureWalletSession: async () => true,
  };
}

async function renderNode(element) {
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  let root;
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
  return {
    container,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
  };
}

test('V1.4 Watchlist [1/5]: AlphaCallCard renders WATCHLIST as research without trading call fields', async () => {
  let toggledId = null;
  const coin = makeItem({ callType: 'WATCHLIST', outcome: 'PROFIT' });
  const mounted = await renderNode(
    React.createElement(AlphaCallCard, {
      coin,
      isAdmin: true,
      isStarred: false,
      onToggleWatchlist: (id) => {
        toggledId = id;
      },
      onSetOutcome: () => {},
    })
  );

  try {
    const text = mounted.container.textContent;
    assert.ok(text.includes('RESEARCH'));
    assert.ok(text.includes('CURRENT MC'));
    assert.ok(text.includes('$450K'));
    assert.ok(!text.includes('ENTRY MC'));
    assert.ok(!text.includes('RISK RATIO'));
    assert.ok(!text.includes('STOP LOSS'));
    assert.ok(!text.includes('TARGET TP'));
    assert.ok(!text.includes('PROFIT ✓'));
    assert.ok(!text.includes('LOSS ✕'));

    const starBtn = Array.from(mounted.container.querySelectorAll('button')).find((b) =>
      (b.getAttribute('title') || '').includes('Watchlist')
    );
    assert.ok(starBtn, 'Personal watchlist star button should remain available');
    await act(async () => {
      starBtn.click();
    });
    assert.equal(toggledId, 'tok-1');
  } finally {
    await mounted.unmount();
  }
});

test('V1.4 Watchlist [2/5]: AlphaCallCard renders ALPHA with full trading fields and outcome badge', async () => {
  const coin = makeItem({ callType: 'ALPHA', outcome: 'PROFIT' });
  const mounted = await renderNode(
    React.createElement(AlphaCallCard, {
      coin,
      isAdmin: false,
      isStarred: false,
    })
  );

  try {
    const text = mounted.container.textContent;
    assert.ok(text.includes('PROFIT ✓'));
    assert.ok(text.includes('ENTRY MC'));
    assert.ok(text.includes('RISK RATIO'));
    assert.ok(text.includes('STOP LOSS'));
    assert.ok(text.includes('TARGET TP'));
  } finally {
    await mounted.unmount();
  }
});

test('V1.4 Watchlist [3/5]: AlphaInspectorModal hides trade targets and admin outcome controls for WATCHLIST', async () => {
  const token = makeItem({ callType: 'WATCHLIST', outcome: 'PROFIT', maxAlpha: true });
  const mounted = await renderNode(
    React.createElement(
      GenesisContext.Provider,
      { value: makeGenesisValue({ isAdmin: true }) },
      React.createElement(AlphaInspectorModal, {
        token,
        onClose: () => {},
        onEdit: () => {},
      })
    )
  );

  try {
    const text = mounted.container.textContent;
    assert.ok(text.includes('WATCHLIST · RESEARCH'));
    assert.ok(text.includes('CURRENT MC'));
    assert.ok(text.includes('CURRENT MARKET CAP'));
    assert.ok(text.includes('RESEARCH CLASSIFICATION'));
    assert.ok(text.includes('Platform Watchlist'));
    assert.ok(!text.includes('ENTRY MARKET CAP'));
    assert.ok(!text.includes('RISK RATIO'));
    assert.ok(!text.includes('STOP LOSS'));
    assert.ok(!text.includes('TAKE PROFIT TARGETS'));
    assert.ok(!text.includes('✓ Achieved (Profit)'));
    assert.ok(!text.includes('ACHIEVED'));
  } finally {
    await mounted.unmount();
  }
});

test('V1.4 Watchlist [4/5]: AlphaInspectorModal shows trade targets and admin outcome controls for ALPHA', async () => {
  const token = makeItem({ callType: 'ALPHA', outcome: 'PROFIT' });
  const mounted = await renderNode(
    React.createElement(
      GenesisContext.Provider,
      { value: makeGenesisValue({ isAdmin: true }) },
      React.createElement(AlphaInspectorModal, {
        token,
        onClose: () => {},
        onEdit: () => {},
      })
    )
  );

  try {
    const text = mounted.container.textContent;
    assert.ok(text.includes('ENTRY MARKET CAP'));
    assert.ok(text.includes('RISK RATIO'));
    assert.ok(text.includes('Risk Level'));
    assert.ok(text.includes('TAKE PROFIT TARGETS'));
    assert.ok(text.includes('Max Alpha'));
    assert.ok(text.includes('✓ Achieved (Profit)'));
  } finally {
    await mounted.unmount();
  }
});

test('V1.4 Watchlist [5/5]: IncubatorHub excludes WATCHLIST from topWinningCoins, clarifies Admin selection, and adapts table view', () => {
  const hubSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/dashboard/IncubatorHub.tsx'),
    'utf8'
  );
  assert.ok(
    hubSource.includes("a.callType !== 'WATCHLIST'"),
    'topWinningCoins must exclude WATCHLIST items'
  );
  assert.ok(
    hubSource.includes("aria-pressed={formCallType === 'WATCHLIST'}"),
    'Admin Alpha Desk WATCHLIST button must expose aria-pressed selection state'
  );
  assert.ok(
    hubSource.includes('SELECTED · PRO'),
    'Admin Alpha Desk WATCHLIST button must clearly indicate active selection'
  );
  assert.ok(
    hubSource.includes("currentTab !== 'WATCHLIST'") &&
      hubSource.includes("const isRowWatchlist = token.callType === 'WATCHLIST'"),
    'Table view must omit trading columns on WATCHLIST tab'
  );
});
