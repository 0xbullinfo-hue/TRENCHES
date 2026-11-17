import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installDomShim } from './helpers/dom-shim.mjs';

const dom = installDomShim();
globalThis.self = globalThis;
globalThis.requestIdleCallback = (cb) => setTimeout(cb, 1);
globalThis.cancelIdleCallback = (id) => clearTimeout(id);

const React = await import('react');
const ReactDOMClient = await import('react-dom/client');
const { act } = await import('react');

const { TelegramVerificationCard } = await import(
  '../../src/components/telegram/TelegramVerificationCard.tsx'
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
  await act(async () => {
    await new Promise((r) => setTimeout(r, 25));
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

test('Section 21.1: Sidebar and dashboard UI expose "Lab Analysis" instead of "Lab Terminal"', async () => {
  const sidebarSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/dashboard/DashboardSidebar.tsx'),
    'utf-8'
  );
  assert.ok(!sidebarSrc.includes('Lab Terminal'), 'Lab Terminal must not remain in DashboardSidebar');
  assert.ok(sidebarSrc.includes('Lab Analysis'), 'DashboardSidebar must display Lab Analysis');

  const view = await renderComponent(
    React.createElement(DashboardSidebar, {
      active: 'OVERVIEW',
      onSelect: () => {},
    })
  );
  try {
    const text = view.container.textContent;
    assert.ok(text.includes('Lab Analysis'));
    assert.ok(!text.includes('Lab Terminal'));
  } finally {
    await view.cleanup();
  }
});

test('Section 21.2 & 21.3: DashboardOverview always renders TelegramVerificationCard in Connected Services without expanding accordion', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/verification/status')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          wallet: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
          tier: 'pro',
          telegram: { connected: false, connected_tier: null, connected_at: null },
          can_connect: true,
          target_tier: 'pro',
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const view = await renderComponent(
    React.createElement(DashboardOverview, {
      connected: true,
      walletAddress: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
      shortAddress: 'FzFu...7p3e',
      tier: { id: 'PRO' },
      formattedBalance: '5,000,000',
      alphasCount: 3,
      newCallsCount: 1,
      raidsCount: 2,
      isUnlocked: true,
      isVerified: true,
      needsVerification: false,
      onCopyGenesisCa: () => {},
      copiedGenesisCa: false,
    })
  );

  try {
    assert.ok(view.container.querySelector('[data-testid="overview-connected-services"]'));
    assert.ok(view.container.querySelector('[data-testid="telegram-verification-card"]'));
    assert.equal(view.container.querySelector('[data-testid="overview-secondary-content"]'), null);
  } finally {
    await view.cleanup();
    globalThis.fetch = origFetch;
  }
});

test('Section 21.5 State 1 & 2: Telegram not connected -> initiate verification pending -> transitions on backend verified confirmation', async () => {
  const origFetch = globalThis.fetch;
  let step = 'not_connected';
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/api/verification/status')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          wallet: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
          tier: 'pro',
          telegram: {
            connected: step === 'verified',
            connected_tier: step === 'verified' ? 'pro' : null,
            connected_at: step === 'verified' ? '2026-11-17T10:00:00.000Z' : null,
          },
          can_connect: true,
          target_tier: step === 'verified' ? null : 'pro',
        }),
      };
    }
    if (u.includes('/api/verification/session') && (init.method || 'GET').toUpperCase() === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 'vs1234567890',
          deep_link: 'https://t.me/Trenchlabs_bot?start=vs_vs1234567890',
          already_in_group: false,
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const view = await renderComponent(
    React.createElement(TelegramVerificationCard, {
      connected: true,
      isPro: true,
      isVerified: true,
      needsVerification: false,
      walletAddress: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
    })
  );

  try {
    // State 1: Not connected
    assert.equal(
      view.container.querySelector('[data-testid="telegram-verification-status-badge"]').textContent,
      'NOT CONNECTED'
    );
    const connectBtn = view.container.querySelector('[data-testid="telegram-connect-btn"]');
    assert.ok(connectBtn, 'Connect Telegram action must be visible');
    assert.ok(view.container.querySelector('[data-testid="tg-row-entitlement"]')?.textContent.includes('PRO — Verified'));
    assert.ok(view.container.querySelector('[data-testid="tg-row-identity"]')?.textContent.includes('Not Connected'));
    assert.ok(view.container.querySelector('[data-testid="tg-row-community"]')?.textContent.includes('Not Joined'));
    assert.ok(view.container.querySelector('[data-testid="tg-row-notifications"]')?.textContent.includes('Disabled'));

    // Click -> State 2: Pending verification
    await act(async () => {
      connectBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.equal(
      view.container.querySelector('[data-testid="telegram-verification-status-badge"]').textContent,
      'VERIFICATION PENDING'
    );
    const deepLink = view.container.querySelector('[data-testid="telegram-deeplink-anchor"]');
    assert.ok(deepLink && deepLink.getAttribute('href').includes('vs_vs1234567890'));

    // Backend confirms verification -> Check Status -> State 3: Verified
    step = 'verified';
    const checkBtn = view.container.querySelector('[data-testid="telegram-check-status-btn"]');
    await act(async () => {
      checkBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.equal(
      view.container.querySelector('[data-testid="telegram-verification-status-badge"]').textContent,
      'VERIFIED'
    );
    assert.ok(view.container.querySelector('[data-testid="telegram-verified-state"]'));
    assert.ok(view.container.querySelector('[data-testid="tg-row-community"]')?.textContent.includes('Pro Community — Joined'));
    assert.equal(view.container.querySelector('[data-testid="telegram-connect-btn"]'), null);
  } finally {
    await view.cleanup();
    globalThis.fetch = origFetch;
  }
});

test('Section 21.5 State 4 & 5: Verification errors never fake success, and disconnected/unauthenticated states prompt accurately', async () => {
  // Disconnected state
  const discView = await renderComponent(
    React.createElement(TelegramVerificationCard, {
      connected: false,
      isPro: false,
      walletAddress: null,
    })
  );
  try {
    assert.equal(
      discView.container.querySelector('[data-testid="telegram-verification-status-badge"]').textContent,
      'DISCONNECTED'
    );
    assert.ok(discView.container.querySelector('[data-testid="telegram-disconnected-state"]'));
  } finally {
    await discView.cleanup();
  }

  // Unauthenticated / signature required (backend returns 401)
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: 'unauthorized', message: 'Session required' }),
  });

  const unauthView = await renderComponent(
    React.createElement(TelegramVerificationCard, {
      connected: true,
      isPro: false,
      isVerified: false,
      needsVerification: false,
      walletAddress: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
      onVerifyWallet: () => {},
    })
  );
  try {
    assert.equal(
      unauthView.container.querySelector('[data-testid="telegram-verification-status-badge"]').textContent,
      'SIGNATURE REQUIRED'
    );
    assert.ok(unauthView.container.querySelector('[data-testid="telegram-unauthenticated-state"]'));
  } finally {
    await unauthView.cleanup();
  }

  // Backend request failure (500 status OR POST /session error) -> shows error banner & never VERIFIED
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/api/verification/status')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          wallet: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
          tier: 'member',
          telegram: { connected: false, connected_tier: null, connected_at: null },
          can_connect: true,
          target_tier: 'member',
        }),
      };
    }
    if ((init.method || 'GET').toUpperCase() === 'POST') {
      return {
        ok: false,
        status: 429,
        json: async () => ({ error: 'too_many_requests', message: 'Too many attempts — wait a minute.' }),
      };
    }
    return { ok: false, status: 500, json: async () => ({ message: 'Server error' }) };
  };

  const errView = await renderComponent(
    React.createElement(TelegramVerificationCard, {
      connected: true,
      isPro: false,
      isVerified: true,
      needsVerification: false,
      walletAddress: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
    })
  );
  try {
    const btn = errView.container.querySelector('[data-testid="telegram-connect-btn"]');
    await act(async () => {
      btn.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const alertBox = errView.container.querySelector('[data-testid="telegram-verify-error"]');
    assert.ok(alertBox, 'Failure alert must display on failed session creation');
    assert.ok(alertBox.textContent.includes('Too many attempts'));
    assert.notEqual(
      errView.container.querySelector('[data-testid="telegram-verification-status-badge"]').textContent,
      'VERIFIED'
    );
  } finally {
    await errView.cleanup();
    globalThis.fetch = origFetch;
  }
});

