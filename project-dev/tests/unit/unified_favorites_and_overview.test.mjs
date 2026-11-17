import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomShim } from './helpers/dom-shim.mjs';

const dom = installDomShim();
globalThis.self = globalThis;
globalThis.requestIdleCallback = (cb) => setTimeout(cb, 1);
globalThis.cancelIdleCallback = (id) => clearTimeout(id);

const React = await import('react');
const ReactDOMClient = await import('react-dom/client');
const { act } = await import('react');

const { MyPinnedPosts } = await import('../../src/components/dashboard/MyPinnedPosts.tsx');
const { UserCallHistoryPanel } = await import('../../src/components/dashboard/UserCallHistoryPanel.tsx');
const { DashboardOverview } = await import('../../src/components/dashboard/DashboardOverview.tsx');
const { CampaignCard } = await import('../../src/components/campaigns/CampaignCard.tsx');
const { GenesisContext } = await import('../../src/context/GenesisContext.tsx');
const { WalletContext, makeMockWalletContext, makeMockGenesisContext } = await import('./helpers/campaign_card_harness.tsx');

async function renderComponent(ui) {
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  let root;
  await act(async () => {
    root = ReactDOMClient.createRoot(container);
    root.render(ui);
  });
  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
  };
}

const sampleAlphas = [
  {
    id: 'alpha-1',
    name: 'Trench Runner',
    ticker: '$TRUN',
    chain: 'SOL',
    ca: 'So11111111111111111111111111111111111111112',
    marketCap: '$420K',
    marketCapUsd: 420000,
    entryMarketCap: '$180K',
    risk: 3,
    riskRewardRatio: '3.0:1',
    stopLoss: '-25% SL',
    takeProfits: [{ label: '2x', hit: true }],
    pinned: false,
    callType: 'ALPHA',
    isMaxAlpha: false,
    category: 'MOVERS',
    caller: 'TrenchDesk',
    age: '15m',
    ageMinutes: 15,
    art: 'pill',
    change24hPct: 120,
    volume24hUsd: 100000,
  },
  {
    id: 'max-1',
    name: 'Vault Apex',
    ticker: '$APEX',
    chain: 'BASE',
    ca: '0x1234567890abcdef1234567890abcdef12345678',
    marketCap: '$2.4M',
    marketCapUsd: 2400000,
    entryMarketCap: '$900K',
    risk: 2,
    riskRewardRatio: '4.5:1',
    stopLoss: '-20% SL',
    takeProfits: [{ label: '3x', hit: false }],
    pinned: true,
    callType: 'MAX_ALPHA',
    isMaxAlpha: true,
    minTier: 'PRO',
    category: 'AI_AGENT',
    caller: 'Syndicate Lead',
    age: '22m',
    ageMinutes: 22,
    art: 'bull',
    change24hPct: 240,
    volume24hUsd: 450000,
  },
];

const sampleCampaigns = [
  {
    id: 'raid-1',
    title: 'Solana Genesis Raid Sprint',
    description: 'Retweet and reply to boost community visibility.',
    tweetUrl: 'https://x.com/trenchlabs/status/1',
    rewardAmount: '5000 $H42',
    status: 'ACTIVE',
    createdAt: '2026-11-10T00:00:00.000Z',
  },
];

const getPinnedItems = (container) =>
  Array.from(container.querySelectorAll('div')).filter((el) =>
    el.getAttribute('data-testid')?.startsWith('pinned-post-item-')
  );

