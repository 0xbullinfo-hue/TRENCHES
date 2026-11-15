import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomShim } from './helpers/dom-shim.mjs';

const dom = installDomShim();
globalThis.window = dom.window;
globalThis.self = globalThis;
globalThis.requestIdleCallback = (cb) => setTimeout(cb, 1);
globalThis.cancelIdleCallback = (id) => clearTimeout(id);

const React = await import('react');
const ReactDOMClient = await import('react-dom/client');
const { act } = await import('react');
const { CommandPalette, filterCommandPaletteItems } = await import(
  '../../src/components/CommandPalette.tsx'
);

const mockAlphas = [
  {
    id: 'call-1',
    name: 'Trench Token',
    ticker: 'TRNCH',
    ca: 'So11111111111111111111111111111111111111112',
    chain: 'SOLANA',
  },
  {
    id: 'call-2',
    name: 'Base Runner',
    ticker: 'BRUN',
    ca: '0x1234567890abcdef1234567890abcdef12345678',
    chain: 'BASE',
  },
];

test('filterCommandPaletteItems filters alphas and navigation items by query', () => {
  const all = filterCommandPaletteItems('', mockAlphas);
  assert.ok(all.some((i) => i.id === 'alpha-call-1'));
  assert.ok(all.some((i) => i.id === 'nav-dashboard'));

  const filtered = filterCommandPaletteItems('TRNCH', mockAlphas);
  assert.ok(filtered.some((i) => i.id === 'filter-trnch'));
  assert.ok(filtered.some((i) => i.id === 'alpha-call-1'));
  assert.ok(!filtered.some((i) => i.id === 'alpha-call-2'));
});

test('CommandPalette opens via trigger, displays results, and closes via close button', async () => {
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  let root;

  await act(async () => {
    root = ReactDOMClient.createRoot(container);
    root.render(
      React.createElement(CommandPalette, {
        defaultOpen: false,
        initialAlphas: mockAlphas,
      })
    );
  });

  assert.equal(container.querySelector('[data-testid="command-palette-dialog"]'), null);

  const trigger = container.querySelector('[data-testid="command-palette-trigger"]');
  assert.ok(trigger, 'Trigger button renders');

  await act(async () => {
    trigger.dispatchEvent(new dom.Event('click', { bubbles: true }));
  });

  const dialog = container.querySelector('[data-testid="command-palette-dialog"]');
  assert.ok(dialog, 'Dialog opens on trigger click');
  assert.ok(container.textContent.includes('Trench Token ($TRNCH)'));
  assert.ok(container.textContent.includes('Public Performance Ledger'));

  const closeBtn = container.querySelector('[data-testid="command-palette-close"]');
  assert.ok(closeBtn, 'Close button renders');

  await act(async () => {
    closeBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
  });

  assert.equal(container.querySelector('[data-testid="command-palette-dialog"]'), null);

  await act(async () => {
    root.unmount();
  });
  if (container.parentNode) {
    container.parentNode.removeChild(container);
  }
});
