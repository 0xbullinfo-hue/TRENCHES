import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomShim } from './helpers/dom-shim.mjs';

const dom = installDomShim();
globalThis.window = dom.window;
globalThis.self = globalThis;
globalThis.requestIdleCallback = (cb) => setTimeout(cb, 1);
globalThis.cancelIdleCallback = (id) => clearTimeout(id);
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 1);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
const NodeProto = dom.window.Element.prototype;
if (!dom.document.getElementById) {
  dom.document.getElementById = function getElementById(id) {
    let found = null;
    const walk = (n) => {
      if (!n || found) return;
      if (n.nodeType === 1 && n.id === id) {
        found = n;
        return;
      }
      for (const c of n.childNodes || []) walk(c);
    };
    walk(this);
    return found;
  };
}
const matchSimpleAttr = (el, part) => {
  const notMatch = part.match(/^(.*):not\(\[([a-zA-Z0-9_-]+)="?([^"\]]*)"?\]\)$/);
  if (notMatch) {
    const [, base, nAttr, nVal] = notMatch;
    if (el.getAttribute(nAttr) === nVal) return false;
    part = base;
  }
  if (!part) return true;
  if (part.startsWith('#')) return el.id === part.slice(1);
  const attrMulti = [...part.matchAll(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g)];
  if (attrMulti.length > 0) {
    const tagPart = part.split('[')[0].trim();
    if (tagPart && el.localName !== tagPart.toLowerCase()) return false;
    return attrMulti.every((m) => {
      const attrName = m[1];
      const expected = m[2];
      if (expected === undefined) return el.hasAttribute(attrName) || el.getAttribute(attrName) !== null;
      return el.getAttribute(attrName) === expected;
    });
  }
  return el.localName === part.toLowerCase();
};
if (!NodeProto.scrollIntoView) NodeProto.scrollIntoView = () => {};
NodeProto.matches = function matches(selector) {
  return selector
    .split(',')
    .map((s) => s.trim())
    .some((s) => matchSimpleAttr(this, s));
};
NodeProto.closest = function closest(selector) {
  let cur = this;
  while (cur && cur.nodeType === 1) {
    if (cur.matches(selector)) return cur;
    cur = cur.parentNode;
  }
  return null;
};
NodeProto.querySelectorAll = function querySelectorAll(selector) {
  const results = [];
  const walk = (node) => {
    for (const child of node.childNodes || []) {
      if (child.nodeType === 1) {
        if (child.matches(selector)) results.push(child);
        walk(child);
      }
    }
  };
  walk(this);
  return results;
};
NodeProto.querySelector = function querySelector(selector) {
  return this.querySelectorAll(selector)[0] || null;
};

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

test('CommandPalette opens via trigger, filters & navigates via cmdk, and closes via close button', async () => {
  const navigated = [];
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  let root;

  await act(async () => {
    root = ReactDOMClient.createRoot(container);
    root.render(
      React.createElement(CommandPalette, {
        defaultOpen: false,
        initialAlphas: mockAlphas,
        onNavigate: (href) => navigated.push(href),
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

  const searchInput = container.querySelector('[data-testid="command-palette-input"]');
  assert.ok(searchInput, 'cmdk input renders');
  await act(async () => {
    dom.setInputValue(searchInput, 'BRUN');
  });
  assert.ok(container.textContent.includes('Base Runner ($BRUN)'));
  assert.equal(container.textContent.includes('Trench Token ($TRNCH)'), false);

  const cmdkItems = container.querySelectorAll('[cmdk-item=""]');
  const alphaItem = cmdkItems.find((el) => el.textContent.includes('Base Runner ($BRUN)'));
  assert.ok(alphaItem, 'Matching cmdk item renders');
  await act(async () => {
    alphaItem.dispatchEvent(new dom.Event('click', { bubbles: true }));
  });
  assert.deepEqual(navigated, ['/dashboard?tab=ALPHA']);
  assert.equal(container.querySelector('[data-testid="command-palette-dialog"]'), null);

  // Reopen and verify close button works
  await act(async () => {
    trigger.dispatchEvent(new dom.Event('click', { bubbles: true }));
  });
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
