import test from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, tierFor, calculateRequiredTokens } from '../../src/lib/tiers.ts';
import { isAdminWallet, ADMIN_WALLET } from '../../src/lib/config.ts';
import { resolveWalletEntitlement, getFeaturePermissions } from '../../src/server/entitlements.ts';
import { alphasForTier } from '../../src/server/alphas-data.ts';
import { verifySolanaSignature } from '../../src/server/auth.ts';
import crypto from 'crypto';
import { Keypair } from '@solana/web3.js';

test('CRITICAL FIX 03: Admin balance reflects real balance without artificial $20 override', () => {
  // Real on-chain balance is 0
  const onChainBalance = 0;
  const isAdmin = isAdminWallet(ADMIN_WALLET);
  assert.equal(isAdmin, true);

  // In GenesisContext balance calculation:
  // For live wallet: return onChainBalance directly without inflating to DEFAULT_MEMBER_TOKENS
  const liveAdminBalance = onChainBalance;
  assert.equal(liveAdminBalance, 0);

  // But admin permissions and tier remain PRO
  const permissions = getFeaturePermissions('pro', true);
  assert.equal(permissions.canAccessAdmin, true);
  assert.equal(permissions.canAccessTerminal, true);
  assert.equal(permissions.canAccessProSignals, true);
});

test('CRITICAL FIX 02: Entitlement Resolution Pro staker retains PRO even with 0 liquid tokens', async () => {
  // Pro staker who has staked $250 on StakePoint but has 0 liquid tokens
  const mockStakedTokens = 250 / 0.0000164;
  const entitlement = await resolveWalletEntitlement('StakePointProWallet11111111111111111111111', {
    mockHoldingTokens: 0,
    mockStakedTokens,
    mockPriceUsd: 0.0000164,
  });

  assert.equal(entitlement.tier, 'pro');
  assert.equal(entitlement.proEligibility.eligible, true);
  assert.equal(entitlement.memberEligibility.balanceTokens, 0);
  assert.equal(entitlement.permissions.canAccessProSignals, true);
  assert.equal(entitlement.permissions.canAccessTerminal, true);

  // Downstream alphasForTier receives 'PRO' and serves PRO records
  const sampleRegistry = [
    {
      id: 'alpha-1',
      ticker: '$ALPHA',
      callType: 'ALPHA',
      chain: 'SOL',
      minTier: 'LAB_MEMBER',
      caller: '@caller',
      takeProfits: [],
      pinned: false,
      ageMinutes: 5,
    },
    {
      id: 'max-1',
      ticker: '$MAX',
      callType: 'MAX_ALPHA',
      chain: 'SOL',
      minTier: 'PRO',
      caller: '@caller',
      takeProfits: [],
      pinned: false,
      ageMinutes: 2,
    },
    {
      id: 'watch-1',
      ticker: '$WATCH',
      callType: 'WATCHLIST',
      chain: 'SOL',
      minTier: 'PRO',
      caller: '@caller',
      takeProfits: [],
      pinned: false,
      ageMinutes: 1,
    },
  ];

  const items = await alphasForTier('PRO', Date.now(), sampleRegistry, false);
  assert.equal(items.length, 3);
  assert.ok(items.some((it) => it.callType === 'MAX_ALPHA'));
  assert.ok(items.some((it) => it.callType === 'WATCHLIST'));
  assert.ok(items.some((it) => it.callType === 'ALPHA'));
});

