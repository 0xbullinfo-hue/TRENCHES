import {
  formatCompactUsd,
  loadCallsRegistry,
  saveCallsRegistry,
  withRegistryLock,
} from '@/server/alphas-data';
import type { AlphaRecord } from '@/server/alphas-data';
import { getMarketData, normalizeToken } from '@/server/market-data';
import type { MarketRequestOptions, MarketToken, NormalizedMarketData } from '@/server/market-data';
import { getMarketProviderConfig, MAX_FUTURE_CLOCK_SKEW_MS } from '@/server/market-config';
import { notifyTpTriggered, notifySlTriggered } from '@/server/telegram';

export { MAX_FUTURE_CLOCK_SKEW_MS };

export interface AlertMonitorResult {
  ok: boolean;
  incomplete: boolean;
  operationalFailure?: boolean;
  failureReason?: string;
  evaluated: number;
  tpTriggered: number;
  slTriggered: number;
  notificationsSent: number;
  errors: string[];
  /** Calls skipped because market data was missing, stale, unverified or invalid. */
  skippedDueToProvider: number;
  skippedByReason: Record<string, number>;
}

/**
 * Parses stop loss strings like "-25% SL", "25%", "-30%", etc.
 * Returns the decimal ratio below entry (e.g. -0.25 for -25%).
 */
export function parseStopLossPercentage(slStr: string): number | null {
  if (!slStr) return null;
  if (/\+\d/.test(slStr)) return null;
  const match = slStr.match(/(-?\d+(\.\d+)?)\s*%/);
  if (match) {
    const val = parseFloat(match[1]);
    if (!Number.isFinite(val) || val === 0 || Math.abs(val) >= 100) return null;
    return val < 0 ? val / 100 : -val / 100;
  }
  return null;
}

export type TelemetryRejection =
  | 'status_not_live' // UNAVAILABLE or STALE
  | 'unverified_token' // the call has no valid chain/contract to verify against
  | 'identity_mismatch' // the data describes another token/chain
  | 'invalid_market_cap'
  | 'stale_data'
  | 'future_timestamp';

export type TelemetryVerdict =
  | { eligible: true; marketCapUsd: number }
  | { eligible: false; reason: TelemetryRejection };

/**
 * Decides whether market data may be used to fire an alert. TP/SL alerts are informational but must
 * never be triggered by missing, invalid, unverified, mismatched or stale telemetry.
 * Only fresh provider data (LIVE) or just-cached data (CACHED) qualifies; STALE never does.
 */
export function assessTelemetryForAlerts(
  data: NormalizedMarketData,
  call: Pick<AlphaRecord, 'chain' | 'ca'>,
  nowMs: number,
  maxAgeMs: number
): TelemetryVerdict {
  if (data.status !== 'LIVE' && data.status !== 'CACHED') return { eligible: false, reason: 'status_not_live' };

  const expected = normalizeToken({ chain: call.chain, contractAddress: call.ca });
  if (!expected) return { eligible: false, reason: 'unverified_token' };

  const returned = normalizeToken({ chain: data.chain, contractAddress: data.contractAddress });
  if (!returned || returned.chain !== expected.chain || returned.contractAddress !== expected.contractAddress) {
    return { eligible: false, reason: 'identity_mismatch' };
  }

  const mc = data.marketCap;
  if (typeof mc !== 'number' || !Number.isFinite(mc) || mc <= 0) return { eligible: false, reason: 'invalid_market_cap' };

  const fetchedAt = data.fetchedAt
    ? Date.parse(data.fetchedAt)
    : NaN;

  if (!Number.isFinite(fetchedAt) || !Number.isFinite(nowMs)) {
    return {
      eligible: false,
      reason: 'stale_data',
    };
  }

  const telemetryAgeMs = nowMs - fetchedAt;

  // Reject timestamps more than 30 seconds ahead of server time.
  if (telemetryAgeMs < -MAX_FUTURE_CLOCK_SKEW_MS) {
    return {
      eligible: false,
      reason: 'future_timestamp',
    };
  }

  // Reject data older than the configured maximum age.
  if (telemetryAgeMs > maxAgeMs) {
    return {
      eligible: false,
      reason: 'stale_data',
    };
  }

  return { eligible: true, marketCapUsd: mc };
}

export interface TargetEvaluation {
  /** Take-profit targets crossed that have not been triggered before. */
  newTakeProfits: Array<{ index: number; label: string }>;
  slTriggered: boolean;
}

/**
 * Pure evaluation of TP/SL conditions. Entry and current values are both USD market caps.
 * Already-hit targets never re-trigger, a call already closed by SL never re-triggers.
 */
