import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { installDomShim } from './helpers/dom-shim.mjs';

process.env.NODE_ENV = 'test';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const dom = installDomShim();
globalThis.self = globalThis;
globalThis.requestIdleCallback = (cb) => setTimeout(cb, 1);
globalThis.cancelIdleCallback = (id) => clearTimeout(id);

const React = await import('react');
const ReactDOMClient = await import('react-dom/client');
const { act } = await import('react');

const { roles } = await import('../../src/lib/theme/roles.ts');
const { resolveUserState, stateMeta } = await import('../../src/lib/state/resolveUserState.ts');
const {
  TokenPrice,
  TokenAmount,
  UsdAmount,
  PnlPercent,
  WalletAddress,
  CountValue,
  PercentValue,
  MetricText,
} = await import('../../src/components/primitives/formats.tsx');
const { NextStepCard, TelegramCountdown } = await import(
  '../../src/components/dashboard/NextStepCard.tsx'
);
const { TrustStrip } = await import('../../src/components/trust/TrustStrip.tsx');
const { NextStepCardSkeleton } = await import(
  '../../src/components/dashboard/skeletons/NextStepCardSkeleton.tsx'
);
const { TrustStripSkeleton } = await import(
  '../../src/components/dashboard/skeletons/TrustStripSkeleton.tsx'
);
const { SignalsGridSkeleton } = await import(
  '../../src/components/dashboard/skeletons/SignalsGridSkeleton.tsx'
);
const { StakeFormSkeleton } = await import(
  '../../src/components/dashboard/skeletons/StakeFormSkeleton.tsx'
);
const { TelegramBannerSkeleton } = await import(
  '../../src/components/dashboard/skeletons/TelegramBannerSkeleton.tsx'
);
const { resolveSequenceRoute } = await import('../../src/hooks/useHotkeys.ts');
const { TelegramVerificationCard } = await import(
  '../../src/components/telegram/TelegramVerificationCard.tsx'
);
const { GET: shareImageGet } = await import(
  '../../src/app/api/signals/[id]/share-image/route.tsx'
);
const { createLedgerEntry, deleteLedgerEntry } = await import('../../src/server/db.ts');

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
    async cleanup() {
      await act(async () => {
        root.unmount();
      });
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
  };
}

const baseState = {
  connected: true,
  needsSignature: false,
  hasActiveSession: true,
  tier: 'free',
  telegramConnected: false,
  stakeUsd: 0,
};

test('resolveUserState handles all 12 onboarding transitions and uses $H42 branding without # links', () => {
  assert.equal(resolveUserState({ ...baseState, connected: false }), 'disconnected');
  assert.equal(resolveUserState({ ...baseState, needsSignature: true }), 'wallet_unsigned');
  assert.equal(resolveUserState({ ...baseState, tier: 'unknown' }), 'session_unavailable');
  assert.equal(resolveUserState({ ...baseState, hasActiveSession: false }), 'wallet_unsigned');
  assert.equal(resolveUserState({ ...baseState, tier: 'free', stakeUsd: 0 }), 'no_tokens');
  assert.equal(
    resolveUserState({ ...baseState, tier: 'member', telegramConnected: false }),
    'member_no_telegram'
  );
  assert.equal(
    resolveUserState({ ...baseState, tier: 'member', telegramConnected: true, stakeUsd: 0 }),
    'member_no_stake'
  );
  assert.equal(
    resolveUserState({ ...baseState, tier: 'member', telegramConnected: true, stakeUsd: 100 }),
    'member_partial_stake'
  );
  assert.equal(
    resolveUserState({ ...baseState, tier: 'pro', telegramConnected: false, stakeUsd: 250 }),
    'pro_no_telegram'
  );
  assert.equal(
    resolveUserState({ ...baseState, tier: 'pro', telegramConnected: true, stakeUsd: 250 }),
    'pro_active'
  );
  assert.equal(
    resolveUserState({ ...baseState, tier: 'free', stakeUsd: 250 }),
    'pro_expired'
  );
  assert.equal(
    resolveUserState({ ...baseState, tier: 'unknown', stakeUsd: 0 }),
    'session_unavailable'
  );

  for (const meta of Object.values(stateMeta)) {
    const serialized = `${meta.title} ${meta.subtitle} ${meta.checklist.map((c) => c.label).join(' ')}`;
    assert.equal(serialized.includes('$GENESIS'), false, 'UI copy must use $H42 rather than $GENESIS');
    if (meta.primaryCTA?.href) {
      assert.equal(meta.primaryCTA.href.startsWith('#'), false, 'CTAs must not use dead # href placeholders');
    }
  }
  assert.ok(roles.focusRing.includes('focus-visible'));
});

