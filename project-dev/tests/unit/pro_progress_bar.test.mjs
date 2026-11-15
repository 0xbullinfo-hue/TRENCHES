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
const { ProProgressBar } = await import('../../src/components/dashboard/ProProgressBar.tsx');

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

test('ProProgressBar renders 100% when isPro is true', async () => {
  const { container, cleanup } = await renderComponent(
    React.createElement(ProProgressBar, { isPro: true })
  );

  const progressBar = container.querySelector('[role="progressbar"]');
  assert.ok(progressBar, 'Finds role="progressbar"');
  assert.equal(progressBar.getAttribute('aria-valuenow'), '100');
  assert.ok(container.textContent.includes('PRO TIER UNLOCKED'));
  assert.ok(container.textContent.includes('100%'));

  await cleanup();
});

test('ProProgressBar computes progress towards $250 target from gap_to_pro_usd', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/stake/status')) {
      return {
        ok: true,
        json: async () => ({
          current_tier: 'member',
          gap_to_pro_usd: 125,
          eligible_for_pro: false,
          thresholds: {
            pro: { usd_target: 250 },
          },
        }),
      };
    }
    return originalFetch(url);
  };

  try {
    const { container, cleanup } = await renderComponent(
      React.createElement(ProProgressBar, { isPro: false })
    );

    // Allow state update after fetch resolves
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    const progressBar = container.querySelector('[role="progressbar"]');
    assert.ok(progressBar, 'Finds role="progressbar"');
    assert.equal(progressBar.getAttribute('aria-valuenow'), '50');
    assert.ok(container.textContent.includes('50%'));
    assert.ok(container.textContent.includes('$125.00 remaining of $250 target'));
    assert.ok(container.textContent.includes('Stake to unlock Pro'));

    await cleanup();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
