import fs from 'fs';
import crypto from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  KV_CONFIGURED,
  isKvConfigured,
  kvGet,
  kvSet,
  kvLock,
  kvRenewLock,
  kvVerifyLock,
  kvUnlock,
  kvSetIfLocked,
} from '@/server/kv';
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
  change24hPct: number | null;
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
  /** Direct onchain or DexScreener token logo image URL */
  logoUrl?: string;
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
export const KV_KEY = 'trench:calls:v1';
export const KV_LOCK_KEY = 'trench:calls:lock';
/**
 * Default distributed lock lease in seconds.
 * Must exceed the maximum serverless function duration (maxDuration = 60s).
 */
export const DEFAULT_REGISTRY_LOCK_TTL_SEC = 65;

/** Local-disk persistence is only allowed in dev, or explicitly on a single persistent server. */
export function isFilePersistenceAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' || env.ALLOW_FILE_PERSISTENCE === 'true';
}

export interface RegistryLockKvAdapter {
  isConfigured: (env?: NodeJS.ProcessEnv) => boolean;
  lock: (key: string, token: string, ttlSec: number) => Promise<boolean>;
  renew: (key: string, token: string, ttlSec: number) => Promise<boolean>;
  verify: (key: string, token: string) => Promise<boolean>;
  unlock: (key: string, token: string) => Promise<boolean>;
  setIfLocked: (lockKey: string, lockToken: string, dataKey: string, value: string) => Promise<boolean>;
}

const defaultLockKvAdapter: RegistryLockKvAdapter = {
  isConfigured: (env) => KV_CONFIGURED || isKvConfigured(env),
  lock: kvLock,
  renew: kvRenewLock,
  verify: kvVerifyLock,
  unlock: kvUnlock,
  setIfLocked: kvSetIfLocked,
};

export interface RegistryLockContext {
  readonly key: string;
  readonly token: string;
  readonly ttlSec: number;
  readonly isDistributed: boolean;
  lost: boolean;
  lostReason?: string;
  assertOwned: () => Promise<void>;
  setProtected: (dataKey: string, value: string) => Promise<boolean>;
}

export interface RegistryLockOptions {
  /** Lock TTL in seconds (default: 65s, exceeding 60s maxDuration). */
  ttlSec?: number;
  /** Interval in ms between atomic lease renewals (default: min(15s, ttl/3)). */
  renewIntervalMs?: number;
  /** Max lock acquisition attempts under contention (default: 20). */
  maxAttempts?: number;
  /** Delay in ms between acquisition retries (default: 150ms). */
  retryDelayMs?: number;
  /** Optional environment override for tests. */
  env?: NodeJS.ProcessEnv;
  /** Optional KV adapter override for deterministic distributed lock testing. */
  kv?: Partial<RegistryLockKvAdapter>;
}

const registryLockStorage = new AsyncLocalStorage<RegistryLockContext>();

let registryLockChain: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Serialises read-modify-write cycles:
 * - In-process promise queue + distributed Redis lock when KV is configured.
 * - Uses cryptographically unique tokens (crypto.randomUUID()).
 * - Uses a 65s lease (> 60s maxDuration) with periodic atomic token-verified lease renewal.
 * - Tracks lock ownership via AsyncLocalStorage and aborts writes if lock ownership is lost.
 * - Fails safely in serverless production if neither Redis nor ALLOW_FILE_PERSISTENCE=true is configured.
 */
