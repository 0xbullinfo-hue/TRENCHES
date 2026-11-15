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
  StakeStatusTimeline,
  isTimelineStepInProgress,
  getStepVisualState,
} = await import('../../src/components/stake/StakeStatusTimeline.tsx');

test('isTimelineStepInProgress and getStepVisualState evaluate step transitions accurately', () => {
  assert.equal(isTimelineStepInProgress('idle'), false);
  assert.equal(isTimelineStepInProgress('submitted'), true);
  assert.equal(isTimelineStepInProgress('confirming'), true);
  assert.equal(isTimelineStepInProgress('verified'), true);
  assert.equal(isTimelineStepInProgress('active'), false);
  assert.equal(isTimelineStepInProgress('error'), false);

  assert.equal(getStepVisualState('confirming', 'submitted'), 'completed');
  assert.equal(getStepVisualState('confirming', 'confirming'), 'current');
  assert.equal(getStepVisualState('confirming', 'verified'), 'upcoming');
  assert.equal(getStepVisualState('active', 'active'), 'completed');
});

test('StakeStatusTimeline renders all 4 steps and updates state across submitted -> confirming -> verified -> active', async () => {
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  let root;

  await act(async () => {
    root = ReactDOMClient.createRoot(container);
    root.render(React.createElement(StakeStatusTimeline, { step: 'confirming' }));
  });

  const timeline = container.querySelector('[data-testid="stake-status-timeline"]');
  assert.ok(timeline);
  assert.equal(timeline.getAttribute('data-step'), 'confirming');
  assert.equal(
    container.querySelector('[data-testid="stake-step-submitted"]').getAttribute('data-state'),
    'completed'
  );
  assert.equal(
    container.querySelector('[data-testid="stake-step-confirming"]').getAttribute('data-state'),
    'current'
  );
  assert.equal(
    container.querySelector('[data-testid="stake-step-verified"]').getAttribute('data-state'),
    'upcoming'
  );

  await act(async () => {
    root.render(React.createElement(StakeStatusTimeline, { step: 'active' }));
  });

  assert.equal(
    container.querySelector('[data-testid="stake-step-active"]').getAttribute('data-state'),
    'completed'
  );
  assert.ok(container.textContent.includes('Pro tier active'));

  await act(async () => {
    root.unmount();
  });
  if (container.parentNode) {
    container.parentNode.removeChild(container);
  }
});