test('formats, NextStepCard, TrustStrip, and skeletons render cleanly with $H42 formatting', async () => {
  const fmtView = await renderComponent(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(TokenPrice, { value: 250_000n, decimals: 6 }),
      ' | ',
      React.createElement(TokenAmount, { value: 5_000_000n, decimals: 6 }),
      ' | ',
      React.createElement(UsdAmount, { value: 250 }),
      ' | ',
      React.createElement(PnlPercent, { value: 14.25 }),
      ' | ',
      React.createElement(WalletAddress, {
        value: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
      }),
      ' | ',
      React.createElement(CountValue, { value: 42 }),
      ' | ',
      React.createElement(PercentValue, { value: 75 }),
      ' | ',
      React.createElement(MetricText, { value: '$1.4M' })
    )
  );
  assert.ok(fmtView.container.textContent.includes('$0.25'));
  assert.ok(fmtView.container.textContent.includes('5 $H42'));
  assert.ok(fmtView.container.textContent.includes('$250.00'));
  assert.ok(fmtView.container.textContent.includes('+14.25%'));
  assert.ok(fmtView.container.textContent.includes('FzFu…7p3e'));
  assert.ok(fmtView.container.textContent.includes('42'));
  assert.ok(fmtView.container.textContent.includes('75%'));
  assert.ok(fmtView.container.textContent.includes('$1.4M'));
  await fmtView.cleanup();

  let clickedAction = null;
  const nextStepView = await renderComponent(
    React.createElement(NextStepCard, {
      state: 'wallet_unsigned',
      meta: stateMeta.wallet_unsigned,
      onAction: (a) => {
        clickedAction = a;
      },
    })
  );
  const ctaBtn = nextStepView.container.querySelector('button');
  assert.ok(ctaBtn);
  await act(async () => {
    ctaBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
  });
  assert.equal(clickedAction, 'sign');
  await nextStepView.cleanup();

  const countdownView = await renderComponent(
    React.createElement(TelegramCountdown, {
      expiresAt: Date.now() + 90_000,
    })
  );
  assert.ok(countdownView.container.textContent.includes('Invite expires in'));
  await countdownView.cleanup();

  const trustView = await renderComponent(
    React.createElement(TrustStrip, {
      metrics: {
        signalCount: 42,
        winRate: 68,
        expectancy: 1.45,
        profitFactor: 2.3,
        maxDrawdown: 18,
        startDate: 'Nov 2026',
      },
    })
  );
  assert.ok(trustView.container.textContent.includes('42 signals'));
  assert.ok(trustView.container.textContent.includes('68% win'));
  await trustView.cleanup();

  const skelView = await renderComponent(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(NextStepCardSkeleton),
      React.createElement(TrustStripSkeleton),
      React.createElement(SignalsGridSkeleton, { cols: 2, rows: 2 }),
      React.createElement(StakeFormSkeleton),
      React.createElement(TelegramBannerSkeleton)
    )
  );
  assert.ok(skelView.container.querySelectorAll('div[aria-hidden="true"]').length >= 4);
  await skelView.cleanup();
});

test('useHotkeys sequence resolver maps g+d, g+l, g+s inside timing window', () => {
  assert.equal(resolveSequenceRoute({ key: 'g', at: 1000 }, 'd', 1500), '/dashboard');
  assert.equal(resolveSequenceRoute({ key: 'g', at: 1000 }, 'l', 1500), '/ledger');
  assert.equal(resolveSequenceRoute({ key: 'g', at: 1000 }, 's', 1500), '/dashboard/stake');
  assert.equal(resolveSequenceRoute({ key: 'g', at: 1000 }, 'd', 2500), null);
  assert.equal(resolveSequenceRoute({ key: 'x', at: 1000 }, 'd', 1200), null);
});

test('TelegramVerificationCard renders QRCodeSVG and countdown on session initiation', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/api/verification/status')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          wallet: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
          tier: 'member',
          entitlement: { tier: 'member', verified: true },
          telegram: {
            identity_status: 'not_connected',
            community: { status: 'not_joined', required_tier: 'member' },
            notifications: { status: 'disabled', can_enable: false },
          },
          can_connect: true,
          target_tier: 'member',
        }),
      };
    }
    if (u.includes('/api/verification/session') && init?.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 'vs_demo123',
          deep_link: 'https://t.me/Trenchlabs_bot?start=vs_demo123',
          expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
          already_in_group: false,
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const view = await renderComponent(
    React.createElement(TelegramVerificationCard, {
      connected: true,
      needsVerification: false,
      walletAddress: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
    })
  );

  try {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    const connectBtn = view.container.querySelector('[data-testid="telegram-connect-btn"]');
    assert.ok(connectBtn);
    await act(async () => {
      connectBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 40));
    });

    const qrPanel = view.container.querySelector('[data-testid="telegram-qr-panel"]');
    const countdown = view.container.querySelector('[data-testid="telegram-expiry-countdown"]');
    assert.ok(qrPanel, 'QR panel must render for generated Telegram deep link');
    assert.ok(qrPanel.querySelector('svg'), 'QRCodeSVG renders an SVG');
    assert.ok(countdown, 'Countdown renders when expires_at is returned');
    assert.ok(countdown.textContent.includes('Invite expires in'));
  } finally {
    await view.cleanup();
    globalThis.fetch = origFetch;
  }
});

