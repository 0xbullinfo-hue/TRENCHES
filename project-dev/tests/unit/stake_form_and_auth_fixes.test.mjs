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

const { GenesisContext } = await import('../../src/context/GenesisContext.tsx');
const { makeMockGenesisContext } = await import('./helpers/campaign_card_harness.tsx');
const { StakeForm } = await import('../../src/components/stake/StakeForm.tsx');
const { ProProgressBar } = await import('../../src/components/dashboard/ProProgressBar.tsx');
const { TelegramStatusBanner } = await import(
  '../../src/components/telegram/TelegramStatusBanner.tsx'
);
const { TelegramConnectButton } = await import(
  '../../src/components/telegram/TelegramConnectButton.tsx'
);
const { DashboardStakingCard } = await import(
  '../../src/components/stake/DashboardStakingCard.tsx'
);
const { TelegramVerificationCard } = await import(
  '../../src/components/telegram/TelegramVerificationCard.tsx'
);
const { canFetchSessionEndpoints } = await import('../../src/lib/auth/sessionGate.ts');

async function renderComponent(ui) {
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  let root;
  await act(async () => {
    root = ReactDOMClient.createRoot(container);
    root.render(ui);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
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

test('StakeForm omits silent 0.0000164 fallback when price unavailable and scales raw units with 6 decimals', async () => {
  const unpriced = await renderComponent(
    React.createElement(StakeForm, {
      walletPublicKey: null,
      walletBalanceTokens: 1000,
      genesisPriceUsd: 0,
      stakePointConfigured: true,
      onStakeSuccess: () => {},
    })
  );

  try {
    assert.ok(unpriced.container.textContent.includes('$H42 price unavailable'));
  } finally {
    await unpriced.cleanup();
  }

  const origFetch = globalThis.fetch;
  const confirmBodies = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/api/stake/confirm')) {
      confirmBodies.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ stake: { status: 'active' }, current_tier: 'pro' }),
    };
  };

  const priced = await renderComponent(
    React.createElement(StakeForm, {
      walletPublicKey: null,
      walletBalanceTokens: 100000,
      genesisPriceUsd: 0.01,
      stakePointConfigured: true,
      onStakeSuccess: () => {},
    })
  );

  try {
    const sigInput = priced.container.querySelector('#tx-sig');
    assert.ok(sigInput);

    // Trigger React onChange via value setter + input event
    const valueSetter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value'
    ).set;
    await act(async () => {
      valueSetter.call(sigInput, '5Ver7CJ4d1k6JvJm9JuG8F7z6kXn1sYQp2w3e4r5t6y7u8i9o0p');
      sigInput.dispatchEvent(new dom.Event('input', { bubbles: true }));
    });

    const form = priced.container.querySelector('form');
    await act(async () => {
      form.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.equal(confirmBodies.length, 1);
    // $250 / $0.01 = 25,000 tokens * 10^6 = 25,000,000,000 raw units
    assert.equal(confirmBodies[0].amount_raw, '25000000000');
  } finally {
    await priced.cleanup();
    globalThis.fetch = origFetch;
  }
});

test('Unverified or demo sessions do not poll protected /api/stake/status or /api/verification/status endpoints', async () => {
  const origFetch = globalThis.fetch;
  const calledUrls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calledUrls.push(u);
    if (u.includes('/api/stakepoint/pools')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ configured: false, pools: [] }),
      };
    }
    return {
      ok: false,
      status: 401,
      json: async () => ({ ok: false }),
    };
  };

  const unverifiedCtx = makeMockGenesisContext({
    connected: true,
    publicKeyBase58: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
    needsSignature: true,
    verificationState: 'CONNECTED_UNVERIFIED',
    demoEnabled: false,
    demoPreset: 'live',
  });

  const demoCtx = makeMockGenesisContext({
    connected: true,
    publicKeyBase58: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
    needsSignature: false,
    verificationState: 'VERIFIED',
    demoEnabled: true,
    demoPreset: 'admin',
  });

  const view = await renderComponent(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        GenesisContext.Provider,
        { value: unverifiedCtx },
        React.createElement(ProProgressBar, { isPro: false }),
        React.createElement(TelegramStatusBanner),
        React.createElement(TelegramConnectButton),
        React.createElement(DashboardStakingCard, { showTelegram: false }),
        React.createElement(TelegramVerificationCard, {
          connected: true,
          needsVerification: true,
          walletAddress: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
        })
      ),
      React.createElement(
        GenesisContext.Provider,
        { value: demoCtx },
        React.createElement(TelegramVerificationCard, {
          connected: true,
          needsVerification: false,
          walletAddress: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
        })
      )
    )
  );

  try {
    assert.ok(
      calledUrls.some((u) => u.includes('/api/stakepoint/pools')),
      'Public pool metadata still loads'
    );
    assert.equal(
      calledUrls.some((u) => u.includes('/api/stake/status')),
      false,
      'Protected /api/stake/status must not be fetched before wallet verification or in demo mode'
    );
    assert.equal(
      calledUrls.some((u) => u.includes('/api/verification/status')),
      false,
      'Protected /api/verification/status must not be fetched before wallet verification or in demo mode'
    );
  } finally {
    await view.cleanup();
    globalThis.fetch = origFetch;
  }

  assert.equal(
    canFetchSessionEndpoints(
      {
        connected: true,
        publicKeyBase58: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
        needsSignature: false,
        verificationState: 'INSUFFICIENT_MEMBERSHIP',
        demoEnabled: false,
        demoPreset: 'live',
      },
      false
    ),
    true
  );
  assert.equal(
    canFetchSessionEndpoints(
      {
        connected: true,
        publicKeyBase58: 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e',
        needsSignature: false,
        verificationState: 'VERIFYING',
        demoEnabled: false,
        demoPreset: 'live',
      },
      false
    ),
    false
  );
});

