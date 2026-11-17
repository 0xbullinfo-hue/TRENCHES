import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installDomShim } from './helpers/dom-shim.mjs';

const dom = installDomShim();
globalThis.self = globalThis;
globalThis.requestIdleCallback = (cb) => setTimeout(cb, 1);
globalThis.cancelIdleCallback = (id) => clearTimeout(id);

if (!globalThis.fetch) {
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({}),
  });
}

const React = await import('react');
const ReactDOMClient = await import('react-dom/client');
const { act } = await import('react');

const { readWorkspaceFromSearch, workspaceHref } = await import(
  '../../src/components/dashboard/DashboardNavigationContext.tsx'
);
const { DashboardSidebar } = await import(
  '../../src/components/dashboard/DashboardSidebar.tsx'
);
const { DashboardOverview } = await import(
  '../../src/components/dashboard/DashboardOverview.tsx'
);

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

test('DashboardNavigationContext: readWorkspaceFromSearch & workspaceHref handle all workspaces', () => {
  assert.equal(readWorkspaceFromSearch(''), 'OVERVIEW');
  assert.equal(readWorkspaceFromSearch('?tab=unknown'), 'OVERVIEW');
  assert.equal(readWorkspaceFromSearch('?tab=alpha'), 'ALPHA');
  assert.equal(readWorkspaceFromSearch('?tab=MAX_ALPHA'), 'MAX_ALPHA');
  assert.equal(readWorkspaceFromSearch('?tab=WATCHLIST'), 'WATCHLIST');
  assert.equal(readWorkspaceFromSearch('?tab=SOCIAL'), 'SOCIAL');
  assert.equal(readWorkspaceFromSearch('?tab=stake'), 'STAKE');
  assert.equal(readWorkspaceFromSearch('?tab=admin'), 'ADMIN');

  assert.equal(workspaceHref('OVERVIEW'), '/dashboard');
  assert.equal(workspaceHref('ALPHA'), '/dashboard?tab=ALPHA');
  assert.equal(workspaceHref('MAX_ALPHA'), '/dashboard?tab=MAX_ALPHA');
  assert.equal(workspaceHref('WATCHLIST'), '/dashboard?tab=WATCHLIST');
  assert.equal(workspaceHref('SOCIAL'), '/dashboard?tab=SOCIAL');
  assert.equal(workspaceHref('STAKE'), '/dashboard?tab=STAKE');
  assert.equal(workspaceHref('ADMIN'), '/dashboard?tab=ADMIN');
});

test('DashboardSidebar renders all 6 workspaces, active state, counts, and collapse toggle', async () => {
  const selected = [];
  const view = await renderComponent(
    React.createElement(DashboardSidebar, {
      active: 'ALPHA',
      onSelect: (ws) => selected.push(ws),
      itemState: {
        ALPHA: { count: 7, locked: false },
        MAX_ALPHA: { locked: true },
        WATCHLIST: { count: 2, locked: false },
        SOCIAL: { count: 4 },
      },
    })
  );

  try {
    const expectedIds = ['tab-overview', 'tab-alpha', 'tab-max-alpha', 'tab-watchlist', 'tab-social', 'tab-stake'];
    for (const id of expectedIds) {
      assert.ok(view.container.querySelector(`[data-testid="${id}"]`), `Missing sidebar item ${id}`);
    }
    assert.equal(view.container.querySelector('[data-testid="tab-admin"]'), null, 'Non-admin must not see Admin sidebar item');

    const adminView = await renderComponent(
      React.createElement(DashboardSidebar, {
        active: 'ADMIN',
        isAdmin: true,
        onSelect: () => { },
      })
    );
    try {
      assert.ok(adminView.container.querySelector('[data-testid="tab-admin"]'), 'Admin must see Admin sidebar item');
    } finally {
      await adminView.cleanup();
    }

    const activeBtn = view.container.querySelector('[data-testid="tab-alpha"]');
    assert.equal(activeBtn.getAttribute('aria-current'), 'page');

    const raidBtn = view.container.querySelector('[data-testid="tab-social"]');
    await act(async () => {
      raidBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });
    assert.deepEqual(selected, ['SOCIAL']);

    const stakeBtn = view.container.querySelector('[data-testid="tab-stake"]');
    await act(async () => {
      stakeBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });
    assert.deepEqual(selected, ['SOCIAL', 'STAKE']);

    const collapseBtn = view.container.querySelector('[data-testid="sidebar-collapse-toggle"]');
    assert.ok(collapseBtn, 'Desktop collapse toggle must exist');
    assert.equal(collapseBtn.getAttribute('aria-expanded'), 'true');
    await act(async () => {
      collapseBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });
    assert.equal(collapseBtn.getAttribute('aria-expanded'), 'false');
  } finally {
    await view.cleanup();
  }
});

