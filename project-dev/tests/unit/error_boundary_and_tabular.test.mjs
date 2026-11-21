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

const { ErrorBoundary } = await import('../../src/components/ErrorBoundary.tsx');
const { TabularValue } = await import('../../src/components/primitives/TabularValue.tsx');

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
    async rerender(nextUi) {
      await act(async () => {
        root.render(nextUi);
      });
    },
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

test('ErrorBoundary isolates panel errors and recovers on Retry', async () => {
  let shouldThrow = true;
  function FlakyPanel() {
    if (shouldThrow) {
      throw new Error('Telemetry crash');
    }
    return React.createElement('div', { 'data-testid': 'recovered-panel' }, 'Panel OK');
  }

  const origConsoleError = console.error;
  console.error = () => {};

  let view;
  try {
    view = await renderComponent(
      React.createElement(
        ErrorBoundary,
        { panelName: 'Alpha Calls Feed' },
        React.createElement(FlakyPanel)
      )
    );

    assert.ok(view.container.textContent.includes('Alpha Calls Feed failed to load'));
    assert.ok(view.container.textContent.includes('Telemetry crash'));
    assert.equal(view.container.querySelector('[data-testid="recovered-panel"]'), null);

    shouldThrow = false;
    const retryBtn = view.container.querySelector('button');
    assert.ok(retryBtn);
    assert.equal(retryBtn.getAttribute('type'), 'button');

    await act(async () => {
      retryBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });

    assert.ok(view.container.querySelector('[data-testid="recovered-panel"]'));
    assert.ok(view.container.textContent.includes('Panel OK'));
  } finally {
    console.error = origConsoleError;
    if (view) await view.cleanup();
  }
});

test('TabularValue formats bigint, number, string, and empty values with tabular numerals', async () => {
  const view = await renderComponent(
    React.createElement(
      'div',
      null,
      React.createElement(TabularValue, {
        value: 123456789012345678n,
        decimals: 6,
        showSign: true,
        suffix: ' $H42',
      }),
      ' | ',
      React.createElement(TabularValue, {
        value: -4200000n,
        decimals: 6,
      }),
      ' | ',
      React.createElement(TabularValue, {
        value: 125,
        decimals: 2,
        prefix: '$',
      }),
      ' | ',
      React.createElement(TabularValue, {
        value: '1,250,000',
        suffix: ' $H42',
      }),
      ' | ',
      React.createElement(TabularValue, {
        value: null,
      })
    )
  );

  try {
    const spans = Array.from(view.container.querySelectorAll('span'));
    assert.equal(spans.length, 5);
    assert.equal(spans[0].textContent, '+123456789012.345678 $H42');
    assert.equal(spans[1].textContent, '-4.2');
    assert.equal(spans[2].textContent, '$125.00');
    assert.equal(spans[3].textContent, '1,250,000 $H42');
    assert.equal(spans[4].textContent, '—');

    for (const span of spans) {
      assert.ok(span.className.includes('tabular-nums'));
      assert.equal(span.style.fontVariantNumeric, 'tabular-nums');
    }
  } finally {
    await view.cleanup();
  }
});
