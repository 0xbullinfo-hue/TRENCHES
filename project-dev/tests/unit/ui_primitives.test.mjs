import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomShim } from './helpers/dom-shim.mjs';

const dom = installDomShim();

// Enhance focus prototype on dom-shim elements
dom.window.HTMLElement.prototype.focus = function () {
  if (this.ownerDocument) {
    this.ownerDocument.activeElement = this;
  }
};

class KeyboardEvent extends dom.Event {
  constructor(type, init = {}) {
    super(type, { bubbles: true, cancelable: true, ...init });
    this.key = init.key || '';
    this.shiftKey = Boolean(init.shiftKey);
    this.altKey = Boolean(init.altKey);
    this.ctrlKey = Boolean(init.ctrlKey);
    this.metaKey = Boolean(init.metaKey);
  }
}
globalThis.KeyboardEvent = KeyboardEvent;
dom.window.KeyboardEvent = KeyboardEvent;

const React = await import('react');
const ReactDOMClient = await import('react-dom/client');
const { act } = await import('react');
const { Tabs, TabPanel } = await import('../../src/components/ui/Tabs.tsx');
const { Modal } = await import('../../src/components/ui/Modal.tsx');
const { Button, getButtonClass } = await import('../../src/components/ui/Button.tsx');
const { Card } = await import('../../src/components/ui/Card.tsx');

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
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
    async rerender(nextUi) {
      await act(async () => {
        root.render(nextUi);
      });
    },
  };
}

test('UI Primitives: Button handles variants, sizes, and loading state', async () => {
  const primaryClass = getButtonClass({ variant: 'primary', size: 'md' });
  assert.ok(primaryClass.includes('bg-brand'));
  assert.ok(primaryClass.includes('h-10'));
  assert.ok(primaryClass.includes('focus-visible:ring-2'));

  const dangerClass = getButtonClass({ variant: 'danger', size: 'sm' });
  assert.ok(dangerClass.includes('#B42338'));
  assert.ok(dangerClass.includes('text-white'));
  assert.ok(dangerClass.includes('h-8'));

  const lgClass = getButtonClass({ variant: 'secondary', size: 'lg' });
  assert.ok(lgClass.includes('h-12'));
  assert.ok(lgClass.includes('border-border-default'));

  let clicked = false;
  const view = await renderComponent(
    React.createElement(
      Button,
      {
        loading: true,
        onClick: () => {
          clicked = true;
        },
      },
      'Submit'
    )
  );

  const btn = view.container.querySelector('button');
  assert.ok(btn);
  assert.equal(btn.getAttribute('aria-busy'), 'true');
  assert.equal(btn.disabled, true);
  btn.click();
  assert.equal(clicked, false, 'Loading button must be disabled and not trigger onClick');
  await view.unmount();
});

test('UI Primitives: Card renders correct borders and padding variants', async () => {
  const viewSm = await renderComponent(
    React.createElement(Card, { padding: 'sm' }, 'Content SM')
  );
  const cardSm = viewSm.container.querySelector('div');
  assert.ok(cardSm.className.includes('rounded-xl'));
  assert.ok(cardSm.className.includes('bg-surface'));
  assert.ok(cardSm.className.includes('border-border-default'));
  assert.ok(cardSm.className.includes('p-4'));
  await viewSm.unmount();

  const viewMd = await renderComponent(
    React.createElement(Card, { padding: 'md' }, 'Content MD')
  );
  const cardMd = viewMd.container.querySelector('div');
  assert.ok(cardMd.className.includes('p-5'));
  await viewMd.unmount();
});

