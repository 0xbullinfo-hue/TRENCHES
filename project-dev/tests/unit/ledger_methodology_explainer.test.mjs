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
const { LedgerMethodologyExplainer } = await import(
  '../../src/components/ledger/LedgerMethodologyExplainer.tsx'
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

test('LedgerMethodologyExplainer renders, expands details, dismisses and restores', async () => {
  mockLocalStorage.removeItem('trenchlabs_ledger_explainer_dismissed_v1');

  const { container, cleanup } = await renderComponent(
    React.createElement(LedgerMethodologyExplainer)
  );

  // Allow effect to run
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

  const panel = container.querySelector('[data-testid="ledger-methodology-explainer"]');
  assert.ok(panel, 'Explainer panel rendered');
  assert.ok(container.textContent.includes('Resolved Calls Only'));
  assert.ok(container.textContent.includes('Strict CA Validation'));

  // Expand details
  const detailsBtn = container.querySelector('button[aria-label="Expand methodology details"]');
  assert.ok(detailsBtn, 'Finds details expand button');
  await act(async () => {
    detailsBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
  });
  assert.ok(container.textContent.includes('Win Rate = (Profitable Calls / (Profitable Calls + Losses))'));

  // Dismiss
  const dismissBtn = container.querySelector('button[aria-label="Dismiss ledger explainer"]');
  assert.ok(dismissBtn, 'Finds dismiss button');
  await act(async () => {
    dismissBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
  });

  // Panel should be replaced with restore button
  assert.equal(container.querySelector('[data-testid="ledger-methodology-explainer"]'), null);
  assert.ok(container.textContent.includes('How this ledger works'));

  // Restore
  const restoreBtn = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent.includes('How this ledger works')
  );
  assert.ok(restoreBtn, 'Finds restore button');
  await act(async () => {
    restoreBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
  });

  assert.ok(container.querySelector('[data-testid="ledger-methodology-explainer"]'));

  await cleanup();
});