export function withRegistryLock<T>(
  fn: (ctx: RegistryLockContext) => Promise<T> | T,
  options: RegistryLockOptions = {}
): Promise<T> {
  const env = options.env ?? process.env;
  const kv: RegistryLockKvAdapter = { ...defaultLockKvAdapter, ...options.kv };
  const ttlSec =
    typeof options.ttlSec === 'number' && Number.isFinite(options.ttlSec) && options.ttlSec > 0
      ? Math.max(1, Math.ceil(options.ttlSec))
      : DEFAULT_REGISTRY_LOCK_TTL_SEC;
  const renewIntervalMs =
    typeof options.renewIntervalMs === 'number' &&
    Number.isFinite(options.renewIntervalMs) &&
    options.renewIntervalMs > 0
      ? options.renewIntervalMs
      : Math.max(100, Math.min(15_000, Math.floor((ttlSec * 1000) / 3)));
  const maxAttempts =
    typeof options.maxAttempts === 'number' && options.maxAttempts >= 1 ? Math.floor(options.maxAttempts) : 20;
  const retryDelayMs =
    typeof options.retryDelayMs === 'number' && options.retryDelayMs >= 0 ? options.retryDelayMs : 150;

  const run = registryLockChain.then(async () => {
    const token = crypto.randomUUID();
    const distributed = kv.isConfigured(env);

    if (!distributed) {
      if (!isFilePersistenceAllowed(env)) {
        throw new Error(
          'Production distributed lock requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or ALLOW_FILE_PERSISTENCE=true on a single persistent server).'
        );
      }
      const localCtx: RegistryLockContext = {
        key: KV_LOCK_KEY,
        token,
        ttlSec,
        isDistributed: false,
        lost: false,
        assertOwned: async () => {
          if (localCtx.lost) {
            throw new Error(localCtx.lostReason || 'Registry lock ownership lost');
          }
        },
        setProtected: async () => !localCtx.lost,
      };
      return await registryLockStorage.run(localCtx, () => fn(localCtx));
    }

    let acquired = false;
    for (let i = 0; i < maxAttempts && !acquired; i++) {
      // Redis errors propagate immediately (never silently treat failure as acquired lock)
      acquired = await kv.lock(KV_LOCK_KEY, token, ttlSec);
      if (!acquired && i + 1 < maxAttempts) {
        await sleep(retryDelayMs);
      }
    }
    if (!acquired) {
      throw new Error('Registry busy, retry shortly');
    }

    const ctx: RegistryLockContext = {
      key: KV_LOCK_KEY,
      token,
      ttlSec,
      isDistributed: true,
      lost: false,
      assertOwned: async () => {
        if (ctx.lost) {
          throw new Error(ctx.lostReason || 'Registry lock ownership lost');
        }
        const ok = await kv.verify(KV_LOCK_KEY, token);
        if (!ok) {
          ctx.lost = true;
          ctx.lostReason = 'Registry lock ownership lost in Redis';
          throw new Error(ctx.lostReason);
        }
      },
      setProtected: async (dataKey: string, value: string) => {
        if (ctx.lost) return false;
        const ok = await kv.setIfLocked(KV_LOCK_KEY, token, dataKey, value);
        if (!ok) {
          ctx.lost = true;
          ctx.lostReason = 'Registry lock ownership lost before save';
        }
        return ok;
      },
    };

    let renewInFlight = false;
    const renewTimer = setInterval(async () => {
      if (renewInFlight || ctx.lost) return;
      renewInFlight = true;
      try {
        const renewed = await kv.renew(KV_LOCK_KEY, token, ttlSec);
        if (!renewed) {
          ctx.lost = true;
          ctx.lostReason = 'Registry lock renewal failed: lock expired or owned by another worker';
          clearInterval(renewTimer);
        }
      } catch (err) {
        ctx.lost = true;
        ctx.lostReason = `Registry lock renewal error: ${(err as Error).message || 'Redis error'}`;
        clearInterval(renewTimer);
      } finally {
        renewInFlight = false;
      }
    }, renewIntervalMs);

    if (typeof renewTimer.unref === 'function') {
      renewTimer.unref();
    }

    try {
      const result = await registryLockStorage.run(ctx, () => fn(ctx));
      if (ctx.lost) {
        throw new Error(ctx.lostReason || 'Registry lock ownership lost during execution');
      }
      return result;
    } finally {
      clearInterval(renewTimer);
      await kv.unlock(KV_LOCK_KEY, token).catch(() => false);
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
  if (KV_CONFIGURED || isKvConfigured()) {
    const raw = await kvGet(KV_KEY);
    if (!raw) return DEFAULT_REGISTRY;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Corrupt calls registry in KV');
    return parsed as AlphaRecord[];
  }
  if (!isFilePersistenceAllowed()) {
    throw new Error(
      'Persistence not configured. Set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (or ALLOW_FILE_PERSISTENCE=true on a single persistent server).'
    );
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
    const ctx = registryLockStorage.getStore();
    if (ctx) {
      if (ctx.lost) {
        return {
          success: false,
          error: ctx.lostReason || 'Registry lock ownership lost; aborting write',
        };
      }
      if (ctx.isDistributed) {
        const written = await ctx.setProtected(KV_KEY, JSON.stringify(records));
        if (!written) {
          return {
            success: false,
            error: ctx.lostReason || 'Registry lock ownership lost before save',
          };
        }
        return { success: true };
      }
    }

    if (KV_CONFIGURED || isKvConfigured()) {
      await kvSet(KV_KEY, JSON.stringify(records));
      return { success: true };
    }
    if (!isFilePersistenceAllowed()) {
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
  preloaded?: AlphaRecord[],
  isAdmin = false
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

  const isProViewer = rank >= TIERS.PRO.rank || isAdmin;
  const filtered = sorted.filter((r) => {
    // Only Admin and Pro users can see MAX ALPHA cards
    if (r.isMaxAlpha && !isProViewer) {
      return false;
    }
    return true;
  });

  return filtered.map((r, idx) => {
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
      change24hPct: typeof r.change24hPct === 'number' && Number.isFinite(r.change24hPct) ? r.change24hPct : null,
      age: r.age,
      ageMinutes: r.ageMinutes,
      caller: r.caller,
      callerWinRate: winRateByCaller.get(r.caller) ?? '—',
      deployedVia: r.deployedVia,
      spotlightRank: r.spotlightRank,
      serialTag,
      outcome: r.outcome ?? (r.takeProfits && r.takeProfits.some((t) => t.hit) ? 'PROFIT' : 'PENDING'),
      isMaxAlpha: Boolean(r.isMaxAlpha),
      logoUrl: r.logoUrl,
      sparkline: r.sparkline,
      art: r.art,
    };
  });
}

/** Portfolio summary — empty until real verified claims are recorded (never ships mock/illustrative trades). */
export function samplePortfolio(): Portfolio {
  return { claimedCount: 0, totalRealizedPnl: '—', isSample: false, note: 'No verified claims yet', history: [] };
}