test('UI Primitives: Tabs roving tabIndex and keyboard navigation (Arrow keys, Home, End)', async () => {
  const tabsList = [
    { id: 'ALPHA', label: 'Alpha Calls', count: 12, 'data-testid': 'tab-alpha' },
    { id: 'SOCIAL', label: 'Social Raids', count: 5, 'data-testid': 'tab-social' },
    { id: 'WATCHLIST', label: 'Watchlist', locked: true, 'data-testid': 'tab-watchlist' },
    { id: 'MAX_ALPHA', label: 'Max Alpha', locked: true, 'data-testid': 'tab-max-alpha' },
  ];

  let currentTab = 'ALPHA';
  const handleTabChange = (id) => {
    currentTab = id;
  };

  const view = await renderComponent(
    React.createElement(
      'div',
      null,
      React.createElement(Tabs, {
        tabs: tabsList,
        activeTab: currentTab,
        onTabChange: handleTabChange,
      }),
      React.createElement(TabPanel, { tabId: 'ALPHA', activeTab: currentTab }, 'Alpha Panel')
    )
  );

  const tabAlpha = view.container.querySelector('[data-testid="tab-alpha"]');
  const tabSocial = view.container.querySelector('[data-testid="tab-social"]');
  const tabWatchlist = view.container.querySelector('[data-testid="tab-watchlist"]');
  const tabMaxAlpha = view.container.querySelector('[data-testid="tab-max-alpha"]');

  assert.ok(tabAlpha);
  assert.ok(tabSocial);
  assert.ok(tabWatchlist);
  assert.ok(tabMaxAlpha);

  // Tab roles and aria attributes
  assert.equal(tabAlpha.getAttribute('role'), 'tab');
  assert.equal(tabAlpha.getAttribute('aria-selected'), 'true');
  assert.equal(tabAlpha.getAttribute('tabindex'), '0');

  assert.equal(tabSocial.getAttribute('role'), 'tab');
  assert.equal(tabSocial.getAttribute('aria-selected'), 'false');
  assert.equal(tabSocial.getAttribute('tabindex'), '-1');

  // Keyboard navigation: ArrowRight moves from ALPHA to SOCIAL
  await act(async () => {
    tabAlpha.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
  assert.equal(currentTab, 'SOCIAL');

  // Keyboard navigation: End moves to MAX_ALPHA
  await act(async () => {
    tabAlpha.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
  });
  assert.equal(currentTab, 'MAX_ALPHA');

  // Keyboard navigation: Home moves to ALPHA
  await act(async () => {
    tabAlpha.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
  });
  assert.equal(currentTab, 'ALPHA');

  // Keyboard navigation: ArrowLeft wraps around to MAX_ALPHA
  await act(async () => {
    tabAlpha.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  });
  assert.equal(currentTab, 'MAX_ALPHA');

  await view.unmount();
});

test('UI Primitives: Modal moves focus in, traps focus, responds to Escape, and returns focus on close', async () => {
  // Setup a trigger button that will have initial focus
  const triggerBtn = dom.document.createElement('button');
  triggerBtn.id = 'trigger-open-modal';
  dom.document.body.appendChild(triggerBtn);
  triggerBtn.focus();
  assert.equal(dom.document.activeElement, triggerBtn);

  let isOpen = true;
  let closeCalled = false;
  const handleClose = () => {
    closeCalled = true;
    isOpen = false;
  };

  const view = await renderComponent(
    React.createElement(
      Modal,
      {
        isOpen,
        onClose: handleClose,
        titleId: 'modal-title',
      },
      React.createElement('h2', { id: 'modal-title' }, 'Test Modal'),
      React.createElement('button', { id: 'modal-btn-1' }, 'Action 1'),
      React.createElement('button', { id: 'modal-btn-2' }, 'Action 2')
    )
  );

  // Flush timer for initial focus move
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

  const dialog = view.container.querySelector('[role="dialog"]');
  assert.ok(dialog);
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(dialog.getAttribute('aria-labelledby'), 'modal-title');

  const btn1 = view.container.querySelector('#modal-btn-1');
  const btn2 = view.container.querySelector('#modal-btn-2');
  assert.ok(btn1);
  assert.ok(btn2);

  // Focus was moved into the first focusable element inside the modal
  assert.equal(dom.document.activeElement, btn1);

  // Tab key trap forward from btn2 wraps back to btn1
  btn2.focus();
  assert.equal(dom.document.activeElement, btn2);
  await act(async () => {
    dom.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false }));
  });
  assert.equal(dom.document.activeElement, btn1);

  // Shift+Tab key trap backward from btn1 wraps to btn2
  await act(async () => {
    dom.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));
  });
  assert.equal(dom.document.activeElement, btn2);

  // Escape key triggers onClose
  await act(async () => {
    dom.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  assert.equal(closeCalled, true);

  // When modal unmounts / closes, focus returns to triggerBtn
  await view.rerender(
    React.createElement(
      Modal,
      {
        isOpen: false,
        onClose: handleClose,
      },
      null
    )
  );

  assert.equal(dom.document.activeElement, triggerBtn);

  await view.unmount();
  if (triggerBtn.parentNode) {
    triggerBtn.parentNode.removeChild(triggerBtn);
  }
});
