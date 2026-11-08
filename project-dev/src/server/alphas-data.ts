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

const DEFAULT_REGISTRY: AlphaRecord[] = [];

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
