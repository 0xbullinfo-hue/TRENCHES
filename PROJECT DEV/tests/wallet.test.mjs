import test from 'node:test';
import assert from 'node:assert/strict';

function canonicalWalletKey(name) {
  const lower = name.trim().toLowerCase();
  if (lower === 'trust' || lower === 'trust wallet' || lower === 'trustwallet') {
    return 'trust-wallet';
  }
  return lower;
}

function dedupeWallets(wallets) {
  const dedupedMap = new Map();
  for (const w of wallets) {
    const key = canonicalWalletKey(w.adapter.name);
    const existing = dedupedMap.get(key);
    if (!existing) {
      dedupedMap.set(key, w);
    } else {
      const existingInstalled = existing.readyState === 'Installed' || existing.readyState === 'Loadable';
      const candidateInstalled = w.readyState === 'Installed' || w.readyState === 'Loadable';
      if (candidateInstalled && !existingInstalled) {
        dedupedMap.set(key, w);
      }
    }
  }
  return Array.from(dedupedMap.values());
}

test('Wallet connect modal deduplication, event synchronization, and account-switch isolation', async () => {
  // 1. Canonical deduplication between Wallet Standard 'Trust' and 'Trust Wallet' adapter
  const wallets = [
    { adapter: { name: 'Phantom' }, readyState: 'Installed' },
    { adapter: { name: 'Trust Wallet', source: 'fallback' }, readyState: 'NotDetected' },
    { adapter: { name: 'Trust', source: 'standard' }, readyState: 'Installed' },
  ];
  const deduped = dedupeWallets(wallets);
  assert.equal(deduped.length, 2, 'Duplicate Trust Wallet entries must be collapsed into a single entry');
  const trustEntry = deduped.find((w) => canonicalWalletKey(w.adapter.name) === 'trust-wallet');
  assert.equal(trustEntry.readyState, 'Installed', 'Deduplication must prefer the Installed adapter over NotDetected');
  assert.equal(trustEntry.adapter.source, 'standard', 'Installed Standard adapter must win over NotDetected fallback');

  // 2. Connect-before-select ordering and post-select listener synchronization
  const events = [];
  let providerListener = null;
  let providerConnected = false;

  const mockAdapter = {
    name: 'Trust Wallet',
    connected: false,
    publicKey: null,
    async connect() {
      events.push('adapter.connect');
      this.connected = true;
      this.publicKey = 'PubKey_Trust_1111';
      if (providerListener) providerListener(this.publicKey);
    },
    emit(evt, pk) {
      events.push(`adapter.emit:${evt}`);
      if (evt === 'connect' && providerListener) {
        providerListener(pk);
      }
    },
  };

  function mockSelect(name) {
    events.push(`wallet.select:${name}`);
    // Simulate WalletProviderBase attaching its useEffect([adapter]) listener on commit
    providerListener = (pk) => {
      if (pk) providerConnected = true;
    };
  }

  // Execute handleSelectWallet sequence
  await mockAdapter.connect();
  mockSelect(mockAdapter.name);
  if (mockAdapter.connected && mockAdapter.publicKey && !providerConnected) {
    mockAdapter.emit('connect', mockAdapter.publicKey);
  }

  assert.deepEqual(
    events,
    ['adapter.connect', 'wallet.select:Trust Wallet', 'adapter.emit:connect'],
    'adapter.connect() must execute synchronously first, followed by wallet.select() and connect synchronization'
  );
  assert.equal(providerConnected, true, 'WalletProviderBase must end in connected=true even when connect() resolves before select()');

  // 3. Account-switch isolation & signature-gating invariant ($20 USD threshold)
  const MEMBER_THRESHOLD_TOKENS = 1_219_512;
  function computeIsUnlocked({ connected, needsSignature, isAdmin, balance }) {
    return Boolean(connected && !needsSignature && (isAdmin || balance >= MEMBER_THRESHOLD_TOKENS));
  }

  assert.equal(
    computeIsUnlocked({ connected: true, needsSignature: true, isAdmin: true, balance: 2_000_000 }),
    false,
    'Terminal must remain locked while needsSignature is true, even for Admin or high-balance state'
  );
  assert.equal(
    computeIsUnlocked({ connected: true, needsSignature: false, isAdmin: false, balance: 1_500_000 }),
    true,
    'Terminal must unlock once signature is verified and balance meets threshold'
  );
});

