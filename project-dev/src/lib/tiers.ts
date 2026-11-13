/**
 * TrenchLabs Dynamic Access Architecture:
 * - Free: $0, public features & closed ledger.
 * - Member: Buy & hold >= $20 USD worth of $H42 in the connected wallet.
 * - Pro: Buy & stake >= $250 USD worth of $H42 on StakePoint (90-day lock).
 *
 * All thresholds are USD-denominated and calculated dynamically from token price,
 * completely replacing legacy fixed token gates.
 */

export type TierId = 'LOCKED' | 'LAB_MEMBER' | 'PRO';

export const MEMBER_USD_TARGET = 20;
export const PRO_USD_TARGET = 250;

/** Default reference price when API/oracle is offline ($0.0000164) */
export const DEFAULT_GENESIS_USD_PRICE = 0.0000164;

export function calculateRequiredTokens(usdTarget: number, priceUsd = DEFAULT_GENESIS_USD_PRICE): number {
  if (priceUsd <= 0) return 0;
  return Math.ceil(usdTarget / priceUsd);
}

export interface Tier {
  id: TierId;
  label: string;
  usdTarget: number;
  min: number;
  multiplier: number;
  baseCapSol: number;
  rank: number;
}

export const TIERS: Record<TierId, Tier> = {
  LOCKED: {
    id: 'LOCKED',
    label: 'Locked (< $20 $H42)',
    usdTarget: 0,
    min: 0,
    multiplier: 0,
    baseCapSol: 0,
    rank: 0,
  },
  LAB_MEMBER: {
    id: 'LAB_MEMBER',
    label: 'Lab Member (~$20 $H42 held)',
    usdTarget: MEMBER_USD_TARGET,
    min: calculateRequiredTokens(MEMBER_USD_TARGET, DEFAULT_GENESIS_USD_PRICE),
    multiplier: 1,
    baseCapSol: 10,
    rank: 1,
  },
  PRO: {
    id: 'PRO',
    label: 'Pro Trader (~$250 $H42 staked on StakePoint)',
    usdTarget: PRO_USD_TARGET,
    min: calculateRequiredTokens(PRO_USD_TARGET, DEFAULT_GENESIS_USD_PRICE),
    multiplier: 2.5,
    baseCapSol: 25,
    rank: 2,
  },
};

export const TIER_LADDER: Tier[] = [TIERS.LAB_MEMBER, TIERS.PRO];

export function tierFor(balance: number, priceUsd = DEFAULT_GENESIS_USD_PRICE): Tier {
  const balanceUsd = balance * priceUsd;
  if (balanceUsd >= MEMBER_USD_TARGET) return TIERS.LAB_MEMBER;
  return TIERS.LOCKED;
}

export function tierForBalanceAndStake(
  balanceTokens: number,
  stakedTokens: number,
  priceUsd = DEFAULT_GENESIS_USD_PRICE
): Tier {
  const stakedUsd = stakedTokens * priceUsd;
  if (stakedUsd >= PRO_USD_TARGET) return TIERS.PRO;

  const balanceUsd = balanceTokens * priceUsd;
  if (balanceUsd >= MEMBER_USD_TARGET) return TIERS.LAB_MEMBER;

  return TIERS.LOCKED;
}

export function allocationCap(t: Tier): number {
  return +(t.baseCapSol * t.multiplier).toFixed(2);
}

export function nextTier(t: Tier): Tier | null {
  if (t.id === 'LOCKED') return TIERS.LAB_MEMBER;
  if (t.id === 'LAB_MEMBER') return TIERS.PRO;
  return null;
}

export function longevityPoints(balance: number, priceUsd = DEFAULT_GENESIS_USD_PRICE): number {
  const requiredTokens = calculateRequiredTokens(MEMBER_USD_TARGET, priceUsd);
  if (requiredTokens <= 0 || balance < requiredTokens) return 0;
  return Math.floor((balance / requiredTokens) * 2500);
}