test('MyPinnedPosts displays unified Alpha, Max Alpha & Raid posts for Pro without duplicates and supports filtering & unpinning', async () => {
  const unpinned = [];
  const opened = [];

  const view = await renderComponent(
    React.createElement(MyPinnedPosts, {
      favorites: [
        { id: 'alpha-1', kind: 'ALPHA', createdAt: '2026-11-12T10:00:00.000Z' },
        { id: 'alpha-1', kind: 'ALPHA', createdAt: '2026-11-12T10:01:00.000Z' },
        { id: 'max-1', kind: 'MAX_ALPHA', createdAt: '2026-11-12T11:00:00.000Z' },
        { id: 'raid-1', kind: 'RAID', createdAt: '2026-11-12T12:00:00.000Z' },
      ],
      alphas: sampleAlphas,
      campaigns: sampleCampaigns,
      membershipTier: 'PRO',
      isAdmin: false,
      onOpenAlpha: (coin, dest) => opened.push({ type: 'alpha', id: coin.id, dest }),
      onOpenRaid: (id) => opened.push({ type: 'raid', id }),
      onUnpin: (kind, id) => unpinned.push({ kind, id }),
    })
  );

  try {
    const items = getPinnedItems(view.container);
    assert.equal(items.length, 3, 'Duplicate favorite IDs must be deduplicated cleanly');
    const text = view.container.textContent;
    assert.ok(text.includes('Trench Runner'));
    assert.ok(text.includes('Vault Apex'));
    assert.ok(text.includes('Solana Genesis Raid Sprint'));

    // Filter to RAID only (local filter isolated to My Pinned Posts)
    const raidFilter = view.container.querySelector('[data-testid="pinned-filter-raid"]');
    assert.ok(raidFilter, 'Raid filter button renders');
    await act(async () => {
      raidFilter.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });
    assert.equal(getPinnedItems(view.container).length, 1);
    assert.ok(view.container.textContent.includes('Solana Genesis Raid Sprint'));

    // Reset filter to ALL
    const allFilter = view.container.querySelector('[data-testid="pinned-filter-all"]');
    await act(async () => {
      allFilter.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });

    // Unpin Vault Apex
    const unpinBtn = view.container.querySelector('[data-testid="unpin-post-max-1"]');
    await act(async () => {
      unpinBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });
    assert.deepEqual(unpinned, [{ kind: 'MAX_ALPHA', id: 'max-1' }]);

    // Open Trench Runner
    const alphaItem = view.container.querySelector('[data-testid="pinned-post-item-alpha-1"]');
    await act(async () => {
      alphaItem.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });
    assert.deepEqual(opened, [{ type: 'alpha', id: 'alpha-1', dest: 'ALPHA' }]);
  } finally {
    await view.cleanup();
  }
});

test('MyPinnedPosts enforces Pro and Member entitlement gates on pinned posts', async () => {
  // Member user must NOT see Pro Max Alpha even if ID present in favorites
  const memberView = await renderComponent(
    React.createElement(MyPinnedPosts, {
      favorites: [
        { id: 'alpha-1', kind: 'ALPHA', createdAt: '2026-11-12T10:00:00.000Z' },
        { id: 'max-1', kind: 'MAX_ALPHA', createdAt: '2026-11-12T11:00:00.000Z' },
        { id: 'raid-1', kind: 'RAID', createdAt: '2026-11-12T12:00:00.000Z' },
      ],
      alphas: sampleAlphas,
      campaigns: sampleCampaigns,
      membershipTier: 'MEMBER',
      onOpenAlpha: () => {},
      onOpenRaid: () => {},
      onUnpin: () => {},
    })
  );

  try {
    assert.ok(memberView.container.textContent.includes('Trench Runner'));
    assert.ok(!memberView.container.textContent.includes('Vault Apex'), 'Non-Pro must not view Max Alpha in My Pinned Posts');
    assert.ok(memberView.container.textContent.includes('Solana Genesis Raid Sprint'));
    assert.equal(memberView.container.querySelector('[data-testid="pinned-filter-max_alpha"]'), null);
  } finally {
    await memberView.cleanup();
  }

  // Free user only sees Raid pinned items
  const freeView = await renderComponent(
    React.createElement(MyPinnedPosts, {
      favorites: [
        { id: 'alpha-1', kind: 'ALPHA', createdAt: '2026-11-12T10:00:00.000Z' },
        { id: 'max-1', kind: 'MAX_ALPHA', createdAt: '2026-11-12T11:00:00.000Z' },
        { id: 'raid-1', kind: 'RAID', createdAt: '2026-11-12T12:00:00.000Z' },
      ],
      alphas: sampleAlphas,
      campaigns: sampleCampaigns,
      membershipTier: 'FREE',
      onOpenAlpha: () => {},
      onOpenRaid: () => {},
      onUnpin: () => {},
    })
  );

  try {
    assert.ok(!freeView.container.textContent.includes('Trench Runner'));
    assert.ok(!freeView.container.textContent.includes('Vault Apex'));
    assert.ok(freeView.container.textContent.includes('Solana Genesis Raid Sprint'));
  } finally {
    await freeView.cleanup();
  }
});

