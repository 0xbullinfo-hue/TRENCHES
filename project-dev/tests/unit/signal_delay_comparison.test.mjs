import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomShim } from './helpers/dom-shim.mjs';

const dom = installDomShim();
globalThis.window = dom.window;
globalThis.self = globalThis;

const React = await import('react');
const ReactDOMClient = await import('react-dom/client');
const { act } = await import('react');
const {
  SignalDelayComparison,
  getTierTimingComparison,
  MEMBER_SIGNAL_DELAY_SECONDS,
  PRO_SIGNAL_DELAY_SECONDS,
} = await import('../../src/components/landing/SignalDelayComparison.tsx');

test('getTierTimingComparison returns Pro (0s), Member (300s), and Free (post-resolution) windows with sanitized sample', () => {
  const tiers = getTierTimingComparison();
  assert.equal(tiers.length, 3);

  const pro = tiers.find((t) => t.tierId === 'PRO');
  const member = tiers.find((t) => t.tierId === 'LAB_MEMBER');
  const free = tiers.find((t) => t.tierId === 'FREE');

  assert.equal(pro.dispatchDelaySeconds, PRO_SIGNAL_DELAY_SECONDS);
  assert.equal(pro.dispatchDelaySeconds, 0);
  assert.ok(pro.costRequirement.includes('$250'));

  assert.equal(member.dispatchDelaySeconds, MEMBER_SIGNAL_DELAY_SECONDS);
  assert.equal(member.dispatchDelaySeconds, 300);
  assert.ok(member.costRequirement.includes('$20'));

  assert.equal(free.dispatchDelaySeconds, null);
  assert.ok(free.sanitizedExampleEntry.includes('$A***'));
});

test('SignalDelayComparison renders all three tier cards and sanitized timing timeline', async () => {
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  let root;

  await act(async () => {
    root = ReactDOMClient.createRoot(container);
    root.render(React.createElement(SignalDelayComparison));
  });

  const panel = container.querySelector('[data-testid="signal-delay-comparison"]');
  assert.ok(panel, 'SignalDelayComparison panel renders');
  assert.ok(container.querySelector('[data-testid="signal-delay-tier-pro"]'));
  assert.ok(container.querySelector('[data-testid="signal-delay-tier-lab_member"]'));
  assert.ok(container.querySelector('[data-testid="signal-delay-tier-free"]'));
  assert.ok(container.textContent.includes('T+0s (Instant)'));
  assert.ok(container.textContent.includes('T+300s (5m delay)'));
  assert.ok(container.textContent.includes('$A***'));

  await act(async () => {
    root.unmount();
  });
  if (container.parentNode) {
    container.parentNode.removeChild(container);
  }
});