test('DashboardOverview preserves account telemetry, token actions, Pro progress, digest, and activity shortcuts', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/ledger')) {
      return { ok: true, status: 200, json: async () => ({ entries: [] }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        current_tier: 'member',
        gap_to_pro_usd: 150,
        thresholds: { pro: { usd_target: 250 } },
      }),
    };
  };

  const tabCalls = [];
  const filterCalls = [];
  let copied = false;

  const view = await renderComponent(
    React.createElement(DashboardOverview, {
      connected: true,
      shortAddress: 'FzFu...7p3e',
      tier: { id: 'LAB_MEMBER' },
      formattedBalance: '1,250,000',
      alphasCount: 12,
      newCallsCount: 3,
      raidsCount: 2,
      watchlistCount: 4,
      isUnlocked: true,
      onCopyGenesisCa: () => {
        copied = true;
      },
      copiedGenesisCa: false,
      onSelectTab: (tab) => tabCalls.push(tab),
      onSelectFilter: (f) => filterCalls.push(f),
    })
  );

  try {
    const text = view.container.textContent;
    assert.ok(text.includes('Welcome to the Lab'));
    assert.ok(text.includes('MEMBER TIER'));
    assert.ok(text.includes('FzFu...7p3e'));
    assert.ok(text.includes('1,250,000 $H42'));
    assert.ok(text.includes('Unlocked (Standard Calls)'));
    assert.ok(text.includes('Copy $H42 CA'));
    assert.ok(text.includes('Buy $H42'));
    assert.ok(text.includes('ACTIVE CALLS'));
    assert.ok(text.includes('NEW CALLS'));
    assert.ok(text.includes('ACTIVE RAIDS'));
    assert.ok(text.includes('SAVED WATCHLIST'));
    assert.ok(view.container.querySelector('[data-testid="pro-progress-bar"]'));
    assert.ok(view.container.querySelector('[data-testid="weekly-performance-digest"]'));

    const buttons = Array.from(view.container.querySelectorAll('button'));
    const copyBtn = buttons.find((b) => b.textContent.includes('Copy $H42 CA'));
    await act(async () => {
      copyBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });
    assert.equal(copied, true);

    const activeCallsShortcut = buttons.find((b) => b.textContent.includes('ACTIVE CALLS'));
    await act(async () => {
      activeCallsShortcut.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });
    assert.deepEqual(tabCalls, ['ALPHA']);
    assert.deepEqual(filterCalls, ['all']);
  } finally {
    await view.cleanup();
    globalThis.fetch = origFetch;
  }
});

test('Architecture constraints: Watchlist saved-IDs only, dedicated Admin workspace, isolated filters, no duplicate Staking card', () => {
  const hubSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/dashboard/IncubatorHub.tsx'),
    'utf-8'
  );
  assert.ok(
    hubSrc.includes('watchlist.includes(a.id)') && !hubSrc.includes('watchlistMode'),
    'Watchlist workspace must resolve strictly from personal watchlist.includes(a.id), not a fake platform feed mode'
  );
  assert.ok(
    /a\.callType === 'MAX_ALPHA'\s*\|\|\s*Boolean\(a\.isMaxAlpha\)/.test(hubSrc),
    'Max Alpha workspace must preserve existing isMaxAlpha / callType classification'
  );
  assert.ok(
    !hubSrc.includes('MASTER ADMIN DESK') && hubSrc.includes('<AdminWorkspace'),
    'Admin publishing must live exclusively in dedicated AdminWorkspace'
  );
  assert.ok(
    hubSrc.includes('filtersByWorkspace') && hubSrc.includes('<WorkspaceFilterBar'),
    'IncubatorHub must isolate filters per workspace via filtersByWorkspace and WorkspaceFilterBar'
  );
  const stakingOccurrences = hubSrc.match(/<DashboardStakingCard/g) || [];
  assert.equal(
    stakingOccurrences.length,
    1,
    'DashboardStakingCard must appear once in STAKE workspace only (no duplicate in Overview)'
  );
});