test('UserCallHistoryPanel renders personal allocation log and distinct empty state', async () => {
  const emptyView = await renderComponent(
    React.createElement(UserCallHistoryPanel, {
      portfolio: { claimedCount: 0, totalRealizedPnl: '—', history: [] },
      connected: true,
    })
  );
  try {
    assert.ok(emptyView.container.querySelector('[data-testid="user-call-history-empty"]'));
    assert.ok(emptyView.container.textContent.includes('Account Call History'));
  } finally {
    await emptyView.cleanup();
  }

  const populatedView = await renderComponent(
    React.createElement(UserCallHistoryPanel, {
      portfolio: {
        claimedCount: 1,
        totalRealizedPnl: '+14.2 SOL',
        history: [
          {
            ticker: '$TRUN',
            chain: 'SOL',
            size: '2.5 SOL',
            pnl: '+14.2 SOL',
            pnlPositive: true,
            slot: 123,
            claimedAt: '2026-11-12T10:00:00.000Z',
            sig: '5xAbCdEf123456',
          },
        ],
      },
      connected: true,
    })
  );
  try {
    assert.ok(populatedView.container.textContent.includes('$TRUN'));
    assert.ok(populatedView.container.textContent.includes('+14.2 SOL'));
  } finally {
    await populatedView.cleanup();
  }
});

test('DashboardOverview shows conditional action alerts only when unresolved and collapses secondary tools by default', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/ledger')) {
      return { ok: true, status: 200, json: async () => ({ entries: [] }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, current_tier: 'pro', gap_to_pro_usd: 0, thresholds: { pro: { usd_target: 250 } } }),
    };
  };

  // Case 1: Fully verified PRO with Telegram linked -> zero alerts, secondary collapsed initially
  const proView = await renderComponent(
    React.createElement(DashboardOverview, {
      connected: true,
      shortAddress: 'FzFu...7p3e',
      tier: { id: 'PRO' },
      formattedBalance: '15,000,000',
      alphasCount: 5,
      newCallsCount: 2,
      raidsCount: 3,
      isUnlocked: true,
      isVerified: true,
      needsVerification: false,
      telegramConnected: true,
      favorites: [{ id: 'raid-1', kind: 'RAID', createdAt: '2026-11-12T12:00:00.000Z' }],
      alphas: sampleAlphas,
      campaigns: sampleCampaigns,
      portfolio: { claimedCount: 0, totalRealizedPnl: '—', history: [] },
      onCopyGenesisCa: () => {},
      copiedGenesisCa: false,
    })
  );

  try {
    assert.equal(proView.container.querySelector('[data-testid="overview-account-alerts"]'), null, 'Resolved PRO user should see zero action alerts');
    assert.ok(proView.container.querySelector('[data-testid="my-pinned-posts"]'));
    assert.ok(proView.container.querySelector('[data-testid="user-call-history"]'));
    assert.equal(proView.container.querySelector('[data-testid="overview-secondary-content"]'), null, 'Secondary tools must be collapsed by default');

    const toggleBtn = proView.container.querySelector('[data-testid="toggle-secondary-tools"]');
    await act(async () => {
      toggleBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });
    assert.ok(proView.container.querySelector('[data-testid="overview-secondary-content"]'), 'Secondary tools expand on click');
  } finally {
    await proView.cleanup();
  }

  // Case 2: MEMBER with pending Telegram -> shows Upgrade to Pro + Telegram Pending alerts
  const memberAlertView = await renderComponent(
    React.createElement(DashboardOverview, {
      connected: true,
      shortAddress: 'Mem1...2222',
      tier: { id: 'LAB_MEMBER' },
      formattedBalance: '2,000,000',
      alphasCount: 5,
      newCallsCount: 2,
      raidsCount: 3,
      isUnlocked: true,
      isVerified: true,
      needsVerification: false,
      telegramConnected: false,
      onCopyGenesisCa: () => {},
      copiedGenesisCa: false,
    })
  );

  try {
    assert.ok(memberAlertView.container.querySelector('[data-testid="overview-alert-upgrade-pro"]'));
    assert.ok(memberAlertView.container.querySelector('[data-testid="overview-alert-link-telegram"]'));
  } finally {
    await memberAlertView.cleanup();
    globalThis.fetch = origFetch;
  }
});

test('CampaignCard renders user Favourite / Pin button when onToggleFavorite is provided and invokes callback', async () => {
  let clicked = null;
  const view = await renderComponent(
    React.createElement(
      WalletContext.Provider,
      { value: makeMockWalletContext() },
      React.createElement(
        GenesisContext.Provider,
        { value: makeMockGenesisContext() },
        React.createElement(CampaignCard, {
          campaign: sampleCampaigns[0],
          isFavorited: true,
          onToggleFavorite: (id) => {
            clicked = id;
          },
        })
      )
    )
  );

  try {
    const favBtn = view.container.querySelector('[data-testid="favorite-raid-raid-1"]');
    assert.ok(favBtn, 'User favourite button must render on Raid card');
    assert.equal(favBtn.getAttribute('aria-pressed'), 'true');
    await act(async () => {
      favBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });
    assert.equal(clicked, 'raid-1');
  } finally {
    await view.cleanup();
  }
});