test('Section 14: Unknown entitlement renders Temporarily Unavailable + Retry, and joined Member shows 4 independent states without Join button or Pro controls', async () => {
  const origFetch = globalThis.fetch;

  // 1. Unknown entitlement state
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/verification/status')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          entitlement: { tier: 'unknown', verified: false, checkedAt: null },
          telegram: {
            identity: { status: 'connected' },
            community: { tier: null, status: 'not_joined', joinedAt: null },
            notifications: { status: 'disabled' },
            connected: false,
            connected_tier: null,
            connected_at: null,
          },
          actions: { canConnect: false, canJoinCommunity: false, canEnableNotifications: false },
          wallet: 'MemberWallet11111111111111111111111111111111',
          tier: 'unknown',
          can_connect: false,
          target_tier: null,
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const unknownView = await renderComponent(
    React.createElement(TelegramVerificationCard, {
      connected: true,
      isVerified: true,
      needsVerification: false,
      walletAddress: 'MemberWallet11111111111111111111111111111111',
    })
  );
  try {
    assert.equal(
      unknownView.container.querySelector('[data-testid="telegram-verification-status-badge"]').textContent,
      'RECHECK REQUIRED'
    );
    assert.ok(unknownView.container.querySelector('[data-testid="tg-row-entitlement"]').textContent.includes('Temporarily Unavailable'));
    assert.ok(unknownView.container.querySelector('[data-testid="tg-row-community"]').textContent.includes('Status Requires Recheck'));
    assert.ok(unknownView.container.querySelector('[data-testid="telegram-retry-btn"]'));
    assert.equal(unknownView.container.querySelector('[data-testid="telegram-connect-btn"]'), null);
  } finally {
    await unknownView.cleanup();
  }

  // 2. Joined Member with Notifications Disabled -> toggle notifications without showing Pro or Join button
  let notifEnabled = false;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/api/verification/status')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          entitlement: { tier: 'member', verified: true, checkedAt: '2026-11-17T10:00:00.000Z' },
          telegram: {
            identity: { status: 'connected' },
            community: { tier: 'member', status: 'joined', joinedAt: '2026-11-17T10:00:00.000Z' },
            notifications: { status: notifEnabled ? 'enabled' : 'disabled' },
            connected: true,
            connected_tier: 'member',
            connected_at: '2026-11-17T10:00:00.000Z',
          },
          actions: { canConnect: false, canJoinCommunity: false, canEnableNotifications: true },
          wallet: 'MemberWallet11111111111111111111111111111111',
          tier: 'member',
          can_connect: true,
          target_tier: null,
        }),
      };
    }
    if (u.includes('/api/verification/notifications') && (init.method || 'GET').toUpperCase() === 'POST') {
      notifEnabled = true;
      return { ok: true, status: 200, json: async () => ({ ok: true, status: 'enabled' }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const memberView = await renderComponent(
    React.createElement(TelegramVerificationCard, {
      connected: true,
      isPro: false,
      isVerified: true,
      needsVerification: false,
      walletAddress: 'MemberWallet11111111111111111111111111111111',
    })
  );
  try {
    assert.ok(memberView.container.querySelector('[data-testid="tg-row-entitlement"]').textContent.includes('MEMBER — Verified'));
    assert.ok(memberView.container.querySelector('[data-testid="tg-row-identity"]').textContent.includes('Connected'));
    assert.ok(memberView.container.querySelector('[data-testid="tg-row-community"]').textContent.includes('Member Community — Joined'));
    assert.ok(memberView.container.querySelector('[data-testid="tg-row-notifications"]').textContent.includes('Disabled'));
    assert.ok(!memberView.container.textContent.includes('Pro Community'));
    assert.equal(memberView.container.querySelector('[data-testid="telegram-connect-btn"]'), null);

    const toggleBtn = memberView.container.querySelector('[data-testid="tg-toggle-notifications-btn"]');
    assert.ok(toggleBtn);
    await act(async () => {
      toggleBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.ok(memberView.container.querySelector('[data-testid="tg-row-notifications"]').textContent.includes('Enabled'));
  } finally {
    await memberView.cleanup();
    globalThis.fetch = origFetch;
  }
});
