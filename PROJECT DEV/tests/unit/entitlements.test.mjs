import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWalletEntitlement, evaluateWalletDowngrade } from '../../src/server/entitlements.ts';
import { ADMIN_WALLET, isAdminWallet } from '../../src/lib/config.ts';

test('Entitlements: Free wallet with no holding and no stake', async () => {
  const wallet = 'FreeWallet1111111111111111111111111111111111';
  const ent = await resolveWalletEntitlement(wallet, {
    mockHoldingTokens: 0,
    mockStakedTokens: 0,
    mockPriceUsd: 0.0000164,
  });

  assert.equal(ent.tier, 'free');
  assert.equal(ent.memberEligibility.eligible, false);
  assert.equal(ent.proEligibility.eligible, false);
  assert.equal(ent.permissions.canAccessTerminal, false);
  assert.equal(ent.permissions.canAccessProSignals, false);
  assert.equal(ent.permissions.canViewUnmaskedCA, false);
  assert.equal(ent.permissions.canReceiveTelegramAlerts, false);
  assert.equal(ent.permissions.canAccessAdmin, false);
});

test('Entitlements: Member wallet with >= $20 USD holding', async () => {
  const wallet = 'MemberWallet11111111111111111111111111111111';
  // At $0.0000164, $20 is ~1,219,513 tokens. Let's provide 1,500,000 tokens ($24.60)
  const ent = await resolveWalletEntitlement(wallet, {
    mockHoldingTokens: 1_500_000,
    mockStakedTokens: 0,
    mockPriceUsd: 0.0000164,
  });

  assert.equal(ent.tier, 'member');
  assert.equal(ent.memberEligibility.eligible, true);
  assert.equal(ent.proEligibility.eligible, false);
  assert.equal(ent.permissions.canAccessTerminal, true);
  assert.equal(ent.permissions.canAccessProSignals, false);
  assert.equal(ent.permissions.canViewUnmaskedCA, true);
  assert.equal(ent.permissions.canReceiveTelegramAlerts, true);
  assert.equal(ent.permissions.canAccessAdmin, false);
});

test('Entitlements: Pro wallet with >= $250 USD StakePoint stake and 90-day lock', async () => {
  const wallet = 'ProWallet11111111111111111111111111111111111';
  // At $0.0000164, $250 is ~15,243,903 tokens. Let's provide 16,000,000 tokens staked ($262.40)
  const ent = await resolveWalletEntitlement(wallet, {
    mockHoldingTokens: 1_500_000,
    mockStakedTokens: 16_000_000,
    mockPriceUsd: 0.0000164,
  });

  assert.equal(ent.tier, 'pro');
  assert.equal(ent.memberEligibility.eligible, true);
  assert.equal(ent.proEligibility.eligible, true);
  assert.equal(ent.permissions.canAccessTerminal, true);
  assert.equal(ent.permissions.canAccessProSignals, true);
  assert.equal(ent.permissions.canViewUnmaskedCA, true);
  assert.equal(ent.permissions.canReceiveTelegramAlerts, true);
  assert.equal(ent.permissions.canAccessAdmin, false);
});

test('Entitlements: evaluateWalletDowngrade lifecycle function', async () => {
  const wallet = 'SomeWallet111111111111111111111111111111111';
  const downgradeResult = await evaluateWalletDowngrade(wallet);

  assert.ok(typeof downgradeResult.newTier === 'string');
  assert.ok(typeof downgradeResult.changed === 'boolean');
});

test('Entitlements: Admin wallet gets unconditional Pro access', async () => {
  const adminWallet = ADMIN_WALLET;
  const ent = await resolveWalletEntitlement(adminWallet);

  assert.equal(ent.tier, 'pro');
  assert.equal(ent.isAdmin, true);
  assert.equal(isAdminWallet(adminWallet), true);
  assert.equal(ent.permissions.canAccessTerminal, true);
  assert.equal(ent.permissions.canAccessProSignals, true);
  assert.equal(ent.permissions.canViewUnmaskedCA, true);
  assert.equal(ent.permissions.canReceiveTelegramAlerts, true);
  assert.equal(ent.permissions.canAccessAdmin, true);
});
