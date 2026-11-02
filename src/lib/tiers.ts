/**
 * Single-Tier Access Architecture:
 * Holding >= 1,000,000 $GENESIS in the connected wallet unlocks full Lab Access.
 */

export type TierId = 'LOCKED' | 'LAB_MEMBER';

export const MIN_GENESIS_REQUIRED = 1_000_000;

export interface Tier {
  id: TierId;
  label: string;
  min: number;
  multiplier: number;
  baseCapSol: number;
  rank: number;
}

export const TIERS: Record<TierId, Tier> = {
  LOCKED: {
    id: 'LOCKED',
    label: 'Locked (< 1M $GENESIS)',
    min: 0,
    multiplier: 0,
    baseCapSol: 0,
    rank: 0,
  },
  LAB_MEMBER: {
    id: 'LAB_MEMBER',
    label: 'Lab Member (1M+ $GENESIS)',
    min: MIN_GENESIS_REQUIRED,
    multiplier: 1,
    baseCapSol: 10,
    rank: 1,
  },
};

export const TIER_LADDER: Tier[] = [TIERS.LAB_MEMBER];

export function tierFor(balance: number): Tier {
  if (balance >= MIN_GENESIS_REQUIRED) return TIERS.LAB_MEMBER;
  return TIERS.LOCKED;
}

export function allocationCap(t: Tier): number {
  return +(t.baseCapSol * t.multiplier).toFixed(2);
}

export function nextTier(t: Tier): Tier | null {
  return t.id === 'LOCKED' ? TIERS.LAB_MEMBER : null;
}

export function longevityPoints(balance: number): number {
  if (balance < MIN_GENESIS_REQUIRED) return 0;
  return Math.floor((balance / MIN_GENESIS_REQUIRED) * 2500);
}
