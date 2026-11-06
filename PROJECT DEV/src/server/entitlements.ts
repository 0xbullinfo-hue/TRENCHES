import { ADMIN_WALLET, isAdminWallet, TOKEN_DECIMALS, TOKEN_SYMBOL } from '@/lib/config';
import { getActiveStakes, loadDb, StakeRow } from '@/server/db';
import { readGenesisBalanceCached, readGenesisRawBalanceCached } from '@/server/genesis';
import { getGenesisPrice } from '@/server/price';

export type UserTier = 'free' | 'member' | 'pro';

export const MEMBER_USD_THRESHOLD = 20;
export const PRO_STAKE_USD_THRESHOLD = 250;
export const PRO_STAKE_MIN_LOCK_DAYS = 90;

export interface FeaturePermissions {
  canAccessTerminal: boolean;
  canAccessProSignals: boolean;
  canViewUnmaskedCA: boolean;
  canReceiveTelegramAlerts: boolean;
  canAccessAdmin: boolean;
}

export interface WalletEntitlement {
  walletAddress: string;
  tier: UserTier;
  isAdmin: boolean;
  memberEligibility: {
    eligible: boolean;
    balanceTokens: number;
    balanceRaw: string;
    balanceUsd: number;
    requiredUsd: number;
    thresholdTokens: number;
  };
  proEligibility: {
    eligible: boolean;
    stakedTokens: number;
    stakedRaw: string;
    stakedUsd: number;
    requiredUsd: number;
    activeStakeCount: number;
    earliestUnlockAt: string | null;
    latestUnlockAt: string | null;
    daysRemaining: number;
    isExpired: boolean;
  };
  price: {
    usd: number;
    source: string;
    isFresh: boolean;
    timestamp: string;
  };
  permissions: FeaturePermissions;
  downgradeReason?: string;
  resolvedAt: string;
}

export function getFeaturePermissions(tier: UserTier, isAdmin = false): FeaturePermissions {
  if (isAdmin) {
    return {
      canAccessTerminal: true,
      canAccessProSignals: true,
      canViewUnmaskedCA: true,
      canReceiveTelegramAlerts: true,
      canAccessAdmin: true,
    };
  }

  switch (tier) {
    case 'pro':
      return {
        canAccessTerminal: true,
        canAccessProSignals: true,
        canViewUnmaskedCA: true,
        canReceiveTelegramAlerts: true,
        canAccessAdmin: false,
      };
    case 'member':
      return {
        canAccessTerminal: true,
        canAccessProSignals: false,
        canViewUnmaskedCA: true,
        canReceiveTelegramAlerts: true,
        canAccessAdmin: false,
      };
    case 'free':
    default:
      return {
        canAccessTerminal: false,
        canAccessProSignals: false,
        canViewUnmaskedCA: false,
        canReceiveTelegramAlerts: false,
        canAccessAdmin: false,
      };
  }
}

/**
 * Authoritative, centralized entitlement evaluation for any Solana wallet.
 * Validates real on-chain balance, active verified StakePoint stakes, and live oracle pricing.
 * Never trusts client-submitted tier assertions or parameters.
 */