export function evaluateTargets(
  call: Pick<AlphaRecord, 'takeProfits' | 'stopLoss' | 'entryMarketCapUsd' | 'marketCapUsd' | 'outcome'>,
  currentMcUsd: number
): TargetEvaluation | null {
  const entryMc = call.entryMarketCapUsd > 0 ? call.entryMarketCapUsd : call.marketCapUsd;
  if (!Number.isFinite(currentMcUsd) || currentMcUsd <= 0) return null;
  if (!Number.isFinite(entryMc) || entryMc <= 0) return null;

  const slPct = parseStopLossPercentage(call.stopLoss);
  const slTriggered =
    slPct !== null && slPct < 0 && call.outcome !== 'LOSS' && currentMcUsd <= entryMc * (1 + slPct);

  const newTakeProfits: TargetEvaluation['newTakeProfits'] = [];
  if (!slTriggered && Array.isArray(call.takeProfits)) {
    call.takeProfits.forEach((tp, index) => {
      if (!tp.hit && Number.isFinite(tp.multiple) && tp.multiple > 0 && currentMcUsd >= entryMc * tp.multiple) {
        newTakeProfits.push({ index, label: tp.label });
      }
    });
  }

  return { newTakeProfits, slTriggered };
}

export interface AlertsMonitorDeps {
  getMarketData: (token: MarketToken, options?: MarketRequestOptions) => Promise<NormalizedMarketData>;
  loadRegistry: () => Promise<AlphaRecord[]>;
  saveRegistry: (records: AlphaRecord[]) => Promise<{ success: boolean; error?: string }>;
  withLock: <T>(fn: () => Promise<T> | T) => Promise<T>;
  notifyTp: typeof notifyTpTriggered;
  notifySl: typeof notifySlTriggered;
  now: () => number;
  /** Maximum age of market data that may trigger an alert. */
  maxDataAgeMs: number;
  /** Maximum execution budget (ms) inside the serverless timeout window. */
  budgetMs?: number;
  /** Time (ms) reserved at the end of budgetMs for registry persistence and notification dispatch. */
  reserveForPersistAndNotifyMs?: number;
  /** Minimum remaining lookup budget (ms) required before starting a new market-data request. */
  minRequestBudgetMs?: number;
  /** Maximum per-request market-data timeout (ms) before clamping to remaining lookup budget. */
  maxRequestTimeoutMs?: number;
}

class BudgetRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Market data request timed out after ${timeoutMs}ms execution budget limit`);
    this.name = 'BudgetRequestTimeoutError';
  }
}

async function withRequestTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BudgetRequestTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

type PendingEvent =
  | { kind: 'TP'; alpha: AlphaRecord; label: string; mcLabel: string }
  | { kind: 'SL'; alpha: AlphaRecord; mcLabel: string };

/**
 * Automated monitoring worker that:
 * 1. Retrieves validated market data for active alpha calls within a strict execution budget.
 * 2. Refuses to act on missing, invalid, unverified, mismatched or stale telemetry.
 * 3. Records triggered events idempotently (a persisted `hit` flag prevents duplicates).
 * 4. Persists the new state FIRST, and only then notifies - so a failed save can never cause repeat alerts.
 * 5. Sends informational Telegram notifications. TRENCHLABS never executes trades.
 */
export async function runAutomatedAlertsMonitor(
  overrides: Partial<AlertsMonitorDeps> = {}
): Promise<AlertMonitorResult> {
  const providerConfig = getMarketProviderConfig();
  const deps: AlertsMonitorDeps = {
    getMarketData,
    loadRegistry: loadCallsRegistry,
    saveRegistry: saveCallsRegistry,
    withLock: withRegistryLock,
    notifyTp: notifyTpTriggered,
    notifySl: notifySlTriggered,
    now: Date.now,
    maxDataAgeMs: providerConfig.cacheTtlSeconds * 2 * 1000,
    budgetMs: 50_000,
    maxRequestTimeoutMs: providerConfig.timeoutMs,
    ...overrides,
  };

  const startedAt = deps.now();
  const budgetMs = deps.budgetMs ?? 50_000;
  const reserveMs =
    deps.reserveForPersistAndNotifyMs ??
    (budgetMs >= 5_000 ? Math.min(10_000, Math.floor(budgetMs * 0.2)) : 0);
  const lookupWindowMs = Math.max(0, budgetMs - reserveMs);
  const lookupDeadlineMs = startedAt + lookupWindowMs;
  const minRequestBudgetMs =
    deps.minRequestBudgetMs ??
    (lookupWindowMs >= 2_000 ? Math.min(1_000, Math.floor(lookupWindowMs * 0.1)) : Math.min(50, Math.max(1, lookupWindowMs)));
  const maxRequestTimeoutMs = deps.maxRequestTimeoutMs ?? providerConfig.timeoutMs;

  const result: AlertMonitorResult = {
    ok: true,
    incomplete: false,
    evaluated: 0,
    tpTriggered: 0,
    slTriggered: 0,
    notificationsSent: 0,
    errors: [],
    skippedDueToProvider: 0,
    skippedByReason: {},
  };
  const skip = (reason: string) => {
    result.skippedDueToProvider++;
    result.skippedByReason[reason] = (result.skippedByReason[reason] ?? 0) + 1;
  };

  const events: PendingEvent[] = await deps.withLock(async () => {
    const pending: PendingEvent[] = [];
    let registry: AlphaRecord[];
    try {
      registry = await deps.loadRegistry();
    } catch (err) {
      const msg = `Failed to load registry: ${(err as Error).message}`;
      result.ok = false;
      result.operationalFailure = true;
      result.failureReason = msg;
      result.errors.push(msg);
      return pending;
    }

    const rollbackSnapshots = new Map<number, AlphaRecord>();
    let modified = false;

    for (let idx = 0; idx < registry.length; idx++) {
      const alpha = registry[idx];
      // Only monitor LIVE active calls
      if (alpha.status !== 'LIVE') continue;
      if (!alpha.ca) continue;

      const nowBeforeLookup = deps.now();
      const remainingLookupMs = lookupDeadlineMs - nowBeforeLookup;

      if (nowBeforeLookup - startedAt > budgetMs || remainingLookupMs < minRequestBudgetMs) {
        result.incomplete = true;
        // Count this call and all remaining active calls as skipped due to execution budget
        for (let remIdx = idx; remIdx < registry.length; remIdx++) {
          const remAlpha = registry[remIdx];
          if (remAlpha.status === 'LIVE' && remAlpha.ca) {
            skip('time_budget_exceeded');
          }
        }
        break;
      }

      result.evaluated++;

      const requestTimeoutMs = Math.max(
        50,
        Math.min(maxRequestTimeoutMs, Math.floor(remainingLookupMs))
      );

      let verdict: TelemetryVerdict;
      try {
        const data = await withRequestTimeout(
          deps.getMarketData(
            { chain: alpha.chain, contractAddress: alpha.ca },
            { timeoutMs: requestTimeoutMs }
          ),
          requestTimeoutMs
        );
        verdict = assessTelemetryForAlerts(data, alpha, deps.now(), deps.maxDataAgeMs);
      } catch (err) {
        result.errors.push(`Market data lookup failed for ${alpha.ticker}: ${(err as Error).message}`);
        if (err instanceof BudgetRequestTimeoutError) {
          result.incomplete = true;
          skip('time_budget_exceeded');
        } else {
          skip('lookup_error');
        }
        continue;
      }
      if (!verdict.eligible) {
        skip(verdict.reason);
        continue;
      }

      const evaluation = evaluateTargets(alpha, verdict.marketCapUsd);
      if (!evaluation) {
        skip('invalid_entry_market_cap');
        continue;
      }

      if (evaluation.newTakeProfits.length > 0 || evaluation.slTriggered) {
        rollbackSnapshots.set(idx, structuredClone(alpha));
      }

      const mcLabel = formatCompactUsd(verdict.marketCapUsd);

      for (const hit of evaluation.newTakeProfits) {
        const tp = alpha.takeProfits[hit.index];
        tp.hit = true;
        (tp as unknown as { triggeredAt?: string }).triggeredAt = new Date(deps.now()).toISOString();
        alpha.outcome = 'PROFIT';
        modified = true;
        result.tpTriggered++;
        pending.push({ kind: 'TP', alpha, label: hit.label, mcLabel });
      }

      if (evaluation.slTriggered) {
        alpha.status = 'CLOSED';
        alpha.statusLabel = 'CLOSED (SL)';
        alpha.outcome = 'LOSS';
        modified = true;
        result.slTriggered++;
        pending.push({ kind: 'SL', alpha, mcLabel });
      }
    }

    if (modified) {
      const saved = await deps.saveRegistry(registry).catch((err: Error) => ({ success: false, error: err.message }));
      if (!saved.success) {
        // Restore in-memory snapshots so failed persistence never corrupts registry state
        for (const [idx, snapshot] of rollbackSnapshots.entries()) {
          Object.assign(registry[idx], snapshot);
        }
        // Not durably recorded => do NOT notify, otherwise the next run would alert again.
        const msg = `Failed to save registry updates: ${saved.error ?? 'unknown error'}`;
        result.ok = false;
        result.operationalFailure = true;
        result.failureReason = msg;
        result.errors.push(msg);
        result.tpTriggered = 0;
        result.slTriggered = 0;
        return [];
      }
    }
    return pending;
  });

  // Notifications run after the registry lock is released (fan-out can take a while).
  const totalDeadlineMs = startedAt + budgetMs;
  for (const ev of events) {
    const remainingNotifyMs = totalDeadlineMs - deps.now();
    if (remainingNotifyMs <= 0) {
      result.incomplete = true;
      result.errors.push(`Notification dispatch stopped before ${ev.alpha.ticker}: execution budget exhausted`);
      break;
    }
    try {
      const fanout =
        ev.kind === 'TP'
          ? await deps.notifyTp(ev.alpha, ev.label, ev.mcLabel, remainingNotifyMs)
          : await deps.notifySl(ev.alpha, ev.mcLabel, remainingNotifyMs);
      result.notificationsSent += fanout.sent;
      if ((fanout as { deferred?: number }).deferred && (fanout as { deferred: number }).deferred > 0) {
        result.incomplete = true;
      }
    } catch (notifyErr) {
      const msg = `Failed to send ${ev.kind} notification for ${ev.alpha.ticker}: ${(notifyErr as Error).message}`;
      console.error(`[TP/SL Monitor] ${msg}`);
      result.errors.push(msg);
    }
  }

  return result;
}
