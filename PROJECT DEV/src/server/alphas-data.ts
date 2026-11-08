import fs from 'fs';
import crypto from 'crypto';
import { KV_CONFIGURED, kvGet, kvSet, kvLock, kvUnlock } from '@/server/kv';
import path from 'path';
import type {
  AlphaArtTheme,
  AlphaCategory,
  AlphaItem,
  AlphaLink,
  AlphaStatus,
  Chain,
  Portfolio,
  QuoteToken,
  SyndicateCaller,
  TakeProfitTarget,
} from '@/lib/types';
import type { TierId } from '@/lib/tiers';
import { TIERS } from '@/lib/tiers';

export interface AlphaRecord {
  id: string;
  name: string;
  ticker: string;
  chain: Chain;
  quoteToken: QuoteToken;
  status: AlphaStatus;
  statusLabel: string;
  category: AlphaCategory;
  allocationLabel: 'Allocation' | 'Pool';
  allocation: string;
  timer?: { cycleMin: number; phaseMin: number };
  /** 1-5 Risk Level rating */
  risk: number;
  /** Risk:Reward ratio string (e.g. '1:4 R:R') */
  riskRewardRatio: string;
  /** Stop-loss / downside invalidation (e.g. '-25% SL') */
  stopLoss: string;
  /** Multiplier targets (e.g. 2x, 5x, 10x) */
  takeProfits: TakeProfitTarget[];
  /** Whether pinned by Admin to top priority section */
  pinned: boolean;
  pinnedAt?: string | null;
  entryMarketCap: string;
  entryMarketCapUsd: number;
  minTier: TierId;
  ca: string;
  links: AlphaLink[];
  summary: string;
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
  /** Admin outcome classification: PROFIT made (achieved), LOSS made, or PENDING */
  outcome?: 'PROFIT' | 'LOSS' | 'PENDING';
  /** Whether marked by Admin as Max Alpha (special orange outline highlight) */
  isMaxAlpha?: boolean;
  sparkline: number[];
  art: AlphaArtTheme;
}

