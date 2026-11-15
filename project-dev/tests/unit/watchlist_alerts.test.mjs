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
const { WatchlistView } = await import('../../src/components/dashboard/WatchlistView.tsx');

const mockCalls = [
  {
    id: 'call-1',
    name: 'Solana Moon',
    ticker: 'SMOON',
    chain: 'SOL',
    ca: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    callType: 'ALPHA',
    ageMinutes: 10,
    age: '10m',
  },
  {
    id: 'call-2',
    name: 'Cyber Trench',
    ticker: 'CTRENCH',
    chain: 'SOL',
    ca: 'EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump',
    callType: 'ALPHA',
    ageMinutes: 30,
    age: '30m',
  },
];

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

test('WatchlistView renders empty state when no tokens are pinned', async () => {
  const { container, cleanup } = await renderComponent(
    React.createElement(WatchlistView, {
      watchlistIds: [],
      allCalls: mockCalls,
      onToggleWatchlist: () => {},
    })
  );

  assert.ok(container.querySelector('[data-testid="watchlist-empty-view"]'));
  assert.ok(container.textContent.includes('Your Personal Watchlist is Empty'));

  await cleanup();
});

test('WatchlistView renders pinned tokens with alert toggle defaulting to OFF', async () => {
  let toggledId = null;
  const { container, cleanup } = await renderComponent(
    React.createElement(WatchlistView, {
      watchlistIds: ['call-1'],
      allCalls: mockCalls,
      onToggleWatchlist: (id) => {
        toggledId = id;
      },
    })
  );

  assert.ok(container.querySelector('[data-testid="watchlist-view-panel"]'));
  assert.ok(container.textContent.includes('SMOON'));
  assert.ok(container.textContent.includes('Alerts Muted'));
  assert.ok(container.textContent.includes('Opt In'));

  // Test toggle button
  const optInBtn = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent.includes('Opt In')
  );
  assert.ok(optInBtn, 'Finds Opt In button');

  await act(async () => {
    optInBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
  });

  assert.ok(container.textContent.includes('Alerts Active'));
  assert.ok(container.textContent.includes('Opted In'));

  // Test remove from watchlist button
  const removeBtn = container.querySelector('button[aria-label="Remove SMOON from watchlist"]');
  assert.ok(removeBtn, 'Finds remove button');
  await act(async () => {
    removeBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
  });
  assert.equal(toggledId, 'call-1');

  await cleanup();
});
