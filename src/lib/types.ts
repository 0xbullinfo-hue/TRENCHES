import type { TierId } from './tiers';

export type Chain = 'SOL' | 'BASE' | 'ETH' | 'BSC';
export type QuoteToken = 'PUMP' | 'SOL' | 'ETH' | 'USDC' | 'WBTC' | 'ZEC' | 'BNB';
export type AlphaStatus = 'LIVE' | 'INCUBATING' | 'UPCOMING';
export type AlphaCategory = 'MOVERS' | 'NEW' | 'HOLDER_REWARDS' | 'AI_AGENT' | 'STEALTH' | 'CHARITY';
export type ArtMotif =
  | 'pill'
  | 'baton'
  | 'bull'
  | 'swordcat'
  | 'jubjub'
  | 'catdog'
  | 'anteater'
  | 'stealth'
  | 'babypump'
  | 'barron'
  | 'ape'
  | 'otcity';

export interface AlphaLink {
  label: string;
  href: string;
}

export interface AlphaArtTheme {
  bgFrom: string;
  bgTo: string;
  accent: string;
  secondary: string;
  motif: ArtMotif;
  badgeText?: string;
}

/** Shape returned to the client by GET /api/alphas. */
export interface AlphaItem {
  id: string;
  name: string;
  ticker: string;
  chain: Chain;
  quoteToken: QuoteToken;
  status: AlphaStatus;
  statusLabel: string;
  category: AlphaCategory;
  /** "Allocation" for live drops, "Pool" for incubating/upcoming. */
  allocationLabel: 'Allocation' | 'Pool';
  allocation: string;
  /** ISO timestamp the timer counts down to (live drops). */
  endsAt: string | null;
  /** Degen risk gauge, 1–5 beakers. */
  risk: number;
  minTier: TierId;
  minTierLabel: string;
  /** Minimum liquid $GENESIS balance required to unlock this alpha token */
  minBalanceRequired: number;
  locked: boolean;
  ca: string | null;
  links: AlphaLink[];
  summary: string;
  /** Rich Incubator Terminal metrics (matching reference views) */
  marketCap: string;
  marketCapUsd: number;
  holderRewardsUsd: string;
  holderRewardsRaw: number;
  holderRewardsQuote: string;
  holdersPaid: number;
  volume24h: string;
  netInflow24h: string;
  change24hPct: number;
  age: string;
  ageMinutes: number;
  caller: string;
  callerWinRate: string;
  deployedVia: string;
  spotlightRank?: 1 | 2 | 3 | 4 | 5;
  sparkline: number[];
  art: AlphaArtTheme;
}

export interface SyndicateCaller {
  rank: number;
  handle: string;
  avatarBg: string;
  avatarText: string;
  winRate: string;
  pnl24h: string;
  pnl7d: string;
  callsCount: number;
  topCallTicker: string;
  minTier: TierId;
}

export interface AllocationRecord {
  ticker: string;
  chain: Chain;
  size: string;
  pnl: string;
  pnlPositive: boolean;
  slot: number;
  claimedAt: string;
  sig: string;
}

export interface Portfolio {
  claimedCount: number;
  totalRealizedPnl: string;
  history: AllocationRecord[];
}

export interface AlphasOk {
  ok: true;
  tier: TierId;
  tierLabel: string;
  multiplier: number;
  allocationCap: number;
  balance: number;
  verified: boolean;
  genesisMint: string;
  items: AlphaItem[];
  callers: SyndicateCaller[];
  portfolio: Portfolio;
  serverTime: string;
}

export interface AlphasErr {
  ok: false;
  error:
    | 'BAD_REQUEST'
    | 'ACCESS_DENIED_ZERO_BALANCE'
    | 'RPC_UNAVAILABLE'
    | 'DEMO_BALANCE_DISABLED';
  message: string;
  items: [];
}

export type AlphasResponse = AlphasOk | AlphasErr;