export function formatCompactUsd(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '$0';
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

export function buildTakeProfits(
  entryMcUsd: number,
  currentMcUsd: number,
  multipliers: number[] = [2, 5, 10]
): TakeProfitTarget[] {
  const baseMc = entryMcUsd > 0 ? entryMcUsd : currentMcUsd;
  return multipliers.map((mult) => {
    const targetUsd = baseMc * mult;
    return {
      label: `${mult}x`,
      multiple: mult,
      targetMc: baseMc > 0 ? formatCompactUsd(targetUsd) : undefined,
      hit: baseMc > 0 && currentMcUsd >= targetUsd,
    };
  });
}

const DEFAULT_REGISTRY: AlphaRecord[] = [
  {
    id: 'bsc-lity',
    serialTag: 'EXP01',
    name: 'LITY Protocol',
    ticker: '$LITY',
    chain: 'BSC',
    quoteToken: 'BNB',
    status: 'LIVE',
    statusLabel: 'PRIORITY CALL',
    category: 'MOVERS',
    allocationLabel: 'Allocation',
    allocation: '25.0 BNB',
    timer: { cycleMin: 120, phaseMin: 15 },
    risk: 2,
    riskRewardRatio: '1:5 R:R',
    stopLoss: '-15% SL',
    entryMarketCap: '$580K',
    entryMarketCapUsd: 580000,
    takeProfits: buildTakeProfits(580000, 7000000, [2, 5, 10]),
    pinned: true,
    pinnedAt: '2026-11-03T11:00:00Z',
    minTier: 'LAB_MEMBER',
    ca: '0xD7057e7C56B9C2d5f0a3E639D07610db31C949c8',
    links: [
      { label: 'DexScreener', href: 'https://dexscreener.com/bsc/0x91727e4485542612e9ed4293d1021414dbf5e588' }
    ],
    summary: 'Decentralized AI liquidity routing & bridge protocol on BSC. Alerted at $580K entry before a massive 12.1x peak run to $7.0M.',
    marketCap: '$7.0M',
    marketCapUsd: 7000000,
    volume24h: '$3.45M',
    netInflow24h: '+$420.0K',
    change24hPct: 1106.9,
    age: '1h',
    ageMinutes: 60,
    caller: '@TrenchLabsAdmin',
    callerWinRate: '91.5% win',
    deployedVia: 'https://trenchlabshq.xyz',
    spotlightRank: 1,
    sparkline: [20, 24, 28, 35, 42, 50, 61, 75, 82, 88, 92, 95, 97, 99, 100],
    art: {
      bgFrom: '#11161D',
      bgTo: '#0A0E13',
      accent: '#4DFE15',
      secondary: '#76FF32',
      motif: 'pill',
      badgeText: 'BSC LIQUIDITY'
    }
  },
  {
    id: 'bsc-bc400',
    serialTag: 'EXP02',
    name: 'BITCOIN CULTIVATOR 400',
    ticker: '$BC400',
    chain: 'BSC',
    quoteToken: 'BNB',
    status: 'LIVE',
    statusLabel: 'PRIORITY CALL',
    category: 'MOVERS',
    allocationLabel: 'Allocation',
    allocation: '20.0 BNB',
    timer: { cycleMin: 90, phaseMin: 10 },
    risk: 3,
    riskRewardRatio: '1:4 R:R',
    stopLoss: '-20% SL',
    entryMarketCap: '$880K',
    entryMarketCapUsd: 880000,
    takeProfits: buildTakeProfits(880000, 6200000, [2, 5, 7]),
    pinned: true,
    pinnedAt: '2026-11-03T10:45:00Z',
    minTier: 'LAB_MEMBER',
    ca: '0x61Fc93c7C070B32B1b1479B86056d8Ec1D7125BD',
    links: [
      { label: 'DexScreener', href: 'https://dexscreener.com/bsc/0xa02e8735cdc35aea44a770cb511513826e6c68c5' }
    ],
    summary: 'Bitcoin Cultivator 400 algorithmic BNB yield farming protocol. Dispatched at $880K entry, surging 7.0x to a $6.2M peak.',
    marketCap: '$6.2M',
    marketCapUsd: 6200000,
    volume24h: '$2.18M',
    netInflow24h: '+$280.0K',
    change24hPct: 604.5,
    age: '2h',
    ageMinutes: 120,
    caller: '@TrenchLabsAdmin',
    callerWinRate: '88.0% win',
    deployedVia: 'https://trenchlabshq.xyz',
    spotlightRank: 2,
    sparkline: [18, 22, 27, 34, 40, 48, 55, 63, 72, 79, 85, 91, 95, 98, 100],
    art: {
      bgFrom: '#161C24',
      bgTo: '#0A0E13',
      accent: '#4DFE15',
      secondary: '#76FF32',
      motif: 'stealth',
      badgeText: 'BNB FARMING'
    }
  },
  {
    id: 'bsc-water',
    serialTag: 'EXP03',
    name: 'Clean Water',
    ticker: '$WATER',
    chain: 'BSC',
    quoteToken: 'BNB',
    status: 'LIVE',
    statusLabel: 'PRIORITY CALL',
    category: 'MOVERS',
    allocationLabel: 'Allocation',
    allocation: '10.0 BNB',
    timer: { cycleMin: 60, phaseMin: 5 },
    risk: 4,
    riskRewardRatio: '1:10 R:R',
    stopLoss: '-25% SL',
    entryMarketCap: '$8.0K',
    entryMarketCapUsd: 8000,
    takeProfits: buildTakeProfits(8000, 120000, [2, 5, 10, 15]),
    pinned: true,
    pinnedAt: '2026-11-03T10:15:00Z',
    minTier: 'LAB_MEMBER',
    ca: '0x5056d8DFf13388813e4BA9B26375aef658E0044F',
    links: [
      { label: 'DexScreener', href: 'https://dexscreener.com/bsc/0xe8d2a16a9526ca7706c4a13e8b119416791c99b0' }
    ],
    summary: 'Clean Water Foundation charity impact token on BSC. Early micro-cap called at $8K market cap before surging 15x to $120K peak.',
    marketCap: '$120K',
    marketCapUsd: 120000,
    volume24h: '$480.0K',
    netInflow24h: '+$65.0K',
    change24hPct: 1400.0,
    age: '3h',
    ageMinutes: 180,
    caller: '@TrenchLabsAdmin',
    callerWinRate: '94.0% win',
    deployedVia: 'https://trenchlabshq.xyz',
    spotlightRank: 3,
    sparkline: [10, 15, 22, 30, 42, 55, 68, 77, 84, 89, 93, 96, 98, 100],
    art: {
      bgFrom: '#11161D',
      bgTo: '#0A0E13',
      accent: '#4DFE15',
      secondary: '#76FF32',
      motif: 'pill',
      badgeText: 'MICRO-CAP'
    }
  },
  {
    id: 'bsc-azuki',
    serialTag: 'EXP04',
    name: 'AZUKI ANIME',
    ticker: '$AZUKI',
    chain: 'BSC',
    quoteToken: 'BNB',
    status: 'LIVE',
    statusLabel: 'LIVE CALL',
    category: 'MOVERS',
    allocationLabel: 'Allocation',
    allocation: '12.0 BNB',
    timer: { cycleMin: 45, phaseMin: 5 },
    risk: 3,
    riskRewardRatio: '1:3 R:R',
    stopLoss: '-20% SL',
    entryMarketCap: '$21K',
    entryMarketCapUsd: 21000,
    takeProfits: buildTakeProfits(21000, 55000, [2, 2.5]),
    pinned: false,
    minTier: 'LAB_MEMBER',
    ca: '0x5963dbDC6BB18f9F1AFc07C0Cb8EBF354dB24cbB',
    links: [
      { label: 'DexScreener', href: 'https://dexscreener.com/bsc/0x2d6025e3d98fa8d0406267dc5a06694371c93c12' }
    ],
    summary: 'Azuki Anime community culture token on BSC. Early breakout alerted at $21K market cap, hitting take-profit targets at $55K peak (2.6x).',
    marketCap: '$55K',
    marketCapUsd: 55000,
    volume24h: '$320.0K',
    netInflow24h: '+$42.0K',
    change24hPct: 161.9,
    age: '4h',
    ageMinutes: 240,
    caller: '@TrenchLabsAdmin',
    callerWinRate: '86.5% win',
    deployedVia: 'https://trenchlabshq.xyz',
    spotlightRank: 4,
    sparkline: [15, 20, 25, 30, 38, 45, 52, 60, 68, 75, 82, 88, 92, 96, 100],
    art: {
      bgFrom: '#161C24',
      bgTo: '#0A0E13',
      accent: '#4DFE15',
      secondary: '#76FF32',
      motif: 'stealth',
      badgeText: 'ANIME BSC'
    }
  },
  {
    id: 'pill-trench',
    name: 'pill',
    ticker: '$PILL',
    chain: 'SOL',
    quoteToken: 'PUMP',
    status: 'LIVE',
    statusLabel: 'LIVE CALL',
    category: 'HOLDER_REWARDS',
    allocationLabel: 'Allocation',
    allocation: '15.0 SOL',
    timer: { cycleMin: 120, phaseMin: 0 },
    risk: 2,
    riskRewardRatio: '1:5 R:R',
    stopLoss: '-20% SL',
    entryMarketCap: '$165K',
    entryMarketCapUsd: 165_000,
    takeProfits: buildTakeProfits(165_000, 796_000, [2, 5, 10]),
    pinned: true,
    pinnedAt: '2026-11-03T10:00:00Z',
    minTier: 'LAB_MEMBER',
    ca: 'PiLLq7cV1x9ZpK3mW2aYbF8dLs4uNe6rHj5tGo2pump',
    links: [
      { label: 'Pump.fun', href: 'https://pump.fun' },
      { label: 'Photon', href: 'https://photon-sol.tinyastro.io/' },
      { label: 'BullX', href: 'https://bullx.io/' },
    ],
    summary:
      'Flagship TrenchLabs fee-router capsule. High-volume Solana trench runner with strong whale accumulation and clean liquidity.',
    marketCap: '$796K',
    marketCapUsd: 796_000,
    holderRewardsUsd: '$692,353',
    holderRewardsRaw: 692_353,
    holderRewardsQuote: '156.3M PUMP',
    holdersPaid: 24_286,
    volume24h: '$1.84M',
    netInflow24h: '+$142.8K',
    change24hPct: 384.2,
    age: '2h',
    ageMinutes: 120,
    caller: '@TrenchLabsAdmin',
    callerWinRate: '84.2% win',
    deployedVia: 'https://trenchlabshq.xyz',
    spotlightRank: 1,
    sparkline: [18, 22, 20, 29, 34, 31, 42, 48, 45, 59, 64, 62, 75, 84, 89, 96],
    art: {
      bgFrom: '#11161D',
      bgTo: '#0A0E13',
      accent: '#34D399',
      secondary: '#6EE7B7',
      motif: 'pill',
    },
  },
  {
    id: 'robin-hoodlum',
    name: 'Robinhood Alpha',
    ticker: '$SHERWOOD',
    chain: 'ROBIN',
    quoteToken: 'ROBIN',
    status: 'LIVE',
    statusLabel: 'PRIORITY CALL',
    category: 'MOVERS',
    allocationLabel: 'Allocation',
    allocation: '20.0 SOL',
    timer: { cycleMin: 90, phaseMin: 10 },
    risk: 3,
    riskRewardRatio: '1:6 R:R',
    stopLoss: '-25% SL',
    entryMarketCap: '$220K',
    entryMarketCapUsd: 220_000,
    takeProfits: buildTakeProfits(220_000, 640_000, [2, 5, 10]),
    pinned: true,
    pinnedAt: '2026-11-03T09:45:00Z',
    minTier: 'LAB_MEMBER',
    ca: '0x77Robin92A48e5dB4850d24F2C15e0a0B8D992B9eRBN',
    links: [
      { label: 'DexScreener', href: 'https://dexscreener.com' },
    ],
    summary:
      'First mover narrative play on Robinhood Chain (ROBIN). Early liquidity breakout spotted by Admin desk with 2x TP1 already cleared.',
    marketCap: '$640K',
    marketCapUsd: 640_000,
    holderRewardsUsd: '$412,900',
    holderRewardsRaw: 412_900,
    holderRewardsQuote: '88.4K USDC',
    holdersPaid: 14_210,
    volume24h: '$1.92M',
    netInflow24h: '+$195.0K',
    change24hPct: 290.9,
    age: '45m',
    ageMinutes: 45,
    caller: '@TrenchLabsAdmin',
    callerWinRate: '88.0% win',
    deployedVia: 'https://trenchlabshq.xyz',
    spotlightRank: 2,
    sparkline: [14, 19, 25, 31, 38, 44, 52, 49, 63, 71, 76, 82, 85, 90, 95, 100],
    art: {
      bgFrom: '#161C24',
      bgTo: '#0A0E13',
      accent: '#34D399',
      secondary: '#6EE7B7',
      motif: 'stealth',
      badgeText: 'ROBIN CHAIN',
    },
  },
  {
    id: 'baton-ai',
    name: 'baton',
    ticker: '$BATON',
    chain: 'SOL',
    quoteToken: 'PUMP',
    status: 'LIVE',
    statusLabel: 'LIVE CALL',
    category: 'HOLDER_REWARDS',
    allocationLabel: 'Allocation',
    allocation: '12.0 SOL',
    timer: { cycleMin: 180, phaseMin: 25 },
    risk: 2,
    riskRewardRatio: '1:4 R:R',
    stopLoss: '-20% SL',
    entryMarketCap: '$620K',
    entryMarketCapUsd: 620_000,
    takeProfits: buildTakeProfits(620_000, 3_500_000, [2, 5, 10]),
    pinned: true,
    pinnedAt: '2026-11-03T08:30:00Z',
    minTier: 'LAB_MEMBER',
    ca: 'BaTon9xK2mQ8pLw4tYc7nB3fH6jD1sV5uA9eZr8pump',
    links: [
      { label: 'Pump.fun', href: 'https://pump.fun' },
      { label: 'DexScreener', href: 'https://dexscreener.com/solana' },
    ],
    summary:
      'Relay baton protocol coordinating multi-wallet sniper protection and holder dividend splits across Solana trenches.',
    marketCap: '$3.50M',
    marketCapUsd: 3_500_000,
    holderRewardsUsd: '$591,806',
    holderRewardsRaw: 591_806,
    holderRewardsQuote: '131.2M PUMP',
    holdersPaid: 32_930,
    volume24h: '$2.41M',
    netInflow24h: '+$218.4K',
    change24hPct: 245.8,
    age: '3h',
    ageMinutes: 180,
    caller: '@TenderIvyLord',
    callerWinRate: '77.8% win',
    deployedVia: 'https://rapidlaunch.io',
    spotlightRank: 3,
    sparkline: [24, 28, 26, 35, 39, 44, 41, 52, 57, 63, 60, 71, 78, 82, 88, 93],
    art: {
      bgFrom: '#231D15',
      bgTo: '#0E0D0B',
      accent: '#F59E0B',
      secondary: '#FEF3C7',
      motif: 'baton',
    },
  },
  {
    id: 'btc-trench',
    name: 'Big Trench Coin',
    ticker: '$BTC',
    chain: 'ETH',
    quoteToken: 'WBTC',
    status: 'LIVE',
    statusLabel: 'LIVE CALL',
    category: 'HOLDER_REWARDS',
    allocationLabel: 'Allocation',
    allocation: '1.5 ETH',
    timer: { cycleMin: 240, phaseMin: 40 },
    risk: 2,
    riskRewardRatio: '1:3.5 R:R',
    stopLoss: '-15% SL',
    entryMarketCap: '$2.90M',
    entryMarketCapUsd: 2_900_000,
    takeProfits: buildTakeProfits(2_900_000, 8_520_000, [2, 5]),
    pinned: false,
    minTier: 'LAB_MEMBER',
    ca: '0x8fB32C18e5dB4850d24F2C15e0a0B8D992B9eA11',
    links: [
      { label: 'DexScreener', href: 'https://dexscreener.com/ethereum' },
      { label: 'Etherscan', href: 'https://etherscan.io' },
    ],
    summary:
      'Cross-chain WBTC-paired conviction setup on Ethereum mainnet with deep institutional pool depth and steady accumulation.',
    marketCap: '$8.52M',
    marketCapUsd: 8_520_000,
    holderRewardsUsd: '$281,485',
    holderRewardsRaw: 281_485,
    holderRewardsQuote: '3.12 WBTC',
    holdersPaid: 18_420,
    volume24h: '$4.12M',
    netInflow24h: '+$312.0K',
    change24hPct: 192.4,
    age: '6h',
    ageMinutes: 360,
    caller: '@ZebLobster1',
    callerWinRate: '79.4% win',
    deployedVia: 'https://j7tracker.io',
    spotlightRank: 4,
    sparkline: [30, 32, 35, 33, 45, 52, 49, 61, 66, 64, 74, 79, 85, 83, 91, 97],
    art: {
      bgFrom: '#2A190D',
      bgTo: '#120C08',
      accent: '#F97316',
      secondary: '#FFEDD5',
      motif: 'bull',
    },
  },
  {
    id: 'swordcat',
    name: 'swordcat',
    ticker: '$SWORDCAT',
    chain: 'SOL',
    quoteToken: 'SOL',
    status: 'LIVE',
    statusLabel: 'LIVE CALL',
    category: 'MOVERS',
    allocationLabel: 'Allocation',
    allocation: '20.0 SOL',
    timer: { cycleMin: 90, phaseMin: 15 },
    risk: 3,
    riskRewardRatio: '1:4 R:R',
    stopLoss: '-25% SL',
    entryMarketCap: '$440K',
    entryMarketCapUsd: 440_000,
    takeProfits: buildTakeProfits(440_000, 1_840_000, [2, 5, 10]),
    pinned: false,
    minTier: 'LAB_MEMBER',
    ca: 'SwCat4vK8mQ2pLw7tYc3nB6fH1jD5sV4uA8eZr9pump',
    links: [
      { label: 'Photon', href: 'https://photon-sol.tinyastro.io/' },
      { label: 'Solscan', href: 'https://solscan.io' },
    ],
    summary:
      'Cat wif tactical blade. High-velocity Solana meme call backed by Syndicate #01 momentum traders.',
    marketCap: '$1.84M',
    marketCapUsd: 1_840_000,
    holderRewardsUsd: '$236,336',
    holderRewardsRaw: 236_336,
    holderRewardsQuote: '1,180 SOL',
    holdersPaid: 14_890,
    volume24h: '$1.19M',
    netInflow24h: '+$84.6K',
    change24hPct: 318.0,
    age: '4h',
    ageMinutes: 240,
    caller: '@SugarySoreCreek',
    callerWinRate: '91.0% win',
    deployedVia: 'https://rapidlaunch.io',
    spotlightRank: 5,
    sparkline: [12, 19, 24, 22, 31, 38, 46, 44, 53, 61, 68, 72, 70, 81, 87, 94],
    art: {
      bgFrom: '#131C2B',
      bgTo: '#090D14',
      accent: '#38BDF8',
      secondary: '#E0F2FE',
      motif: 'swordcat',
    },
  },
  {
    id: 'avax-blizzard',
    name: 'Avalanche Rush',
    ticker: '$BLIZZ',
    chain: 'AVAX',
    quoteToken: 'AVAX',
    status: 'LIVE',
    statusLabel: 'LIVE CALL',
    category: 'NEW',
    allocationLabel: 'Allocation',
    allocation: '25.0 SOL',
    timer: { cycleMin: 60, phaseMin: 10 },
    risk: 4,
    riskRewardRatio: '1:5 R:R',
    stopLoss: '-30% SL',
    entryMarketCap: '$310K',
    entryMarketCapUsd: 310_000,
    takeProfits: buildTakeProfits(310_000, 745_000, [2, 5, 10]),
    pinned: false,
    minTier: 'LAB_MEMBER',
    ca: '0x49Avax72F4C74De56F88040C29322A53eE2c219888',
    links: [
      { label: 'DexScreener', href: 'https://dexscreener.com/avalanche' },
      { label: 'Snowtrace', href: 'https://snowtrace.io' },
    ],
    summary:
      'High-beta Avalanche C-Chain narrative breakout. Clean contract renounced, LP locked 12 months, targeting 5x continuation.',
    marketCap: '$745K',
    marketCapUsd: 745_000,
    holderRewardsUsd: '$184,200',
    holderRewardsRaw: 184_200,
    holderRewardsQuote: '5,120 AVAX',
    holdersPaid: 6_420,
    volume24h: '$980K',
    netInflow24h: '+$92.4K',
    change24hPct: 240.3,
    age: '35m',
    ageMinutes: 35,
    caller: '@TrenchLabsAdmin',
    callerWinRate: '84.2% win',
    deployedVia: 'https://trenchlabshq.xyz',
    sparkline: [15, 18, 25, 31, 28, 39, 47, 55, 62, 59, 71, 77, 84, 89, 92, 99],
    art: {
      bgFrom: '#1F1B2C',
      bgTo: '#0B0912',
      accent: '#A855F7',
      secondary: '#F3E8FF',
      motif: 'jubjub',
    },
  },
  {
    id: 'just-stealth-it',
    name: 'Just Stealth It',
    ticker: '$STEALTH',
    chain: 'BASE',
    quoteToken: 'ETH',
    status: 'LIVE',
    statusLabel: 'LIVE CALL',
    category: 'STEALTH',
    allocationLabel: 'Allocation',
    allocation: '15.0 SOL',
    timer: { cycleMin: 90, phaseMin: 20 },
    risk: 3,
    riskRewardRatio: '1:4 R:R',
    stopLoss: '-20% SL',
    entryMarketCap: '$410K',
    entryMarketCapUsd: 410_000,
    takeProfits: buildTakeProfits(410_000, 1_260_000, [2, 5]),
    pinned: false,
    minTier: 'LAB_MEMBER',
    ca: '0x71C92A48e5dB4850d24F2C15e0a0B8D992B9eF09',
    links: [{ label: 'DexScreener', href: 'https://dexscreener.com/base' }],
    summary:
      'Stealth-launched Base L2 liquidity router with MEV-shielded entry pools and strong Base smart-wallet inflows.',
    marketCap: '$1.26M',
    marketCapUsd: 1_260_000,
    holderRewardsUsd: '$112,400',
    holderRewardsRaw: 112_400,
    holderRewardsQuote: '34.5 ETH',
    holdersPaid: 6_890,
    volume24h: '$890K',
    netInflow24h: '+$64.2K',
    change24hPct: 289.4,
    age: '2h',
    ageMinutes: 120,
    caller: '@GiddyWaxEc',
    callerWinRate: '86.5% win',
    deployedVia: 'https://trenchlabshq.xyz',
    sparkline: [10, 14, 21, 29, 36, 34, 45, 53, 60, 68, 65, 74, 80, 85, 91, 98],
    art: {
      bgFrom: '#161C24',
      bgTo: '#0A0E13',
      accent: '#34D399',
      secondary: '#6EE7B7',
      motif: 'stealth',
    },
  },
  {
    id: 'otcity-desk',
    name: 'OTCity',
    ticker: '$OTCity',
    chain: 'BSC',
    quoteToken: 'BNB',
    status: 'LIVE',
    statusLabel: 'LIVE CALL',
    category: 'AI_AGENT',
    allocationLabel: 'Pool',
    allocation: '50.0 SOL',
    timer: { cycleMin: 150, phaseMin: 10 },
    risk: 3,
    riskRewardRatio: '1:4.5 R:R',
    stopLoss: '-22% SL',
    entryMarketCap: '$820K',
    entryMarketCapUsd: 820_000,
    takeProfits: buildTakeProfits(820_000, 2_780_000, [2, 5, 10]),
    pinned: false,
    minTier: 'LAB_MEMBER',
    ca: '0x33bB72F4C74De56F88040C29322A53eE2c219213',
    links: [
      { label: 'DexScreener', href: 'https://dexscreener.com/bsc' },
      { label: 'BscScan', href: 'https://bscscan.com/' },
    ],
    summary:
      'OTCity turns all OTC desks into a live 3D terminal city. Cross-chain BNB Chain settlement token for whale block trades.',
    marketCap: '$2.78M',
    marketCapUsd: 2_780_000,
    holderRewardsUsd: '$194,800',
    holderRewardsRaw: 194_800,
    holderRewardsQuote: '310 BNB',
    holdersPaid: 12_640,
    volume24h: '$1.52M',
    netInflow24h: '+$118.2K',
    change24hPct: 349.6,
    age: '19m',
    ageMinutes: 19,
    caller: '@NobleEvenG',
    callerWinRate: '89.5% win',
    deployedVia: 'https://trenchlabshq.xyz',
    sparkline: [19, 25, 31, 28, 37, 45, 52, 58, 63, 61, 72, 78, 84, 88, 93, 98],
    art: {
      bgFrom: '#0D2624',
      bgTo: '#061110',
      accent: '#2DD4BF',
      secondary: '#CCFBF1',
      motif: 'otcity',
    },
  },
  {
    id: 'catdog-coge',
    name: 'catdog',
    ticker: '$coge',
    chain: 'SOL',
    quoteToken: 'PUMP',
    status: 'LIVE',
    statusLabel: 'NEW CALL',
    category: 'NEW',
    allocationLabel: 'Allocation',
    allocation: '5.0 SOL',
    timer: { cycleMin: 45, phaseMin: 5 },
    risk: 4,
    riskRewardRatio: '1:5 R:R',
    stopLoss: '-30% SL',
    entryMarketCap: '$68K',
    entryMarketCapUsd: 68_000,
    takeProfits: buildTakeProfits(68_000, 104_300, [2, 5, 10]),
    pinned: false,
    minTier: 'LAB_MEMBER',
    ca: 'CoGe7xK2mQ8pLw4tYc7nB3fH6jD1sV5uA9eZr8tpump',
    links: [{ label: 'Pump.fun', href: 'https://pump.fun' }],
    summary:
      'Dual-species trench mascot launch with zero team allocation and fresh bonding curve graduation.',
    marketCap: '$104.3K',
    marketCapUsd: 104_300,
    holderRewardsUsd: '$41,280',
    holderRewardsRaw: 41_280,
    holderRewardsQuote: '14.2M PUMP',
    holdersPaid: 3_412,
    volume24h: '$318K',
    netInflow24h: '+$24.9K',
    change24hPct: 164.5,
    age: '4m',
    ageMinutes: 4,
    caller: '@epicsalmon',
    callerWinRate: '71.5% win',
    deployedVia: 'https://rapidlaunch.io',
    sparkline: [20, 24, 22, 31, 37, 42, 39, 48, 54, 61, 58, 69, 74, 80, 86, 92],
    art: {
      bgFrom: '#161C24',
      bgTo: '#11161D',
      accent: '#34D399',
      secondary: '#6EE7B7',
      motif: 'catdog',
    },
  },
  {
    id: 'barron-trench',
    name: 'Official Barron Trench',
    ticker: '$BARRON',
    chain: 'SOL',
    quoteToken: 'SOL',
    status: 'LIVE',
    statusLabel: 'DEGEN CALL',
    category: 'NEW',
    allocationLabel: 'Pool',
    allocation: '30.0 SOL',
    timer: { cycleMin: 60, phaseMin: 5 },
    risk: 5,
    riskRewardRatio: '1:8 R:R',
    stopLoss: '-35% SL',
    entryMarketCap: '$280K',
    entryMarketCapUsd: 280_000,
    takeProfits: buildTakeProfits(280_000, 1_220_000, [2, 5, 10]),
    pinned: false,
    minTier: 'LAB_MEMBER',
    ca: 'BaRRon4vK8mQ2pLw7tYc3nB6fH1jD5sV4uA8eZrpump',
    links: [{ label: 'Photon', href: 'https://photon-sol.tinyastro.io/' }],
    summary:
      'High-volatility meta trade call. Strictly size appropriately — 2x TP1 hit, trailing stop at entry.',
    marketCap: '$1.22M',
    marketCapUsd: 1_220_000,
    holderRewardsUsd: '$164,500',
    holderRewardsRaw: 164_500,
    holderRewardsQuote: '820 SOL',
    holdersPaid: 11_300,
    volume24h: '$1.95M',
    netInflow24h: '+$154.0K',
    change24hPct: 442.0,
    age: '18m',
    ageMinutes: 18,
    caller: '@Eqm8nF',
    callerWinRate: '88.3% win',
    deployedVia: 'https://j7tracker.io',
    sparkline: [11, 16, 24, 32, 41, 49, 56, 52, 64, 72, 78, 83, 88, 91, 95, 100],
    art: {
      bgFrom: '#1E2433',
      bgTo: '#0B0E17',
      accent: '#FACC15',
      secondary: '#FEF08A',
      motif: 'barron',
    },
  },
];

const DATA_FILE_PATH = path.join(process.cwd(), 'data', 'calls.json');
const KV_KEY = 'trench:calls:v1';
const KV_LOCK_KEY = 'trench:calls:lock';

/** Local-disk persistence is only allowed in dev, or explicitly on a single persistent server. */
const FILE_PERSISTENCE_ALLOWED =
  process.env.NODE_ENV !== 'production' || process.env.ALLOW_FILE_PERSISTENCE === 'true';

let registryLockChain: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Serialises read-modify-write cycles: in-process queue + distributed lock when KV is configured. */
export function withRegistryLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = registryLockChain.then(async () => {
    if (!KV_CONFIGURED) return fn();
    const token = crypto.randomUUID();
    let acquired = false;
    for (let i = 0; i < 20 && !acquired; i++) {
      acquired = await kvLock(KV_LOCK_KEY, token, 10);
      if (!acquired) await sleep(150);
    }
    if (!acquired) throw new Error('Registry busy, retry shortly');
    try {
      return await fn();
    } finally {
      await kvUnlock(KV_LOCK_KEY, token).catch(() => undefined);
    }
  });
  registryLockChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Loads the registry. Missing store => seed defaults. A read *failure* THROWS (never silently
 * returns defaults), otherwise the next save would overwrite real data with seed data.
 */
export async function loadCallsRegistry(): Promise<AlphaRecord[]> {
  if (KV_CONFIGURED) {
    const raw = await kvGet(KV_KEY);
    if (!raw) return DEFAULT_REGISTRY;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Corrupt calls registry in KV');
    return parsed as AlphaRecord[];
  }
  if (!fs.existsSync(DATA_FILE_PATH)) return DEFAULT_REGISTRY;
  const parsed = JSON.parse(fs.readFileSync(DATA_FILE_PATH, 'utf-8'));
  if (!Array.isArray(parsed)) throw new Error('Corrupt calls registry file');
  return parsed as AlphaRecord[];
}

export async function saveCallsRegistry(
  records: AlphaRecord[]
): Promise<{ success: boolean; error?: string }> {
  try {
    if (KV_CONFIGURED) {
      await kvSet(KV_KEY, JSON.stringify(records));
      return { success: true };
    }
    if (!FILE_PERSISTENCE_ALLOWED) {
      return {
        success: false,
        error:
          'Persistence not configured. Set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (or ALLOW_FILE_PERSISTENCE=true on a single persistent server).',
      };
    }
    fs.mkdirSync(path.dirname(DATA_FILE_PATH), { recursive: true });
    const tmp = `${DATA_FILE_PATH}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf-8');
    fs.renameSync(tmp, DATA_FILE_PATH); // atomic replace; no delete-then-rename gap
    return { success: true };
  } catch (err) {
    const message = (err as Error).message || 'Failed to write calls registry';
    console.error('[TrenchLabs] Registry write failed:', message);
    return { success: false, error: message };
  }
}

type ResolvedOutcome = 'PROFIT' | 'LOSS' | 'PENDING';

function outcomeOf(r: AlphaRecord): ResolvedOutcome {
  return (r.outcome as ResolvedOutcome) || (r.takeProfits?.some((t) => t.hit) ? 'PROFIT' : 'PENDING');
}

const MIN_CALLS_FOR_HIT_RATE = 5;

/**
 * Hit rate = calls that hit a take-profit (or were marked PROFIT) / ALL calls, with the raw counts shown.
 * Pending and unresolved calls count against the rate, so it cannot be inflated by omitting losers.
 */
export function winRateLabel(records: AlphaRecord[]): string {
  const total = records.length;
  if (total < MIN_CALLS_FOR_HIT_RATE) return '—';
  const wins = records.filter((r) => outcomeOf(r) === 'PROFIT').length;
  return `${((wins / total) * 100).toFixed(0)}% (${wins}/${total} calls hit)`;
}

/** Caller leaderboard computed from the registry (no hard-coded PnL or win-rate figures). */
export function buildCallers(registry: AlphaRecord[]): SyndicateCaller[] {
  const groups = new Map<string, AlphaRecord[]>();
  for (const r of registry) {
    const k = r.caller || '@unknown';
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([handle, recs], i) => {
      const best = [...recs].sort(
        (a, b) =>
          b.marketCapUsd / (b.entryMarketCapUsd || b.marketCapUsd || 1) -
          a.marketCapUsd / (a.entryMarketCapUsd || a.marketCapUsd || 1)
      )[0];
      return {
        rank: i + 1,
        handle,
        avatarBg: '#0D281E',
        avatarText: handle.replace('@', '').slice(0, 2).toUpperCase(),
        winRate: winRateLabel(recs),
        pnl24h: '—',
        pnl7d: '—',
        callsCount: recs.length,
        topCallTicker: best?.ticker ?? '—',
        minTier: 'LAB_MEMBER' as TierId,
      };
    });
}

const MASK = '██.█ ███';

function nextBoundary(now: number, cycleMin: number, phaseMin: number): string {
  const cycle = cycleMin * 60_000;
  const phase = phaseMin * 60_000;
  const t = Math.floor((now - phase) / cycle) * cycle + cycle + phase;
  return new Date(t).toISOString();
}

/** Project registry onto a viewer's tier, masking anything above it, sorting pinned calls first. */
export async function alphasForTier(
  tier: TierId,
  now = Date.now(),
  preloaded?: AlphaRecord[]
): Promise<AlphaItem[]> {
  const rank = TIERS[tier].rank;
  const registry = preloaded ?? (await loadCallsRegistry());
  const winRateByCaller = new Map<string, string>();
  for (const c of new Set(registry.map((r) => r.caller))) {
    winRateByCaller.set(c, winRateLabel(registry.filter((r) => r.caller === c)));
  }

  const sorted = [...registry].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    if (a.pinned && b.pinned) {
      const tA = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
      const tB = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
      if (tA !== tB) return tB - tA;
    }
    return a.ageMinutes - b.ageMinutes;
  });

  return sorted.map((r, idx) => {
    const locked = TIERS[r.minTier].rank > rank;
    const minBalanceRequired = TIERS[r.minTier].min;
    const serialTag = r.serialTag || `EXP${String(idx + 1).padStart(2, '0')}`;
    return {
      id: r.id,
      name: r.name,
      ticker: r.ticker,
      chain: r.chain,
      quoteToken: r.quoteToken,
      status: r.status,
      statusLabel: r.statusLabel,
      category: r.category,
      allocationLabel: r.allocationLabel,
      allocation: locked ? MASK : r.allocation,
      endsAt: r.timer ? nextBoundary(now, r.timer.cycleMin, r.timer.phaseMin) : null,
      risk: r.risk,
      riskRewardRatio: r.riskRewardRatio || '1:4 R:R',
      stopLoss: r.stopLoss || '-25% SL',
      takeProfits:
        r.takeProfits && r.takeProfits.length > 0
          ? r.takeProfits
          : buildTakeProfits(r.entryMarketCapUsd || r.marketCapUsd, r.marketCapUsd, [2, 5]),
      pinned: Boolean(r.pinned),
      pinnedAt: r.pinnedAt ?? null,
      entryMarketCap: r.entryMarketCap || r.marketCap,
      entryMarketCapUsd: r.entryMarketCapUsd || r.marketCapUsd,
      minTier: r.minTier,
      minTierLabel: TIERS[r.minTier].label,
      minBalanceRequired,
      locked,
      ca: locked ? null : r.ca,
      links: locked ? [] : r.links,
      summary: r.summary,
      marketCap: r.marketCap,
      marketCapUsd: r.marketCapUsd,
      holderRewardsUsd: r.holderRewardsUsd,
      holderRewardsRaw: r.holderRewardsRaw,
      holderRewardsQuote: r.holderRewardsQuote,
      holdersPaid: r.holdersPaid,
      volume24h: r.volume24h,
      netInflow24h: r.netInflow24h,
      change24hPct: r.change24hPct,
      age: r.age,
      ageMinutes: r.ageMinutes,
      caller: r.caller,
      callerWinRate: winRateByCaller.get(r.caller) ?? '—',
      deployedVia: r.deployedVia,
      spotlightRank: r.spotlightRank,
      serialTag,
      outcome: r.outcome ?? (r.takeProfits && r.takeProfits.some((t) => t.hit) ? 'PROFIT' : 'PENDING'),
      isMaxAlpha: Boolean(r.isMaxAlpha),
      sparkline: r.sparkline,
      art: r.art,
    };
  });
}

/** SAMPLE portfolio — illustrative benchmark cohort records. */
export function samplePortfolio(): Portfolio {
  if (process.env.NODE_ENV === 'production') {
    // Never ship illustrative PnL / signatures to production users.
    return { claimedCount: 0, totalRealizedPnl: '—', isSample: true, note: 'No verified claims yet', history: [] };
  }
  return {
    claimedCount: 4,
    totalRealizedPnl: '+42.50 SOL',
    isSample: true,
    note: 'Historical Cohort Benchmark Sample (Illustrative)',
    history: [
      {
        ticker: '$PILL',
        chain: 'SOL',
        size: '6.0 SOL',
        pnl: '+21.40 SOL',
        pnlPositive: true,
        slot: 298_410_214,
        claimedAt: '2026-10-31T14:22:00Z',
        sig: '5KnpVqXy7c2Lw9RtZmA3bHe8sJd4FgU1oYi6NkPq72jQaBcDeFgHiJkLmNoPqRsTuVwXyZ12345',
      },
      {
        ticker: '$BATON',
        chain: 'SOL',
        size: '4.0 SOL',
        pnl: '+14.85 SOL',
        pnlPositive: true,
        slot: 297_118_902,
        claimedAt: '2026-10-28T09:05:00Z',
        sig: '3hTqWm9Rk2Zp8XvLc4Yb7NdA6sJe5FgU1oYi6NkPq72jQaBcDeFgHiJkLmNoPqRsTuVwXyZ67890',
      },
      {
        ticker: '$SWORDCAT',
        chain: 'SOL',
        size: '3.0 SOL',
        pnl: '+8.10 SOL',
        pnlPositive: true,
        slot: 295_604_771,
        claimedAt: '2026-10-24T19:41:00Z',
        sig: '2gRpVn8Qj1Yo7WuKb3Xa6McZ5rId4EfT9nXh5MjOp61iPzAbCdEfGhIjKlMnOpQrStUvWxYz11111',
      },
      {
        ticker: '$STEALTH',
        chain: 'BASE',
        size: '2.5 SOL',
        pnl: '-1.85 SOL',
        pnlPositive: false,
        slot: 294_002_356,
        claimedAt: '2026-10-19T11:12:00Z',
        sig: '4jSrXo9Tl3Ap8YwMd5Zc8OeB7tKf6GhV2pZj7OlQr83kRbCdEfGhIjKlMnOpQrStUvWxYz22222',
      },
    ],
  };
}
