import type { TierId } from './tiers';

export type Chain = 'SOL' | 'BSC' | 'ETH' | 'BASE' | 'ROBIN' | 'AVAX';
export type QuoteToken = 'PUMP' | 'SOL' | 'ETH' | 'USDC' | 'WBTC' | 'ZEC' | 'BNB' | 'AVAX' | 'ROBIN';
export type AlphaStatus = 'LIVE' | 'INCUBATING' | 'UPCOMING' | 'CLOSED';
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

export interface TakeProfitTarget {
  /** Multiplier label, e.g. '2x', '5x', '10x' */
  label: string;
  /** Numeric multiplier, e.g. 2, 5, 10 */
  multiple: number;
  /** Implied target Market Cap, e.g. '$1.59M' */
  targetMc?: string;
  /** Whether the target has been reached */
  hit?: boolean;
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
  /** Admin-rated risk level (1–5) */
  risk: number;
  /** Calculated Risk:Reward ratio (e.g. '1:4 R:R') */
  riskRewardRatio: string;
  /** Downside stop-loss / invalidation note (e.g. '-25% SL') */
  stopLoss: string;
  /** Take profit multiplier targets (e.g. 2x, 5x, 10x) */
  takeProfits: TakeProfitTarget[];
  /** Whether Admin pinned this call to the priority section at the top of the dashboard */
  pinned: boolean;
  /** ISO timestamp when pinned (for ordering pinned priority calls) */
  pinnedAt?: string | null;
  /** Market Cap at the moment the call was posted */
  entryMarketCap: string;
  entryMarketCapUsd: number;
  minTier: TierId;
  minTierLabel: string;
  /** Minimum liquid $GENESIS balance required to unlock this alpha token */
  minBalanceRequired: number;
  locked: boolean;
  ca: string | null;
  links: AlphaLink[];
  summary: string;
  /** Current Market Cap (live or latest) */
  marketCap: string;
  marketCapUsd: number;
  holderRewardsUsd?: string;
  holderRewardsRaw?: number;
  holderRewardsQuote?: string;
  holdersPaid?: number;
  volume24h: string;
  netInflow24h: string;
  change24hPct: number;
  age: string;
  ageMinutes: number;
  caller: string;
  callerWinRate: string;
  deployedVia: string;
  spotlightRank?: 1 | 2 | 3 | 4 | 5;
  /** Serial call tag, e.g. EXP01, EXP02, EXP03 */
  serialTag?: string;
  /** Admin outcome classification: profit made (achieved), loss made, or open */
  outcome?: 'PROFIT' | 'LOSS' | 'PENDING';
  /** Whether marked by Admin as Max Alpha (special orange outline highlight) */
  isMaxAlpha?: boolean;
  sparkline: number[];
  art: AlphaArtTheme;
  marketDataSource?: 'COINSTATS' | 'DEXSCREENER' | 'FIXTURE' | 'FALLBACK' | 'RECORDED' | 'UNAVAILABLE';
  dataFreshness?: 'LIVE' | 'CACHED' | 'FALLBACK' | 'FIXTURE' | 'UNAVAILABLE';
  lastPriceUpdated?: string;
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
  isSample?: boolean;
  note?: string;
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
  isAdmin: boolean;
  genesisMint: string;
  items: AlphaItem[];
  callers: SyndicateCaller[];
  portfolio: Portfolio;
  serverTime: string;
  verifiedUsersCount?: number;
}

export interface AlphasErr {
  ok: false;
  error:
    | 'BAD_REQUEST'
    | 'UNAUTHORIZED'
    | 'ACCESS_DENIED_ZERO_BALANCE'
    | 'UNAUTHORIZED_ADMIN'
    | 'RPC_UNAVAILABLE'
    | 'DEMO_BALANCE_DISABLED'
    | 'RATE_LIMITED'
    | 'STORE_UNAVAILABLE';
  message: string;
  balance?: number;
  items: [];
}

export type AlphasResponse = AlphasOk | AlphasErr;

export type CampaignStatus = 'ACTIVE' | 'COMPLETED' | 'PAUSED';

export type SubmissionStatus = 'PENDING' | 'AIRDROPPED' | 'REJECTED';

export interface CampaignSubmission {
  id: string;
  campaignId: string;
  walletAddress: string;
  xHandle: string;
  xRetweetLink: string;
  status: SubmissionStatus;
  airdroppedAt?: string | null;
  airdropTx?: string | null;
  submittedAt: string;
}

export interface Campaign {
  id: string;
  title: string;
  description: string;
  tweetUrl: string;
  rewardAmount: string;
  rewardToken?: string;
  totalPool?: string;
  targetActions?: string[];
  status: CampaignStatus;
  createdAt: string;
  expiresAt?: string;
  postedBy: string;
  submissionsCount?: number;
  airdroppedCount?: number;
  userSubmission?: CampaignSubmission | null;
  pinned?: boolean;
  pinnedAt?: string | null;
}

