import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomShim } from './helpers/dom-shim.mjs';

const dom = installDomShim();

const store = new Map();
const mockLocalStorage = {
  getItem: (key) => store.get(key) || null,
  setItem: (key, val) => store.set(key, String(val)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};
globalThis.localStorage = mockLocalStorage;
dom.window.localStorage = mockLocalStorage;
globalThis.window = dom.window;

globalThis.self = globalThis;
globalThis.requestIdleCallback = (cb) => setTimeout(cb, 1);
globalThis.cancelIdleCallback = (id) => clearTimeout(id);

const React = await import('react');
const ReactDOMClient = await import('react-dom/client');
const { act } = await import('react');
const { OnboardingChecklist } = await import(
  '../../src/components/dashboard/OnboardingChecklist.tsx'
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

test('OnboardingChecklist renders 4 steps for connected wallet and can be dismissed', async () => {
  const testWallet = 'TestWallet11111111111111111111111111111111111';
  mockLocalStorage.removeItem(`trenchlabs_onboarding_dismissed_v1:${testWallet}`);

  let explored = false;
  const { container, cleanup } = await renderComponent(
    React.createElement(OnboardingChecklist, {
      walletAddress: testWallet,
      isWalletConnected: true,
      isUnlockedOverride: false,
      onExploreCalls: () => {
        explored = true;
      },
    })
  );

  // Allow effect queueMicrotask to execute
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

  const checklist = container.querySelector('[data-testid="onboarding-checklist"]');
  assert.ok(checklist, 'Finds onboarding checklist');
  assert.ok(container.textContent.includes('Getting Started in TrenchLabs HQ'));
  assert.ok(container.textContent.includes('Connect Solana Wallet'));
  assert.ok(container.textContent.includes('Hold ~$20 in $H42'));
  assert.ok(container.textContent.includes('Stake for Pro ($250)'));
  assert.ok(container.textContent.includes('Explore Curated Alpha'));

  // Test explore callback
  const browseBtn = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent.includes('Browse Calls')
  );
  assert.ok(browseBtn, 'Finds browse button');
  await act(async () => {
    browseBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
  });
  assert.equal(explored, true);

  // Test dismiss
  const dismissBtn = container.querySelector('button[aria-label="Dismiss onboarding checklist"]');
  assert.ok(dismissBtn, 'Finds dismiss button');
  await act(async () => {
    dismissBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
  });

  assert.equal(container.querySelector('[data-testid="onboarding-checklist"]'), null);
  assert.equal(
    mockLocalStorage.getItem(`trenchlabs_onboarding_dismissed_v1:${testWallet}`),
    'true'
  );

  await cleanup();
});