test('StakeForm $250 smoke check displays 15.2M $H42 and sends 6-decimal amount_raw', async () => {
  const origFetch = globalThis.fetch;
  const confirmBodies = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/api/stake/confirm')) {
      confirmBodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ stake: { status: 'active' }, current_tier: 'pro' }),
    };
  };

  const view = await renderComponent(
    React.createElement(StakeForm, {
      walletPublicKey: null,
      walletBalanceTokens: 20_000_000,
      genesisPriceUsd: 0.0000164,
      initialAmountUsd: 250,
      stakePointConfigured: true,
      onStakeSuccess: () => {},
    })
  );

  try {
    assert.ok(view.container.textContent.includes('15.2M $H42'));

    const sigInput = view.container.querySelector('#tx-sig');
    assert.ok(sigInput);
    const valueSetter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value'
    ).set;
    await act(async () => {
      valueSetter.call(sigInput, '5Ver7CJ4d1k6JvJm9JuG8F7z6kXn1sYQp2w3e4r5t6y7u8i9o0p');
      sigInput.dispatchEvent(new dom.Event('input', { bubbles: true }));
    });
    const form = view.container.querySelector('form');
    await act(async () => {
      form.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.equal(confirmBodies.length, 1);
    assert.equal(confirmBodies[0].amount_raw, '15243902439024');
  } finally {
    await view.cleanup();
    globalThis.fetch = origFetch;
  }
});

test('Root layout defines metadataBase and AuthContext awaits session creation & clears on wallet switch', () => {
  const layoutSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/app/layout.tsx'),
    'utf8'
  );
  assert.ok(layoutSrc.includes('metadataBase:'), 'RootLayout metadata must define metadataBase');

  const authSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/context/AuthContext.tsx'),
    'utf8'
  );
  assert.ok(
    authSrc.includes("method: 'DELETE'") && authSrc.includes('/api/auth/session'),
    'AuthContext must clear server session when switching wallets'
  );
  assert.ok(
    authSrc.includes('pendingSessionClearRef.current') && authSrc.includes("await fetch('/api/auth/session'"),
    'AuthContext must serialize session delete before session creation and await POST /api/auth/session'
  );
  assert.ok(
    authSrc.includes("demoPreset !== 'disconnected'"),
    'AuthContext must not enter demo fixture verification for disconnected or live wallet transitions'
  );

  const walletSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/context/WalletContext.tsx'),
    'utf8'
  );
  assert.ok(
    walletSrc.includes("const effectiveDemoPreset: DemoPreset =\n    wallet.connected && wallet.publicKey ? 'live' : demoPreset;") ||
      walletSrc.includes("const effectiveDemoPreset: DemoPreset =\r\n    wallet.connected && wallet.publicKey ? 'live' : demoPreset;"),
    'WalletContext must expose live demoPreset synchronously when a real wallet connects'
  );

  const stakeClientSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/stake/StakeClientView.tsx'),
    'utf8'
  );
  assert.ok(
    !stakeClientSrc.includes('0.0000164'),
    'StakeClientView must not inject a hardcoded 0.0000164 fallback price'
  );
  assert.ok(
    stakeClientSrc.includes("credentials: 'same-origin'"),
    'StakeClientView status refresh must include same-origin credentials'
  );
});
