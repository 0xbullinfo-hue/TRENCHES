import {
  formatCompactUsd,
  loadCallsRegistry,
  saveCallsRegistry,
  withRegistryLock,
} from '@/server/alphas-data';
import type { AlphaRecord } from '@/server/alphas-data';
import { getMarketData, normalizeToken } from '@/server/market-data';
import type { MarketToken, NormalizedMarketData } from '@/server/market-data';
import { getMarketProviderConfig, MAX_FUTURE_CLOCK_SKEW_MS } from '@/server/market-config';
import { notifyTpTriggered, notifySlTriggered } from '@/server/telegram';

export { MAX_FUTURE_CLOCK_SKEW_MS };

export interface AlertMonitorResult {
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
  const match = slStr.match(/(-?\d+(\.\d+)?)\s*%/);
  if (match) {
    const val = parseFloat(match[1]);
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

  const newTakeProfits: TargetEvaluation['newTakeProfits'] = [];
  if (Array.isArray(call.takeProfits)) {
    call.takeProfits.forEach((tp, index) => {
      if (!tp.hit && Number.isFinite(tp.multiple) && tp.multiple > 0 && currentMcUsd >= entryMc * tp.multiple) {
        newTakeProfits.push({ index, label: tp.label });
      }
    });
  }

  const slPct = parseStopLossPercentage(call.stopLoss);
  const slTriggered =
    slPct !== null && slPct < 0 && call.outcome !== 'LOSS' && currentMcUsd <= entryMc * (1 + slPct);

  return { newTakeProfits, slTriggered };
}

export interface AlertsMonitorDeps {
  getMarketData: (token: MarketToken) => Promise<NormalizedMarketData>;
  loadRegistry: () => Promise<AlphaRecord[]>;
  saveRegistry: (records: AlphaRecord[]) => Promise<{ success: boolean; error?: string }>;
  withLock: <T>(fn: () => Promise<T> | T) => Promise<T>;
  notifyTp: typeof notifyTpTriggered;
  notifySl: typeof notifySlTriggered;
  now: () => number;
  /** Maximum age of market data that may trigger an alert. */
  maxDataAgeMs: number;
}

type PendingEvent =
  | { kind: 'TP'; alpha: AlphaRecord; label: string; mcLabel: string }
  | { kind: 'SL'; alpha: AlphaRecord; mcLabel: string };

/**
 * Automated monitoring worker that:
 * 1. Retrieves validated market data for active alpha calls.
 * 2. Refuses to act on missing, invalid, unverified, mismatched or stale telemetry.
 * 3. Records triggered events idempotently (a persisted `hit` flag prevents duplicates).
 * 4. Persists the new state FIRST, and only then notifies - so a failed save can never cause repeat alerts.
 * 5. Sends informational Telegram notifications. TRENCHLABS never executes trades.
 */
export async function runAutomatedAlertsMonitor(
  overrides: Partial<AlertsMonitorDeps> = {}
): Promise<AlertMonitorResult> {
  const deps: AlertsMonitorDeps = {
    getMarketData,
    loadRegistry: loadCallsRegistry,
    saveRegistry: saveCallsRegistry,
    withLock: withRegistryLock,
    notifyTp: notifyTpTriggered,
    notifySl: notifySlTriggered,
    now: Date.now,
    maxDataAgeMs: getMarketProviderConfig().cacheTtlSeconds * 2 * 1000,
    ...overrides,
  };

  const result: AlertMonitorResult = {
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
      result.errors.push(`Failed to load registry: ${(err as Error).message}`);
      return pending;
    }

    let modified = false;

    for (const alpha of registry) {
      // Only monitor LIVE active calls
      if (alpha.status !== 'LIVE') continue;
      if (!alpha.ca) continue;

      result.evaluated++;

      let verdict: TelemetryVerdict;
      try {
        const data = await deps.getMarketData({ chain: alpha.chain, contractAddress: alpha.ca });
        verdict = assessTelemetryForAlerts(data, alpha, deps.now(), deps.maxDataAgeMs);
      } catch (err) {
        result.errors.push(`Market data lookup failed for ${alpha.ticker}: ${(err as Error).message}`);
        skip('lookup_error');
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
        // Not durably recorded => do NOT notify, otherwise the next run would alert again.
        result.errors.push(`Failed to save registry updates: ${saved.error ?? 'unknown error'}`);
        result.tpTriggered = 0;
        result.slTriggered = 0;
        return [];
      }
    }
    return pending;
  });

  // Notifications run after the registry lock is released (fan-out can take a while).
  for (const ev of events) {
    try {
      const fanout =
        ev.kind === 'TP'
          ? await deps.notifyTp(ev.alpha, ev.label, ev.mcLabel)
          : await deps.notifySl(ev.alpha, ev.mcLabel);
      result.notificationsSent += fanout.sent;
    } catch (notifyErr) {
      result.errors.push(
        `Failed to send ${ev.kind} notification for ${ev.alpha.ticker}: ${(notifyErr as Error).message}`
      );
    }
  }

  return result;
}
