import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomShim } from './helpers/dom-shim.mjs';

const dom = installDomShim();
globalThis.window = dom.window;
globalThis.self = globalThis;

const React = await import('react');
const ReactDOMClient = await import('react-dom/client');
const { act } = await import('react');
const { toGenesisProvenanceItem } = await import('../../src/lib/stake/provenance.ts');
const { CurrentStakeCard } = await import('../../src/components/stake/CurrentStakeCard.tsx');

test('toGenesisProvenanceItem maps live, cached, stale, and unavailable sources accurately', () => {
  const live = toGenesisProvenanceItem({
    twap_source: 'coinstats',
    stale: false,
    recalculated_at: '2026-11-15T12:00:00.000Z',
  });
  assert.equal(live.dataFreshness, 'LIVE');
  assert.equal(live.marketDataSource, 'COINSTATS');

  const cached = toGenesisProvenanceItem({
    twap_source: 'cached',
    stale: false,
  });
  assert.equal(cached.dataFreshness, 'CACHED');
  assert.equal(cached.marketDataSource, 'DEXSCREENER');

  const stale = toGenesisProvenanceItem({
    twap_source: 'dexscreener',
    stale: true,
  });
  assert.equal(stale.dataFreshness, 'STALE');

  const unavail = toGenesisProvenanceItem({
    twap_source: 'unavailable',
    stale: true,
  });
  assert.equal(unavail.dataFreshness, 'UNAVAILABLE');
});

test('CurrentStakeCard renders MarketDataBadge next to stake USD value', async () => {
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  let root;

  await act(async () => {
    root = ReactDOMClient.createRoot(container);
    root.render(
      React.createElement(CurrentStakeCard, {
        amountUsd: 250,
        unlocksAt: '2027-02-15T00:00:00.000Z',
        daysRemaining: 85,
        status: 'active',
        provenance: {
          twap_source: 'dexscreener',
          stale: false,
          recalculated_at: '2026-11-15T12:00:00.000Z',
        },
      })
    );
  });

  assert.ok(container.textContent.includes('LIVE · DexScreener'));
  assert.ok(container.textContent.includes('$250'));

  await act(async () => {
    root.unmount();
  });
  if (container.parentNode) {
    container.parentNode.removeChild(container);
  }
});