test('GET /api/signals/[id]/share-image rejects unknown signal IDs and returns PNG OpenGraph card for verified entries', async () => {
  const unknownReq = new NextRequest(
    'http://localhost/api/signals/sig-unverified/share-image?ticker=H42&chain=SOL&multiplier=4.2&entry=$180K',
    { headers: { 'x-forwarded-for': '198.51.100.88' } }
  );
  const unknownRes = await shareImageGet(unknownReq, { params: Promise.resolve({ id: 'sig-unverified' }) });
  assert.equal(unknownRes.status, 404);

  const created = await createLedgerEntry({
    ticker: 'H42',
    chain: 'solana',
    contract_address: 'EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump',
    multiplier: '4.2',
    entry_price: '180000',
    closed_at: new Date().toISOString(),
    posted_by: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
  });

  try {
    const req = new NextRequest(
      `http://localhost/api/signals/${created.id}/share-image`,
      { headers: { 'x-forwarded-for': '198.51.100.88' } }
    );
    const res = await shareImageGet(req, { params: Promise.resolve({ id: created.id }) });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /^image\/png/i);
    const buf = await res.arrayBuffer();
    assert.ok(buf.byteLength > 1000);
  } finally {
    await deleteLedgerEntry(created.id);
  }
});

test('TelegramVerificationCard renders Alert Preferences, persists toggles, and rolls back on failure', async () => {
  const origFetch = globalThis.fetch;
  const postedBodies = [];
  let failNextPrefSave = false;

  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/api/verification/status')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          wallet: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
          tier: 'pro',
          entitlement: { tier: 'pro', verified: true },
          telegram: {
            identity: { status: 'connected' },
            community: { status: 'joined', tier: 'pro' },
            notifications: {
              status: 'enabled',
              preferences: { new_calls: true, tp_alerts: true, sl_alerts: true, chains: [] },
            },
            connected: true,
          },
          actions: {
            canConnect: false,
            canJoinCommunity: false,
            canEnableNotifications: true,
          },
          can_connect: true,
          target_tier: null,
        }),
      };
    }
    if (u.includes('/api/verification/notifications') && init?.method === 'POST') {
      const parsed = JSON.parse(String(init.body || '{}'));
      postedBodies.push(parsed);
      if (failNextPrefSave) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ message: 'Preference store unavailable' }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          status: 'enabled',
          preferences: {
            new_calls: true,
            tp_alerts: parsed.preferences?.tp_alerts ?? true,
            sl_alerts: true,
            chains: parsed.preferences?.chains ?? [],
          },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const view = await renderComponent(
    React.createElement(TelegramVerificationCard, {
      connected: true,
      isPro: true,
      needsVerification: false,
      walletAddress: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
    })
  );

  try {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    const prefsBox = view.container.querySelector('[data-testid="tg-notification-prefs"]');
    assert.ok(prefsBox, 'Notification preferences panel renders');

    const tpBtn = view.container.querySelector('[data-testid="tg-pref-tp_alerts"]');
    assert.ok(tpBtn);
    assert.equal(tpBtn.getAttribute('aria-pressed'), 'true');

    await act(async () => {
      tpBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 40));
    });

    assert.equal(postedBodies.length, 1);
    assert.deepEqual(postedBodies[0], { preferences: { tp_alerts: false } });
    assert.equal(tpBtn.getAttribute('aria-pressed'), 'false');

    // Trigger failure and verify rollback + alert message
    failNextPrefSave = true;
    const solBtn = view.container.querySelector('[data-testid="tg-pref-chain-sol"]');
    assert.ok(solBtn);
    assert.equal(solBtn.getAttribute('aria-pressed'), 'false');

    await act(async () => {
      solBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 40));
    });

    assert.equal(solBtn.getAttribute('aria-pressed'), 'false', 'Failed chain update rolls back');
    assert.ok(view.container.textContent.includes('Preference store unavailable'));
  } finally {
    await view.cleanup();
    globalThis.fetch = origFetch;
  }
});
