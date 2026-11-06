import { loadCallsRegistry, saveCallsRegistry, withRegistryLock, AlphaRecord } from '@/server/alphas-data';
import { getMarketTelemetry } from '@/server/market-data';
import { notifyTpTriggered, notifySlTriggered } from '@/server/telegram';

export interface AlertMonitorResult {
  evaluated: number;
  tpTriggered: number;
  slTriggered: number;
  notificationsSent: number;
  errors: string[];
  skippedDueToProvider: number;
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

/**
 * Automated monitoring worker that:
 * 1. Retrieves current market data for active alpha calls.
 * 2. Evaluates configured take-profit and stop-loss conditions.
 * 3. Records triggered events with idempotency (prevents duplicate triggers).
 * 4. Updates alpha status and outcome.
 * 5. Sends Telegram notifications to holders.
 * 6. Handles provider downtime and stale market data without false triggers.
 */
export async function runAutomatedAlertsMonitor(): Promise<AlertMonitorResult> {
  const result: AlertMonitorResult = {
    evaluated: 0,
    tpTriggered: 0,
    slTriggered: 0,
    notificationsSent: 0,
    errors: [],
    skippedDueToProvider: 0,
  };

  await withRegistryLock(async () => {
    let registry: AlphaRecord[];
    try {
      registry = await loadCallsRegistry();
    } catch (err) {
      result.errors.push(`Failed to load registry: ${(err as Error).message}`);
      return;
    }

    let modified = false;

    for (const alpha of registry) {
      // Only monitor LIVE active calls
      if (alpha.status !== 'LIVE') continue;
      if (!alpha.ca) continue;

      result.evaluated++;

      // Fetch live market telemetry
      const telemetry = await getMarketTelemetry(
        alpha.ca,
        alpha.marketCapUsd,
        alpha.change24hPct,
        alpha.chain
      );

      // Provider guard: Never trigger TP/SL on unavailable or fallback/fixture data!
      if (telemetry.freshness === 'UNAVAILABLE' || telemetry.freshness === 'FALLBACK') {
        result.skippedDueToProvider++;
        continue;
      }

      const currentMc = telemetry.marketCapUsd;
      if (!currentMc || currentMc <= 0) continue;

      const entryMc = alpha.entryMarketCapUsd > 0 ? alpha.entryMarketCapUsd : alpha.marketCapUsd;
      const formattedCurrentMc = `$${(currentMc / 1000).toFixed(1)}K`;

      // 1. Check Take Profit Targets
      if (Array.isArray(alpha.takeProfits)) {
        for (const tp of alpha.takeProfits) {
          const targetMc = entryMc * tp.multiple;

          // If target is reached and not previously triggered
          if (currentMc >= targetMc && !tp.hit) {
            tp.hit = true;
            (tp as unknown as { triggeredAt?: string }).triggeredAt = new Date().toISOString();
            alpha.outcome = 'PROFIT';
            modified = true;
            result.tpTriggered++;

            try {
              const fanout = await notifyTpTriggered(alpha, tp.label, formattedCurrentMc);
              result.notificationsSent += fanout.sent;
            } catch (notifyErr) {
              result.errors.push(`Failed to send TP notification for ${alpha.ticker}: ${(notifyErr as Error).message}`);
            }
          }
        }
      }

      // 2. Check Stop Loss Condition
      const slPct = parseStopLossPercentage(alpha.stopLoss);
      if (slPct !== null && entryMc > 0) {
        const slThresholdMc = entryMc * (1 + slPct); // e.g. entry * 0.75 for -25%

        if (currentMc <= slThresholdMc && alpha.outcome !== 'LOSS') {
          alpha.status = 'CLOSED';
          alpha.statusLabel = 'CLOSED (SL)';
          alpha.outcome = 'LOSS';
          modified = true;
          result.slTriggered++;

          try {
            const fanout = await notifySlTriggered(alpha, formattedCurrentMc);
            result.notificationsSent += fanout.sent;
          } catch (notifyErr) {
            result.errors.push(`Failed to send SL notification for ${alpha.ticker}: ${(notifyErr as Error).message}`);
          }
        }
      }
    }

    if (modified) {
      try {
        await saveCallsRegistry(registry);
      } catch (err) {
        result.errors.push(`Failed to save registry updates: ${(err as Error).message}`);
      }
    }
  });

  return result;
}
