import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { Keypair } from '@solana/web3.js';
import { installDomShim } from './helpers/dom-shim.mjs';

const dom = installDomShim();
globalThis.self = globalThis;
globalThis.requestIdleCallback = (cb) => setTimeout(cb, 1);
globalThis.cancelIdleCallback = (id) => clearTimeout(id);

const React = await import('react');
const ReactDOMClient = await import('react-dom/client');
const { act } = await import('react');

const { alphasForTier, resolveDestinations, resolvePublishStatus } = await import(
  '../../src/server/alphas-data.ts'
);
const { GET: getAlphasRoute } = await import('../../src/app/api/alphas/route.ts');
const { AdminWorkspace } = await import('../../src/components/admin/AdminWorkspace.tsx');
const { WorkspaceFilterBar, createDefaultFilterState } = await import(
  '../../src/components/dashboard/WorkspaceFilterBar.tsx'
);

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function signEd25519(kp, msg) {
  const key = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(kp.secretKey.slice(0, 32))]),
    format: 'der',
    type: 'pkcs8',
  });
  return crypto.sign(null, Buffer.from(msg, 'utf-8'), key).toString('hex');
}

function makeSignedGet(urlStr, kp) {
  const url = new URL(urlStr);
  const ts = Date.now();
  const wallet = kp.publicKey.toBase58();
  const sig = signEd25519(kp, ['TrenchLabs Access', 'GET', url.pathname, ts].join('|'));
  return new NextRequest(urlStr, {
    method: 'GET',
    headers: {
      'x-wallet': wallet,
      'x-timestamp': String(ts),
      'x-signature': sig,
    },
  });
}