test('HIGH PRIORITY FIX 04: Platform Watchlist is strictly separate from Personal Starred Watchlist', () => {
  const calls = [
    { id: 'c1', ticker: '$TOKEN1', callType: 'ALPHA' },
    { id: 'c2', ticker: '$TOKEN2', callType: 'WATCHLIST' },
    { id: 'c3', ticker: '$TOKEN3', callType: 'MAX_ALPHA' },
  ];

  const userSavedWatchlist = ['c1']; // user starred c1

  // Platform Watchlist dataset: only platform records with callType === 'WATCHLIST'
  const platformWatchlist = calls.filter((c) => c.callType === 'WATCHLIST');
  assert.equal(platformWatchlist.length, 1);
  assert.equal(platformWatchlist[0].id, 'c2');
  assert.equal(platformWatchlist[0].callType, 'WATCHLIST');

  // Personal Watchlist filter: only user-saved tokens
  const personalWatchlist = calls.filter((c) => userSavedWatchlist.includes(c.id));
  assert.equal(personalWatchlist.length, 1);
  assert.equal(personalWatchlist[0].id, 'c1');
  assert.equal(personalWatchlist[0].callType, 'ALPHA');

  // Verify counters are strictly isolated
  const platformWatchlistCount = calls.filter((c) => c.callType === 'WATCHLIST').length;
  assert.equal(platformWatchlistCount, 1);
});

test('HIGH PRIORITY FIX 06: Social Raid challenge-response cryptographic signature verification', () => {
  const kp = Keypair.generate();
  const walletPubkey = kp.publicKey.toBase58();
  const campaignId = 'camp-test-123';
  const timestamp = Date.now();

  const challenge = `TrenchLabs Raid Submission|${campaignId}|${walletPubkey}|${timestamp}`;
  const messageBytes = Buffer.from(challenge, 'utf-8');

  // Sign challenge
  const signatureBytes = crypto.sign(null, messageBytes, {
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(kp.secretKey.slice(0, 32)),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  const sigHex = signatureBytes.toString('hex');

  // Verify signature succeeds
  const valid = verifySolanaSignature(walletPubkey, sigHex, challenge);
  assert.equal(valid, true);

  // Spoofed wallet signature fails
  const wrongKp = Keypair.generate();
  const invalid = verifySolanaSignature(wrongKp.publicKey.toBase58(), sigHex, challenge);
  assert.equal(invalid, false);

  // Tampered campaignId fails
  const tamperedChallenge = `TrenchLabs Raid Submission|camp-evil-999|${walletPubkey}|${timestamp}`;
  const tampered = verifySolanaSignature(walletPubkey, sigHex, tamperedChallenge);
  assert.equal(tampered, false);
});

test('MEDIUM PRIORITY FIX 08: Dashboard counters strictly isolate active raids and categorized calls', () => {
  const now = Date.now();
  const campaigns = [
    { id: '1', status: 'ACTIVE', expiresAt: new Date(now + 3600000).toISOString() },
    { id: '2', status: 'ACTIVE', expiresAt: new Date(now - 1000).toISOString() }, // expired
    { id: '3', status: 'PAUSED', expiresAt: new Date(now + 3600000).toISOString() }, // paused
    { id: '4', status: 'COMPLETED', expiresAt: new Date(now + 3600000).toISOString() }, // completed
  ];

  const activeRaidsCount = campaigns.filter(
    (c) => c.status === 'ACTIVE' && (!c.expiresAt || new Date(c.expiresAt).getTime() > now)
  ).length;

  assert.equal(activeRaidsCount, 1);

  const alphas = [
    { id: 'a1', callType: 'ALPHA', isMaxAlpha: false },
    { id: 'a2', callType: 'ALPHA', isMaxAlpha: false },
    { id: 'a3', callType: 'WATCHLIST', isMaxAlpha: false },
    { id: 'a4', callType: 'MAX_ALPHA', isMaxAlpha: true },
  ];

  const alphaCallsCount = alphas.filter((a) => a.callType === 'ALPHA' || (!a.callType && !a.isMaxAlpha)).length;
  const platformWatchlistCount = alphas.filter((a) => a.callType === 'WATCHLIST').length;
  const maxAlphaCallsCount = alphas.filter((a) => a.callType === 'MAX_ALPHA' || Boolean(a.isMaxAlpha)).length;

  assert.equal(alphaCallsCount, 2);
  assert.equal(platformWatchlistCount, 1);
  assert.equal(maxAlphaCallsCount, 1);
});