export async function resolveWalletEntitlement(
  walletAddress: string,
  overrides?: {
    mockHoldingTokens?: number;
    mockStakedTokens?: number;
    mockPriceUsd?: number;
  }
): Promise<WalletEntitlement> {
  const resolvedAt = new Date().toISOString();
  const isAdmin = isAdminWallet(walletAddress);

  // 1. Fetch live or cached verified price (or mock price if overridden)
  const priceResult = overrides?.mockPriceUsd !== undefined
    ? { priceUsd: overrides.mockPriceUsd, source: 'TEST' as const, isFresh: true, timestamp: new Date().toISOString() }
    : await getGenesisPrice();
  const priceUsd = priceResult.priceUsd;

  // 2. Compute dynamic member threshold in token units
  const thresholdTokens = priceUsd > 0 ? Math.ceil(MEMBER_USD_THRESHOLD / priceUsd) : 1_219_512;

  // 3. Read on-chain $GENESIS token balance
  let balanceTokens = 0;
  let balanceRaw = '0';
  let balanceUsd = 0;

  if (overrides?.mockHoldingTokens !== undefined) {
    balanceTokens = overrides.mockHoldingTokens;
    balanceRaw = BigInt(Math.round(balanceTokens * Math.pow(10, TOKEN_DECIMALS))).toString();
    balanceUsd = +(balanceTokens * priceUsd).toFixed(2);
  } else {
    try {
      const rawBigInt = await readGenesisRawBalanceCached(walletAddress);
      balanceRaw = rawBigInt.toString();
      balanceTokens = Number(rawBigInt) / Math.pow(10, TOKEN_DECIMALS);
      balanceUsd = +(balanceTokens * priceUsd).toFixed(2);
    } catch (err) {
      console.error(`[Entitlements] Balance lookup failed for ${walletAddress}:`, err);
      // Fall back to float cache if raw fetch errored
      try {
        balanceTokens = await readGenesisBalanceCached(walletAddress);
        balanceUsd = +(balanceTokens * priceUsd).toFixed(2);
      } catch {
        // keep 0
      }
    }
  }

  const isMemberEligible = isAdmin || balanceUsd >= MEMBER_USD_THRESHOLD;

  // 4. Evaluate StakePoint Pro staking positions
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  let validStakes: Array<{ amount_raw: string; unlocks_at: string; status: string }> = [];
  let totalStakedRaw = BigInt(0);
  let stakedTokens = 0;
  let stakedUsd = 0;
  let earliestUnlockAt: string | null = null;
  let latestUnlockAt: string | null = null;
  let daysRemaining = 0;
  let hadStake = false;

  if (overrides?.mockStakedTokens !== undefined) {
    stakedTokens = overrides.mockStakedTokens;
    totalStakedRaw = BigInt(Math.round(stakedTokens * Math.pow(10, TOKEN_DECIMALS)));
    stakedUsd = +(stakedTokens * priceUsd).toFixed(2);
    if (stakedTokens > 0) {
      const futureUnlock = new Date(now + 90 * 86400 * 1000).toISOString();
      validStakes = [{ amount_raw: totalStakedRaw.toString(), unlocks_at: futureUnlock, status: 'active' }];
      earliestUnlockAt = futureUnlock;
      latestUnlockAt = futureUnlock;
      daysRemaining = 90;
      hadStake = true;
    }
  } else {
    const allStakes = await getActiveStakes(walletAddress);
    validStakes = allStakes.filter(
      (s) => s.status === 'active' && s.unlocks_at > nowIso
    );

    totalStakedRaw = validStakes.reduce(
      (acc, s) => acc + BigInt(s.amount_raw),
      BigInt(0)
    );
    stakedTokens = Number(totalStakedRaw) / Math.pow(10, TOKEN_DECIMALS);
    stakedUsd = +(stakedTokens * priceUsd).toFixed(2);

    if (validStakes.length > 0) {
      earliestUnlockAt = validStakes.reduce(
        (min, s) => (s.unlocks_at < min ? s.unlocks_at : min),
        validStakes[0].unlocks_at
      );
      latestUnlockAt = validStakes.reduce(
        (max, s) => (s.unlocks_at > max ? s.unlocks_at : max),
        validStakes[0].unlocks_at
      );
      daysRemaining = Math.max(
        0,
        Math.ceil((new Date(latestUnlockAt).getTime() - now) / (24 * 3600 * 1000))
      );
    }

    const db = await loadDb();
    const userStakes = (db.stakes || []).filter((s) => s.wallet_address === walletAddress);
    hadStake = userStakes.length > 0;
  }

  const isProEligible = isAdmin || stakedUsd >= PRO_STAKE_USD_THRESHOLD;
  const isExpired = hadStake && validStakes.length === 0;

  // 5. Final Tier Determination per Rule 2:
  // - Admin -> PRO
  // - Pro staking >= $250 -> PRO
  // - Holding >= $20 -> MEMBER
  // - Otherwise -> FREE
  let tier: UserTier = 'free';
  let downgradeReason: string | undefined;

  if (isAdmin || isProEligible) {
    tier = 'pro';
  } else if (isMemberEligible) {
    tier = 'member';
    if (isExpired) {
      downgradeReason = 'Pro staking duration expired. Retained Member access based on $20 holding balance.';
    }
  } else {
    tier = 'free';
    if (isExpired) {
      downgradeReason = 'Pro staking duration expired and holding balance is below $20.';
    } else if (hadStake && validStakes.length === 0) {
      downgradeReason = 'Staking position ended or withdrawn.';
    }
  }

  const permissions = getFeaturePermissions(tier, isAdmin);

  return {
    walletAddress,
    tier,
    isAdmin,
    memberEligibility: {
      eligible: isMemberEligible,
      balanceTokens,
      balanceRaw,
      balanceUsd,
      requiredUsd: MEMBER_USD_THRESHOLD,
      thresholdTokens,
    },
    proEligibility: {
      eligible: isProEligible,
      stakedTokens,
      stakedRaw: totalStakedRaw.toString(),
      stakedUsd,
      requiredUsd: PRO_STAKE_USD_THRESHOLD,
      activeStakeCount: validStakes.length,
      earliestUnlockAt,
      latestUnlockAt,
      daysRemaining,
      isExpired,
    },
    price: {
      usd: priceUsd,
      source: priceResult.source,
      isFresh: priceResult.isFresh,
      timestamp: priceResult.timestamp,
    },
    permissions,
    downgradeReason,
    resolvedAt,
  };
}

/**
 * Evaluates whether a wallet should be transitioned or demoted, recording the lifecycle transition.
 */
export async function evaluateWalletDowngrade(walletAddress: string): Promise<{
  previousTier?: UserTier;
  newTier: UserTier;
  changed: boolean;
  downgradeReason?: string;
}> {
  const db = await loadDb();
  const memberRow = (db.telegram_members || []).find((m) => m.wallet_address === walletAddress);
  const previousTier = memberRow?.tier;

  const currentEntitlement = await resolveWalletEntitlement(walletAddress);
  const newTier = currentEntitlement.tier;

  const changed = previousTier !== undefined && previousTier !== newTier;

  return {
    previousTier,
    newTier,
    changed,
    downgradeReason: currentEntitlement.downgradeReason,
  };
}