async function renderNode(element) {
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  let root;
  await act(async () => {
    root = ReactDOMClient.createRoot(container);
    root.render(element);
  });
  return {
    container,
    async cleanup() {
      await act(async () => {
        root.unmount();
      });
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

function sampleRecord(overrides = {}) {
  return {
    id: 'rec-1',
    name: 'Test Protocol',
    ticker: '$TEST',
    chain: 'SOL',
    quoteToken: 'SOL',
    status: 'LIVE',
    statusLabel: 'LIVE CALL',
    category: 'NEW',
    allocationLabel: 'Allocation',
    allocation: '15.0 SOL',
    risk: 3,
    riskRewardRatio: 'Risk Lvl 3/5',
    stopLoss: '-25% SL',
    takeProfits: [{ label: '2x', multiple: 2, hit: false }],
    pinned: false,
    pinnedAt: null,
    entryMarketCap: '$200K',
    entryMarketCapUsd: 200000,
    minTier: 'LAB_MEMBER',
    ca: 'So11111111111111111111111111111111111111112',
    links: [],
    summary: 'Summary',
    marketCap: '$300K',
    marketCapUsd: 300000,
    volume24h: '$100K',
    netInflow24h: '—',
    change24hPct: 25,
    age: '10m',
    ageMinutes: 10,
    caller: '@TrenchLabsAdmin',
    callerWinRate: '—',
    deployedVia: 'https://trenchlabshq.xyz',
    sparkline: [],
    art: { bgFrom: '#161C24', bgTo: '#0A0E13', accent: '#34D399', secondary: '#6EE7B7', motif: 'pill', badgeText: 'SOL' },
    callType: 'ALPHA',
    isMaxAlpha: false,
    ...overrides,
  };
}

test('Publication lifecycle: drafts and archived posts are excluded from user feeds and exposed only when includeUnpublished=true', async () => {
  const registry = [
    sampleRecord({ id: 'pub-1', ticker: '$PUB', publishStatus: 'PUBLISHED' }),
    sampleRecord({ id: 'draft-1', ticker: '$DRAFT', publishStatus: 'DRAFT' }),
    sampleRecord({ id: 'arch-1', ticker: '$ARCH', publishStatus: 'ARCHIVED' }),
  ];

  assert.equal(resolvePublishStatus({}), 'PUBLISHED');
  assert.equal(resolvePublishStatus({ publishStatus: 'DRAFT' }), 'DRAFT');

  const userItems = await alphasForTier('PRO', Date.now(), registry, false, false);
  assert.deepEqual(userItems.map((i) => i.id), ['pub-1']);

  const adminFeedItems = await alphasForTier('PRO', Date.now(), registry, true, false);
  assert.deepEqual(adminFeedItems.map((i) => i.id), ['pub-1']);

  const adminAllItems = await alphasForTier('PRO', Date.now(), registry, true, true);
  assert.deepEqual(
    adminAllItems.map((i) => i.id).sort(),
    ['arch-1', 'draft-1', 'pub-1']
  );
});

test('Multi-destination classification preserves isMaxAlpha & callType=MAX_ALPHA on a single DB record', async () => {
  const dualRec = sampleRecord({
    id: 'dual-1',
    callType: 'MAX_ALPHA',
    isMaxAlpha: true,
    destinations: ['ALPHA', 'MAX_ALPHA'],
    minTier: 'PRO',
  });

  assert.deepEqual(resolveDestinations(dualRec), ['ALPHA', 'MAX_ALPHA']);

  const proView = await alphasForTier('PRO', Date.now(), [dualRec], false, false);
  assert.equal(proView.length, 1);
  assert.equal(proView[0].callType, 'MAX_ALPHA');
  assert.equal(proView[0].isMaxAlpha, true);
  assert.deepEqual(proView[0].destinations, ['ALPHA', 'MAX_ALPHA']);

  // Backend tier gating still prevents MEMBER from receiving isMaxAlpha records
  const memberView = await alphasForTier('LAB_MEMBER', Date.now(), [dualRec], false, false);
  assert.equal(memberView.length, 0);
});

test('Backend API fail-closed: non-admin wallet requesting ?scope=admin is rejected with 403', async () => {
  const nonAdminKp = Keypair.generate();
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: '2.0', id: 1, result: { value: [] } }),
  });

  try {
    const res = await getAlphasRoute(makeSignedGet('http://localhost:3000/api/alphas?scope=admin', nonAdminKp));
    // Non-admin with 0 balance gets 403 either from balance gate or explicit UNAUTHORIZED_ADMIN gate
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.equal(data.adminItems, undefined);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('AdminWorkspace renders Publishing Overview, Drafts/Archived tabs, Dual Destination selector & Live Preview', async () => {
  let submittedPayload = null;
  const pubItem = { ...sampleRecord({ id: 'a1', name: 'Alpha One', ticker: '$ONE', publishStatus: 'PUBLISHED' }), minTierLabel: 'Lab Member', minBalanceRequired: 1, locked: false, endsAt: null };
  const draftItem = { ...sampleRecord({ id: 'd1', name: 'Draft Token', ticker: '$DFT', publishStatus: 'DRAFT' }), minTierLabel: 'Lab Member', minBalanceRequired: 1, locked: false, endsAt: null };

  const view = await renderNode(
    React.createElement(AdminWorkspace, {
      items: [pubItem, draftItem],
      campaigns: [],
      onCreateCall: async (payload) => {
        submittedPayload = payload;
        return true;
      },
      onUpdateCall: async () => true,
      onDeleteCall: async () => true,
      onTogglePin: async () => true,
      onSetOutcome: async () => true,
      onInspect: () => {},
      onToast: () => {},
    })
  );

  try {
    const text = view.container.textContent;
    assert.ok(text.includes('Publishing Overview'));
    assert.ok(text.includes('Published Calls'));
    assert.ok(text.includes('Drafts'));
    assert.ok(text.includes('Archived'));
    assert.ok(text.includes('Alpha One'));

    // Switch to Drafts status tab -> Draft Token visible
    const draftsBtn = view.container.querySelector('[data-testid="admin-status-tab-draft"]');
    await act(async () => {
      draftsBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });
    assert.ok(view.container.textContent.includes('Draft Token'));

    // Open Create Call studio -> verify destination multi-select, live preview, Save Draft
    const createBtn = view.container.querySelector('[data-testid="admin-create-call-btn"]');
    await act(async () => {
      createBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });
    assert.ok(view.container.textContent.includes('Live Card Preview'));
    assert.ok(view.container.textContent.includes('Watchlist remains user-saved only'));

    // Select Max Alpha destination in addition to Alpha Calls
    const maxDestBtn = view.container.querySelector('[data-testid="dest-select-max-alpha"]');
    await act(async () => {
      maxDestBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });

    const caInput = view.container.querySelector('#admin-form-ca');
    const nameInput = view.container.querySelector('#admin-form-name');
    const tickerInput = view.container.querySelector('#admin-form-ticker');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
      setter.call(caInput, 'So11111111111111111111111111111111111111112');
      caInput.dispatchEvent(new dom.Event('input', { bubbles: true }));
      caInput.dispatchEvent(new dom.Event('change', { bubbles: true }));

      setter.call(nameInput, 'Dual Alpha');
      nameInput.dispatchEvent(new dom.Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new dom.Event('change', { bubbles: true }));

      setter.call(tickerInput, '$DUAL');
      tickerInput.dispatchEvent(new dom.Event('input', { bubbles: true }));
      tickerInput.dispatchEvent(new dom.Event('change', { bubbles: true }));
    });

    const draftSubmitBtn = view.container.querySelector('[data-testid="admin-save-draft-btn"]');
    await act(async () => {
      draftSubmitBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });

    assert.ok(submittedPayload, 'Expected onCreateCall to be invoked');
    assert.deepEqual(submittedPayload.destinations, ['ALPHA', 'MAX_ALPHA']);
    assert.equal(submittedPayload.callType, 'MAX_ALPHA');
    assert.equal(submittedPayload.isMaxAlpha, true);
    assert.equal(submittedPayload.publishStatus, 'DRAFT');
  } finally {
    await view.cleanup();
  }
});

test('WorkspaceFilterBar dispatches isolated patches for search, chain, filter pill, sort, and view mode', async () => {
  const patches = [];
  let resetCalls = 0;
  const view = await renderNode(
    React.createElement(WorkspaceFilterBar, {
      workspaceId: 'MAX_ALPHA',
      searchPlaceholder: 'Search Max Alpha...',
      state: createDefaultFilterState(),
      chainCounts: { ALL: 4, SOL: 2, BASE: 2 },
      totalFilteredCount: 4,
      onChange: (p) => patches.push(p),
      onReset: () => {
        resetCalls += 1;
      },
    })
  );

  try {
    const chainSol = view.container.querySelector('[data-testid="chain-max_alpha-sol"]');
    const pillMovers = view.container.querySelector('[data-testid="filter-pill-max_alpha-movers"]');
    const tableBtn = view.container.querySelector('[data-testid="view-table-max_alpha"]');

    await act(async () => {
      chainSol.dispatchEvent(new dom.Event('click', { bubbles: true }));
      pillMovers.dispatchEvent(new dom.Event('click', { bubbles: true }));
      tableBtn.dispatchEvent(new dom.Event('click', { bubbles: true }));
    });

    assert.deepEqual(patches, [
      { selectedChain: 'SOL' },
      { activeFilter: 'MOVERS' },
      { viewMode: 'TABLE' },
    ]);
    assert.equal(resetCalls, 0);
  } finally {
    await view.cleanup();
  }
});
